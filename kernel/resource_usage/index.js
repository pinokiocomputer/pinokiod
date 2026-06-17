"use strict"

const os = require("os")
const { GpuSampler, sumGpuMemory } = require("./gpu")
const { MacFootprintSampler } = require("./macos_footprint")
const { ProcessSampler, getDescendantPids, sumProcessMetrics } = require("./process_tree")
const { ResourceUsagePreferences } = require("./preferences")

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) {
    return "--"
  }
  const k = 1024
  if (value >= k * k * k) {
    return `${Math.floor((value / k / k / k) * 100) / 100} GB`
  }
  if (value >= k * k) {
    return `${Math.floor((value / k / k) * 100) / 100} MB`
  }
  if (value >= k) {
    return `${Math.floor((value / k) * 100) / 100} KB`
  }
  return `${Math.floor(value)} B`
}

function normalizeWorkspaceName(value) {
  if (typeof value !== "string") {
    return ""
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
    return ""
  }
  return trimmed
}

class ResourceUsageService {
  constructor(options = {}) {
    if (!options.kernel) {
      throw new Error("ResourceUsageService requires kernel")
    }
    this.kernel = options.kernel
    this.platform = this.kernel.platform || os.platform()
    this.preferences = new ResourceUsagePreferences({ kernel: this.kernel })
    this.processSampler = new ProcessSampler({
      platform: this.platform,
      ttlMs: 4000,
      timeoutMs: 2500
    })
    this.macFootprintSampler = new MacFootprintSampler({
      platform: this.platform,
      ttlMs: 15000,
      timeoutMs: 2000
    })
    this.gpuSampler = new GpuSampler({
      kernel: this.kernel,
      ttlMs: 10000,
      timeoutMs: 2500
    })
    this.cpuAverages = new Map()
    this.workspaceCache = new Map()
    this.collectInFlight = null
    this.lastGlobalCollectAt = 0
    this.globalTtlMs = options.globalTtlMs || 5000
  }

  async getPreferences() {
    return this.preferences.read()
  }

  async updatePreferences(updates = {}) {
    const preferences = await this.preferences.update(updates)
    this.workspaceCache.clear()
    this.lastGlobalCollectAt = 0
    return preferences
  }

  getShellRootGroups() {
    if (!this.kernel || !this.kernel.shell || typeof this.kernel.path !== "function") {
      return new Map()
    }
    const apiRoot = this.kernel.path("api")
    if (typeof this.kernel.shell.resourceRootsByWorkspace === "function") {
      return this.kernel.shell.resourceRootsByWorkspace(apiRoot)
    }
    return new Map()
  }

  smoothCpu(workspaceName, value) {
    if (!Number.isFinite(value)) {
      this.cpuAverages.delete(workspaceName)
      return null
    }
    const now = Date.now()
    const previous = this.cpuAverages.get(workspaceName)
    let smoothed = value
    if (previous && Number.isFinite(previous.value) && now - previous.updatedAt < 30000) {
      smoothed = (previous.value * 0.55) + (value * 0.45)
    }
    this.cpuAverages.set(workspaceName, { value: smoothed, updatedAt: now })
    return smoothed
  }

  metric(enabled, available, value = {}) {
    return {
      enabled: !!enabled,
      available: !!available,
      ...value
    }
  }

  selectFootprintPids(pids) {
    return Array.from(pids || []).sort((a, b) => a - b)
  }

  emptyWorkspaceUsage(name, preferences, options = {}) {
    const updatedAt = options.updatedAt || Date.now()
    return {
      ok: true,
      workspace: name,
      running: false,
      updated_at: new Date(updatedAt).toISOString(),
      stale: !!options.stale,
      preferences,
      metrics: {
        ram: this.metric(preferences.show_ram, false, {
          bytes: 0,
          formatted: "0 B"
        }),
        cpu: this.metric(preferences.show_cpu, false, {
          percent: null
        }),
        vram: this.metric(preferences.show_vram, false, {
          bytes: 0,
          formatted: "0 MB"
        })
      }
    }
  }

  sumFootprintBytes(footprintSnapshot, pids) {
    const perPid = footprintSnapshot && footprintSnapshot.perPid instanceof Map ? footprintSnapshot.perPid : new Map()
    let bytes = 0
    for (const pid of pids || []) {
      bytes += perPid.get(pid) || 0
    }
    return bytes
  }

  buildWorkspaceUsage(name, preferences, roots, processSnapshot, processData, gpuSnapshot, footprintSnapshot) {
    const pids = processData && processData.pids instanceof Set ? processData.pids : new Set()
    const processSummary = processData && processData.summary ? processData.summary : {
      processCount: 0,
      rssBytes: 0,
      cpuPercent: null,
      cpuPercentCores: null
    }

    let ramBytes = processSummary.rssBytes
    const footprintBytes = preferences.show_ram && this.platform === "darwin"
      ? this.sumFootprintBytes(footprintSnapshot, pids)
      : 0
    if (footprintBytes > 0) {
      ramBytes = footprintBytes
    }

    const smoothedCpu = preferences.show_cpu
      ? this.smoothCpu(name, processSummary.cpuPercent)
      : null

    const gpuSummary = preferences.show_vram && pids.size > 0
      ? sumGpuMemory(gpuSnapshot, pids)
      : {
        bytes: 0
      }

    const rootPids = roots.map((root) => root.pid).filter((pid) => Number.isFinite(pid))
    const running = rootPids.length > 0 && (processSummary.processCount > 0 || pids.size > 0)
    const processAvailable = !!(processSnapshot && processSnapshot.available)
    const ramAvailable = running && !!(processAvailable || footprintBytes > 0)
    const gpuAvailable = !!(gpuSnapshot && gpuSnapshot.available)
    const updatedAt = Math.max(
      processSnapshot && processSnapshot.collectedAt ? processSnapshot.collectedAt : 0,
      footprintSnapshot && footprintSnapshot.collectedAt ? footprintSnapshot.collectedAt : 0,
      gpuSnapshot && gpuSnapshot.collectedAt ? gpuSnapshot.collectedAt : 0,
      Date.now()
    )

    return {
      ok: true,
      workspace: name,
      running,
      updated_at: new Date(updatedAt).toISOString(),
      stale: !!((processSnapshot && processSnapshot.stale) || (footprintSnapshot && footprintSnapshot.stale) || (gpuSnapshot && gpuSnapshot.stale)),
      preferences,
      metrics: {
        ram: this.metric(preferences.show_ram, ramAvailable, {
          bytes: ramBytes,
          formatted: formatBytes(ramBytes)
        }),
        cpu: this.metric(preferences.show_cpu, Number.isFinite(smoothedCpu), {
          percent: Number.isFinite(smoothedCpu) ? Math.max(0, Math.round(smoothedCpu * 10) / 10) : null
        }),
        vram: this.metric(preferences.show_vram, gpuAvailable && running, {
          bytes: gpuSummary.bytes,
          formatted: gpuSummary.bytes > 0 ? formatBytes(gpuSummary.bytes) : "0 MB"
        })
      }
    }
  }

  async collectGlobalUsage(preferencesOverride = null) {
    const preferences = preferencesOverride || await this.getPreferences()
    const rootGroups = this.getShellRootGroups()
    const hasRoots = rootGroups.size > 0
    const shouldCollectProcesses = hasRoots && (
      preferences.show_ram ||
      preferences.show_cpu ||
      preferences.show_vram
    )

    const processSnapshot = shouldCollectProcesses ? await this.processSampler.getSnapshot() : null
    const workspaceProcesses = new Map()
    const allPids = new Set()

    for (const [name, roots] of rootGroups.entries()) {
      const rootPids = roots.map((root) => root.pid).filter((pid) => Number.isFinite(pid))
      const pids = processSnapshot ? getDescendantPids(processSnapshot, rootPids) : new Set()
      const summary = processSnapshot ? sumProcessMetrics(processSnapshot, pids) : {
        processCount: 0,
        rssBytes: 0,
        cpuPercent: null,
        cpuPercentCores: null
      }
      workspaceProcesses.set(name, { pids, summary })
      for (const pid of pids) {
        allPids.add(pid)
      }
    }

    const footprintSnapshot = preferences.show_ram && this.platform === "darwin" && allPids.size > 0
      ? await this.macFootprintSampler.getFootprintByPid(this.selectFootprintPids(allPids))
      : null

    const gpuSnapshot = preferences.show_vram && allPids.size > 0
      ? await this.gpuSampler.getSnapshot()
      : null

    const nextCache = new Map()
    for (const [name, roots] of rootGroups.entries()) {
      const usage = this.buildWorkspaceUsage(
        name,
        preferences,
        roots,
        processSnapshot,
        workspaceProcesses.get(name),
        gpuSnapshot,
        footprintSnapshot
      )
      nextCache.set(name, usage)
    }
    for (const name of this.cpuAverages.keys()) {
      if (!rootGroups.has(name)) {
        this.cpuAverages.delete(name)
      }
    }

    this.workspaceCache = nextCache
    this.lastGlobalCollectAt = Date.now()
    return nextCache
  }

  async ensureGlobalRefresh(options = {}) {
    const force = !!options.force
    const wait = !!options.wait
    const now = Date.now()
    if (!force && this.lastGlobalCollectAt && now - this.lastGlobalCollectAt < this.globalTtlMs) {
      return this.workspaceCache
    }
    if (!this.collectInFlight) {
      this.collectInFlight = this.collectGlobalUsage().catch(() => {
        this.lastGlobalCollectAt = Date.now()
        return this.workspaceCache
      }).finally(() => {
        this.collectInFlight = null
      })
    }
    if (wait) {
      return this.collectInFlight
    }
    return this.workspaceCache
  }

  markCachedUsage(usage) {
    if (!usage) return usage
    const stale = !!(this.lastGlobalCollectAt && Date.now() - this.lastGlobalCollectAt >= this.globalTtlMs)
    return stale ? { ...usage, stale: true } : usage
  }

  async getWorkspaceUsage(workspaceName) {
    const name = normalizeWorkspaceName(workspaceName)
    if (!name) {
      return {
        ok: false,
        error: "Invalid workspace",
        preferences: await this.getPreferences()
      }
    }

    const cached = this.workspaceCache.get(name)
    await this.ensureGlobalRefresh({ wait: !cached })
    const updated = this.workspaceCache.get(name)
    if (updated) {
      return this.markCachedUsage(updated)
    }
    const preferences = await this.getPreferences()
    return this.emptyWorkspaceUsage(name, preferences, { updatedAt: this.lastGlobalCollectAt || Date.now() })
  }
}

module.exports = ResourceUsageService
