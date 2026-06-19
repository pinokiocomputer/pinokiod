"use strict"

const os = require("os")
const { execFile } = require("child_process")

const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_TTL_MS = 4000
const MAX_BUFFER = 8 * 1024 * 1024

function execFileText(command, args, options = {}) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      timeout: timeoutMs,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout: stdout || "", stderr: stderr || "" })
    })
  })
}

function normalizePid(value) {
  const pid = Number.parseInt(String(value == null ? "" : value).trim(), 10)
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function parseCpuTimeSeconds(value) {
  const raw = String(value == null ? "" : value).trim()
  if (!raw) return 0
  const daySplit = raw.split("-")
  let days = 0
  let timePart = raw
  if (daySplit.length === 2) {
    days = Number.parseInt(daySplit[0], 10) || 0
    timePart = daySplit[1]
  }
  const parts = timePart.split(":").map((part) => Number.parseFloat(part))
  if (parts.some((part) => !Number.isFinite(part))) {
    return 0
  }
  let seconds = 0
  if (parts.length === 3) {
    seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2]
  } else if (parts.length === 2) {
    seconds = (parts[0] * 60) + parts[1]
  } else if (parts.length === 1) {
    seconds = parts[0]
  }
  return (days * 86400) + seconds
}

function parsePsOutput(stdout) {
  const processes = new Map()
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line)
    if (!match) continue
    const pid = normalizePid(match[1])
    const ppid = normalizePid(match[2])
    if (!pid) continue
    const rssKb = Number.parseInt(match[3], 10)
    processes.set(pid, {
      pid,
      ppid,
      rssBytes: Number.isFinite(rssKb) && rssKb > 0 ? rssKb * 1024 : 0,
      cpuSeconds: parseCpuTimeSeconds(match[4]),
      name: match[5] || ""
    })
  }
  return processes
}

function parseWindowsProcessJson(stdout) {
  const parsed = JSON.parse(stdout || "[]")
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const processes = new Map()
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const pid = normalizePid(row.ProcessId)
    if (!pid) continue
    const ppid = normalizePid(row.ParentProcessId)
    const workingSet = Number(row.WorkingSetSize)
    const kernelTime = Number(row.KernelModeTime)
    const userTime = Number(row.UserModeTime)
    const cpuTicks = (Number.isFinite(kernelTime) ? kernelTime : 0) + (Number.isFinite(userTime) ? userTime : 0)
    processes.set(pid, {
      pid,
      ppid,
      rssBytes: Number.isFinite(workingSet) && workingSet > 0 ? workingSet : 0,
      cpuSeconds: cpuTicks / 10000000,
      name: typeof row.Name === "string" ? row.Name : ""
    })
  }
  return processes
}

async function collectPosixProcesses(timeoutMs) {
  const { stdout } = await execFileText("ps", ["-axo", "pid=,ppid=,rss=,time=,comm="], { timeoutMs })
  return parsePsOutput(stdout)
}

async function collectWindowsProcesses(timeoutMs) {
  const script = [
    "$ProgressPreference = 'SilentlyContinue';",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,Name |",
    "ConvertTo-Json -Compress"
  ].join(" ")
  const candidates = ["powershell.exe", "powershell", "pwsh"]
  let lastError = null
  for (const command of candidates) {
    try {
      const { stdout } = await execFileText(command, [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script
      ], { timeoutMs: Math.max(timeoutMs, 3000) })
      return parseWindowsProcessJson(stdout)
    } catch (error) {
      lastError = error
      if (error && error.code !== "ENOENT") {
        break
      }
    }
  }
  throw lastError || new Error("Unable to collect Windows process list")
}

async function collectProcessSnapshot(options = {}) {
  const platform = options.platform || os.platform()
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const processes = platform === "win32"
    ? await collectWindowsProcesses(timeoutMs)
    : await collectPosixProcesses(timeoutMs)
  return {
    available: true,
    stale: false,
    collectedAt: Date.now(),
    processes,
    error: null,
    elapsedMs: null
  }
}

function annotateCpuRates(snapshot, previous, cpuCount) {
  if (!snapshot || !previous || !snapshot.processes || !previous.processes) {
    return snapshot
  }
  const elapsedMs = Math.max(0, snapshot.collectedAt - previous.collectedAt)
  snapshot.elapsedMs = elapsedMs
  if (elapsedMs < 250) {
    return snapshot
  }
  const elapsedSeconds = elapsedMs / 1000
  const cores = Math.max(1, cpuCount || 1)
  for (const [pid, entry] of snapshot.processes.entries()) {
    const prev = previous.processes.get(pid)
    if (!prev) continue
    const delta = entry.cpuSeconds - prev.cpuSeconds
    if (!Number.isFinite(delta) || delta < 0) continue
    entry.cpuPercentCores = (delta / elapsedSeconds) * 100
    entry.cpuPercent = entry.cpuPercentCores / cores
  }
  return snapshot
}

class ProcessSampler {
  constructor(options = {}) {
    this.platform = options.platform || os.platform()
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS
    this.cpuCount = Math.max(1, Array.isArray(os.cpus()) ? os.cpus().length : 1)
    this.current = null
    this.inFlight = null
    this.failureUntil = 0
  }

  async getSnapshot() {
    const now = Date.now()
    if (this.current && now - this.current.collectedAt < this.ttlMs) {
      return this.current
    }
    if (this.inFlight) {
      return this.inFlight
    }
    if (this.failureUntil && now < this.failureUntil) {
      if (this.current) {
        return { ...this.current, stale: true }
      }
      return {
        available: false,
        stale: true,
        collectedAt: now,
        processes: new Map(),
        error: "Process snapshot unavailable",
        elapsedMs: null
      }
    }
    this.inFlight = collectProcessSnapshot({
      platform: this.platform,
      timeoutMs: this.timeoutMs
    }).then((snapshot) => {
      annotateCpuRates(snapshot, this.current, this.cpuCount)
      this.current = snapshot
      this.failureUntil = 0
      return snapshot
    }).catch((error) => {
      this.failureUntil = Date.now() + 15000
      if (this.current) {
        return {
          ...this.current,
          stale: true,
          error: error && error.message ? error.message : String(error)
        }
      }
      return {
        available: false,
        stale: false,
        collectedAt: Date.now(),
        processes: new Map(),
        error: error && error.message ? error.message : String(error),
        elapsedMs: null
      }
    }).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }
}

function getDescendantPids(snapshot, rootPids = []) {
  const processes = snapshot && snapshot.processes instanceof Map ? snapshot.processes : new Map()
  const childrenByParent = new Map()
  for (const entry of processes.values()) {
    if (!entry || !entry.ppid) continue
    if (!childrenByParent.has(entry.ppid)) {
      childrenByParent.set(entry.ppid, [])
    }
    childrenByParent.get(entry.ppid).push(entry.pid)
  }
  const visited = new Set()
  const queue = []
  for (const rootPid of rootPids) {
    const pid = normalizePid(rootPid)
    if (!pid || visited.has(pid)) continue
    visited.add(pid)
    queue.push(pid)
  }
  for (let i = 0; i < queue.length; i += 1) {
    const pid = queue[i]
    const children = childrenByParent.get(pid) || []
    for (const childPid of children) {
      if (visited.has(childPid)) continue
      visited.add(childPid)
      queue.push(childPid)
    }
  }
  return visited
}

function sumProcessMetrics(snapshot, pids) {
  const processes = snapshot && snapshot.processes instanceof Map ? snapshot.processes : new Map()
  let rssBytes = 0
  let cpuPercent = 0
  let cpuPercentCores = 0
  let hasCpu = false
  let processCount = 0
  for (const pid of pids || []) {
    const entry = processes.get(pid)
    if (!entry) continue
    processCount += 1
    rssBytes += entry.rssBytes || 0
    if (Number.isFinite(entry.cpuPercent)) {
      hasCpu = true
      cpuPercent += entry.cpuPercent
      cpuPercentCores += Number.isFinite(entry.cpuPercentCores) ? entry.cpuPercentCores : 0
    }
  }
  return {
    processCount,
    rssBytes,
    cpuPercent: hasCpu ? cpuPercent : null,
    cpuPercentCores: hasCpu ? cpuPercentCores : null
  }
}

module.exports = {
  ProcessSampler,
  execFileText,
  getDescendantPids,
  normalizePid,
  sumProcessMetrics
}
