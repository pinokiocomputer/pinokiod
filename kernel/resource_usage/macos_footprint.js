"use strict"

const os = require("os")
const { execFileText, normalizePid } = require("./process_tree")

const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_TTL_MS = 15000
const DEFAULT_FAILURE_BACKOFF_MS = 30000
const FOOTPRINT_COMMAND = "/usr/bin/footprint"

function parseFootprintBytes(stdout) {
  const text = String(stdout || "")
  const summaryMatch = /Summary Footprint:\s+(\d+)\s+B/i.exec(text)
  if (summaryMatch) {
    const bytes = Number.parseInt(summaryMatch[1], 10)
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  }
  const physicalMatch = /phys_footprint:\s+(\d+)\s+B/i.exec(text)
  if (physicalMatch) {
    const bytes = Number.parseInt(physicalMatch[1], 10)
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  }
  const footprintMatch = /Footprint:\s+(\d+)\s+B/i.exec(text)
  if (footprintMatch) {
    const bytes = Number.parseInt(footprintMatch[1], 10)
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  }
  return 0
}

function parseFootprintPidBytes(stdout) {
  const processes = new Map()
  const text = String(stdout || "")
  const pattern = /\[(\d+)\]:[^\n]*?\bFootprint:\s+(\d+)\s+B/gi
  let match = pattern.exec(text)
  while (match) {
    const pid = normalizePid(match[1])
    const bytes = Number.parseInt(match[2], 10)
    if (pid && Number.isFinite(bytes) && bytes > 0) {
      processes.set(pid, bytes)
    }
    match = pattern.exec(text)
  }
  return processes
}

function normalizePidList(pids) {
  const normalized = []
  const seen = new Set()
  for (const value of pids || []) {
    const pid = normalizePid(value)
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    normalized.push(pid)
  }
  return normalized
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error)
}

class MacFootprintSampler {
  constructor(options = {}) {
    this.platform = options.platform || os.platform()
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS
    this.failureBackoffMs = options.failureBackoffMs || DEFAULT_FAILURE_BACKOFF_MS
    this.cache = new Map()
    this.inFlight = new Map()
    this.failures = new Map()
  }

  async getFootprintByPid(pids) {
    if (this.platform !== "darwin") {
      return {
        available: false,
        stale: false,
        bytes: 0,
        perPid: new Map(),
        collectedAt: Date.now(),
        pids: [],
        error: null
      }
    }

    const selectedPids = normalizePidList(pids)
    if (selectedPids.length === 0) {
      return {
        available: false,
        stale: false,
        bytes: 0,
        perPid: new Map(),
        collectedAt: Date.now(),
        pids: [],
        error: null
      }
    }

    const key = selectedPids.join(",")
    const now = Date.now()
    const cached = this.cache.get(key)
    if (cached && now - cached.collectedAt < this.ttlMs) {
      return cached
    }
    const failure = this.failures.get(key)
    if (failure && now < failure.until) {
      if (cached) {
        return {
          ...cached,
          stale: true,
          error: failure.error
        }
      }
      return {
        available: false,
        stale: true,
        bytes: 0,
        perPid: new Map(),
        collectedAt: now,
        pids: selectedPids,
        error: failure.error
      }
    }
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)
    }

    const args = []
    for (const pid of selectedPids) {
      args.push("-pid", String(pid))
    }
    args.push("-f", "bytes", "--noCategories")

    const run = execFileText(FOOTPRINT_COMMAND, args, {
      timeoutMs: this.timeoutMs,
      maxBuffer: 512 * 1024
    }).then(({ stdout }) => {
      const perPid = parseFootprintPidBytes(stdout)
      let bytes = 0
      for (const value of perPid.values()) {
        bytes += value
      }
      if (bytes <= 0) {
        bytes = parseFootprintBytes(stdout)
      }
      const snapshot = {
        available: bytes > 0,
        stale: false,
        bytes,
        perPid,
        collectedAt: Date.now(),
        pids: selectedPids,
        error: bytes > 0 ? null : "Unable to parse footprint output"
      }
      if (snapshot.available) {
        this.cache.set(key, snapshot)
        this.failures.delete(key)
      }
      return snapshot
    }).catch((error) => {
      const message = errorMessage(error)
      this.failures.set(key, {
        until: Date.now() + this.failureBackoffMs,
        error: message
      })
      if (cached) {
        return {
          ...cached,
          stale: true,
          error: message
        }
      }
      return {
        available: false,
        stale: false,
        bytes: 0,
        perPid: new Map(),
        collectedAt: Date.now(),
        pids: selectedPids,
        error: message
      }
    }).finally(() => {
      this.inFlight.delete(key)
    })

    this.inFlight.set(key, run)
    return run
  }

}

module.exports = {
  MacFootprintSampler,
  parseFootprintBytes,
  parseFootprintPidBytes
}
