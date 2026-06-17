"use strict"

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileText, normalizePid } = require("./process_tree")

const DEFAULT_GPU_TTL_MS = 10000
const DEFAULT_GPU_TIMEOUT_MS = 2500
const MIB = 1024 * 1024

function unique(values) {
  const seen = new Set()
  const next = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function pathExists(filepath) {
  try {
    fs.accessSync(filepath, fs.constants.X_OK)
    return true
  } catch (_) {
    return false
  }
}

function executableCandidates(candidates) {
  return unique(candidates).filter((candidate) => {
    if (!candidate) return false
    if (path.isAbsolute(candidate)) {
      return pathExists(candidate)
    }
    return true
  })
}

function getPinokioCondaCandidates(kernel, names) {
  if (!kernel || !kernel.homedir) {
    return []
  }
  const prefix = path.resolve(kernel.homedir, "bin", "miniconda")
  const suffixes = os.platform() === "win32"
    ? ["", ".exe"]
    : [""]
  const folders = os.platform() === "win32"
    ? ["Library/bin", "Scripts", ""]
    : ["bin", "Library/bin", ""]
  const candidates = []
  for (const name of names) {
    for (const folder of folders) {
      for (const suffix of suffixes) {
        candidates.push(path.resolve(prefix, folder, `${name}${suffix}`))
      }
    }
  }
  return candidates
}

function parseMemoryToBytes(value, defaultUnit = "") {
  if (value == null) return null
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null
    if (defaultUnit === "mib") return Math.round(value * MIB)
    if (defaultUnit === "kb") return Math.round(value * 1024)
    return Math.round(value)
  }
  const raw = String(value).trim()
  if (!raw || /N\/A|not supported|none/i.test(raw)) {
    return null
  }
  const match = /(-?\d+(?:\.\d+)?)\s*([KMGT]?i?B|[KMGT]B|bytes?)?/i.exec(raw)
  if (!match) return null
  const amount = Number.parseFloat(match[1])
  if (!Number.isFinite(amount) || amount < 0) return null
  const unit = (match[2] || defaultUnit || "bytes").toLowerCase()
  if (unit === "mib" || unit === "mb") return Math.round(amount * MIB)
  if (unit === "gib" || unit === "gb") return Math.round(amount * 1024 * MIB)
  if (unit === "kib" || unit === "kb") return Math.round(amount * 1024)
  if (unit === "tib" || unit === "tb") return Math.round(amount * 1024 * 1024 * MIB)
  return Math.round(amount)
}

function addGpuProcess(processes, pid, bytes) {
  const normalizedPid = normalizePid(pid)
  if (!normalizedPid || !Number.isFinite(bytes) || bytes < 0) {
    return
  }
  const current = processes.get(normalizedPid) || {
    pid: normalizedPid,
    usedGpuMemoryBytes: 0
  }
  current.usedGpuMemoryBytes += bytes
  processes.set(normalizedPid, current)
}

function parseNvidiaCsv(stdout) {
  const processes = new Map()
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(",").map((part) => part.trim())
    const pid = normalizePid(parts[0])
    const bytes = parseMemoryToBytes(parts[1], "mib")
    addGpuProcess(processes, pid, bytes)
  }
  return processes
}

function findObjectValue(object, predicate) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return null
  }
  for (const [key, value] of Object.entries(object)) {
    if (predicate(key, value)) {
      return value
    }
  }
  return null
}

function extractAmdProcessesFromJson(value, processes = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      extractAmdProcessesFromJson(item, processes)
    }
    return processes
  }
  if (!value || typeof value !== "object") {
    return processes
  }

  const pidValue = findObjectValue(value, (key) => /(^|[_\s-])pid$|process[_\s-]*id/i.test(key))
  const memoryValue = findObjectValue(value, (key) => {
    const normalized = key.toLowerCase()
    if (/total|free|available|limit/.test(normalized)) return false
    return /vram|memory/.test(normalized) && /usage|used|mem|size/.test(normalized)
  })
  const pid = normalizePid(pidValue)
  const bytes = parseMemoryToBytes(memoryValue)
  addGpuProcess(processes, pid, bytes)

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      extractAmdProcessesFromJson(child, processes)
    }
  }
  return processes
}

function parseAmdJson(stdout) {
  const parsed = JSON.parse(stdout || "[]")
  return extractAmdProcessesFromJson(parsed)
}

class GpuSampler {
  constructor(options = {}) {
    this.kernel = options.kernel || null
    this.ttlMs = options.ttlMs || DEFAULT_GPU_TTL_MS
    this.timeoutMs = options.timeoutMs || DEFAULT_GPU_TIMEOUT_MS
    this.current = null
    this.inFlight = null
    this.providerBackoff = new Map()
  }

  nvidiaCandidates() {
    const platform = os.platform()
    const candidates = [
      process.env.NVIDIA_SMI,
      "nvidia-smi",
      ...getPinokioCondaCandidates(this.kernel, ["nvidia-smi"])
    ]
    if (platform === "win32") {
      candidates.push(
        "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
        "C:\\Windows\\System32\\nvidia-smi.exe"
      )
    } else if (platform === "linux") {
      candidates.push(
        "/usr/bin/nvidia-smi",
        "/usr/local/bin/nvidia-smi",
        "/usr/local/nvidia/bin/nvidia-smi",
        "/usr/local/cuda/bin/nvidia-smi"
      )
    }
    return executableCandidates(candidates)
  }

  amdCandidates() {
    const candidates = [
      process.env.AMD_SMI,
      "amd-smi",
      ...getPinokioCondaCandidates(this.kernel, ["amd-smi"])
    ]
    if (os.platform() === "linux") {
      candidates.push("/opt/rocm/bin/amd-smi", "/usr/bin/amd-smi", "/usr/local/bin/amd-smi")
    }
    return executableCandidates(candidates)
  }

  isBackedOff(provider) {
    const until = this.providerBackoff.get(provider) || 0
    return Date.now() < until
  }

  backoff(provider, ms = 60000) {
    this.providerBackoff.set(provider, Date.now() + ms)
  }

  async collectNvidia() {
    if (this.isBackedOff("nvidia")) {
      return null
    }
    const args = [
      "--query-compute-apps=pid,used_gpu_memory",
      "--format=csv,noheader,nounits"
    ]
    let lastError = null
    for (const command of this.nvidiaCandidates()) {
      try {
        const { stdout } = await execFileText(command, args, { timeoutMs: this.timeoutMs })
        return {
          provider: "nvidia-smi",
          processes: parseNvidiaCsv(stdout),
          error: null
        }
      } catch (error) {
        lastError = error
        if (error && error.code === "ENOENT") {
          continue
        }
        break
      }
    }
    this.backoff("nvidia", 60000)
    return {
      provider: "nvidia-smi",
      processes: new Map(),
      error: lastError && lastError.message ? lastError.message : "nvidia-smi unavailable"
    }
  }

  async collectAmd() {
    if (os.platform() !== "linux" || this.isBackedOff("amd")) {
      return null
    }
    let lastError = null
    for (const command of this.amdCandidates()) {
      try {
        const { stdout } = await execFileText(command, ["process", "--json", "-G"], { timeoutMs: this.timeoutMs })
        return {
          provider: "amd-smi",
          processes: parseAmdJson(stdout),
          error: null
        }
      } catch (error) {
        lastError = error
        if (error && error.code === "ENOENT") {
          continue
        }
        break
      }
    }
    this.backoff("amd", 90000)
    return {
      provider: "amd-smi",
      processes: new Map(),
      error: lastError && lastError.message ? lastError.message : "amd-smi unavailable"
    }
  }

  async collect() {
    const results = []
    const nvidia = await this.collectNvidia()
    if (nvidia) results.push(nvidia)
    const amd = await this.collectAmd()
    if (amd) results.push(amd)

    const processes = new Map()
    const providers = []
    const errors = []
    for (const result of results) {
      if (!result) continue
      if (result.provider) providers.push(result.provider)
      if (result.error) errors.push({ provider: result.provider, error: result.error })
      for (const entry of result.processes.values()) {
        addGpuProcess(processes, entry.pid, entry.usedGpuMemoryBytes)
      }
    }
    return {
      available: providers.length > 0 && errors.length < providers.length,
      stale: false,
      collectedAt: Date.now(),
      providers,
      processes,
      errors
    }
  }

  async getSnapshot() {
    const now = Date.now()
    if (this.current && now - this.current.collectedAt < this.ttlMs) {
      return this.current
    }
    if (this.inFlight) {
      return this.inFlight
    }
    this.inFlight = this.collect().then((snapshot) => {
      this.current = snapshot
      return snapshot
    }).catch((error) => {
      if (this.current) {
        return { ...this.current, stale: true }
      }
      return {
        available: false,
        stale: false,
        collectedAt: Date.now(),
        providers: [],
        processes: new Map(),
        errors: [{ provider: "gpu", error: error && error.message ? error.message : String(error) }]
      }
    }).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }
}

function sumGpuMemory(snapshot, pids) {
  const processes = snapshot && snapshot.processes instanceof Map ? snapshot.processes : new Map()
  let bytes = 0
  for (const pid of pids || []) {
    const entry = processes.get(pid)
    if (!entry) continue
    bytes += entry.usedGpuMemoryBytes || 0
  }
  return { bytes }
}

module.exports = {
  GpuSampler,
  parseMemoryToBytes,
  sumGpuMemory
}
