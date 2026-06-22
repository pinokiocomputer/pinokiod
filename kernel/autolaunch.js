const path = require('path')
const Environment = require('./environment')

class Autolaunch {
  constructor(kernel) {
    this.kernel = kernel
    this.status = {
      running: false,
      apps: {}
    }
  }
  setStatus(status) {
    this.status = status
    this.kernel.autolaunch_status = this.status
  }
  updateProgress(appId, progress) {
    const id = this.kernel.normalizeAppId(appId)
    if (!id || !progress) {
      return
    }
    const status = this.status && this.status.apps
      ? this.status.apps[id]
      : null
    if (!status || ["blocked", "failed", "timeout", "ready"].includes(status.state)) {
      return
    }
    this.status.apps[id] = {
      ...status,
      ...progress
    }
  }
  syncReadyState(appId, launchPath) {
    const dependencyId = this.kernel.normalizeAppId(appId)
    const ready = launchPath ? this.kernel.isScriptReady(launchPath) : this.kernel.isAppReady(dependencyId)
    if (!ready && launchPath) {
      this.updateProgress(dependencyId, this.kernel.getScriptProgress(launchPath))
    }
    if (!ready) {
      return false
    }
    const status = this.status && this.status.apps
      ? this.status.apps[dependencyId]
      : null
    if (status && !["blocked", "failed", "timeout"].includes(status.state)) {
      this.status.apps[dependencyId] = {
        ...status,
        state: "ready",
        ready_at: status.ready_at || Date.now(),
        waiting_for: []
      }
    }
    return true
  }
  findDependencyCycles(candidates) {
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const visiting = new Set()
    const visited = new Set()
    const cycleIds = new Set()
    const visit = (id, stack) => {
      if (visiting.has(id)) {
        const cycleStart = stack.indexOf(id)
        const cycle = cycleStart >= 0 ? stack.slice(cycleStart) : [id]
        cycle.forEach((cycleId) => cycleIds.add(cycleId))
        return
      }
      if (visited.has(id)) {
        return
      }
      const candidate = candidateMap.get(id)
      if (!candidate) {
        return
      }
      visiting.add(id)
      for (const dependency of candidate.dependencies) {
        if (candidateMap.has(dependency)) {
          visit(dependency, stack.concat(dependency))
        }
      }
      visiting.delete(id)
      visited.add(id)
    }
    for (const candidate of candidates) {
      visit(candidate.id, [candidate.id])
    }
    return cycleIds
  }
  async collectCandidates() {
    const apis = this.kernel.i && Array.isArray(this.kernel.i.api) ? this.kernel.i.api : []
    const installedIds = new Set(apis.map((api) => api && api.path).filter(Boolean))
    const candidates = []
    for (const api of apis) {
      if (!api || !api.path) {
        continue
      }
      const envPath = path.resolve(this.kernel.api.userdir, api.path)
      const env = await Environment.get(envPath, this.kernel)
      const script = typeof env.PINOKIO_SCRIPT_AUTOLAUNCH === "string"
        ? env.PINOKIO_SCRIPT_AUTOLAUNCH.trim()
        : ""
      if (!script) {
        continue
      }
      const autolaunchPath = path.resolve(envPath, script)
      const exists = await this.kernel.exists(autolaunchPath)
      const dependencies = Environment.parseAutolaunchList(env[Environment.SCRIPT_AUTOLAUNCH_DEPENDS_KEY])
        .map((id) => this.kernel.normalizeAppId(id))
        .filter((id, index, list) => id && id !== api.path && list.indexOf(id) === index)
      candidates.push({
        id: api.path,
        title: api.title || api.path,
        script,
        autolaunchPath,
        dependencies,
        invalidDependencies: dependencies.filter((id) => !installedIds.has(id)),
        exists
      })
    }
    return candidates
  }
  launchCandidate(candidate) {
    if (!candidate || !candidate.autolaunchPath) {
      return
    }
    this.status.apps[candidate.id] = {
      ...(this.status.apps[candidate.id] || {}),
      state: "starting",
      started_at: Date.now(),
      waiting_for: []
    }
    this.kernel.api.process({
      uri: candidate.autolaunchPath,
      input: {}
    }).catch((err) => {
      console.warn('[Kernel.init] autolaunch process failed:', err && err.message ? err.message : err)
      this.status.apps[candidate.id] = {
        ...(this.status.apps[candidate.id] || {}),
        state: "failed",
        error: err && err.message ? err.message : String(err || "Autolaunch failed")
      }
    })
  }
  async runScheduler() {
    const timeoutMs = 10 * 60 * 1000
    const pollMs = 1000
    const startedAt = Date.now()
    const candidates = await this.collectCandidates()
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    const cycleIds = this.findDependencyCycles(candidates)
    this.setStatus({
      running: true,
      started_at: startedAt,
      apps: {}
    })
    for (const candidate of candidates) {
      this.status.apps[candidate.id] = {
        id: candidate.id,
        title: candidate.title,
        script: candidate.script,
        state: "pending",
        dependencies: candidate.dependencies,
        waiting_for: candidate.dependencies
      }
      if (!candidate.exists) {
        this.status.apps[candidate.id].state = "failed"
        this.status.apps[candidate.id].error = "Autolaunch script does not exist"
        console.log("SCRIPT DOES NOT EXIST. Ignoring.", candidate.autolaunchPath)
      } else if (candidate.invalidDependencies.length > 0) {
        this.status.apps[candidate.id].state = "blocked"
        this.status.apps[candidate.id].waiting_for = candidate.invalidDependencies
        this.status.apps[candidate.id].error = "Unknown dependency"
      } else if (cycleIds.has(candidate.id)) {
        this.status.apps[candidate.id].state = "blocked"
        this.status.apps[candidate.id].error = "Dependency cycle"
      }
    }
    const pending = new Set(candidates
      .filter((candidate) => this.status.apps[candidate.id].state === "pending")
      .map((candidate) => candidate.id))
    const hasStartingApps = () => Object.values(this.status.apps || {}).some((status) => {
      return status && status.state === "starting"
    })
    while ((pending.size > 0 || hasStartingApps()) && Date.now() - startedAt < timeoutMs) {
      for (const [id, status] of Object.entries(this.status.apps || {})) {
        if (status && status.state === "starting") {
          const candidate = candidateMap.get(id)
          this.syncReadyState(id, candidate && candidate.autolaunchPath)
        }
      }
      for (const id of Array.from(pending)) {
        const candidate = candidateMap.get(id)
        if (!candidate) {
          pending.delete(id)
          continue
        }
        const blockedDependency = candidate.dependencies.find((dependency) => {
          const dependencyStatus = this.status.apps[dependency]
          return dependencyStatus && ["blocked", "failed", "timeout"].includes(dependencyStatus.state)
        })
        if (blockedDependency) {
          this.status.apps[id] = {
            ...(this.status.apps[id] || {}),
            state: "blocked",
            waiting_for: [blockedDependency],
            error: "Dependency failed"
          }
          pending.delete(id)
          continue
        }
        const waitingFor = []
        for (const dependency of candidate.dependencies) {
          const dependencyCandidate = candidateMap.get(dependency)
          if (!this.syncReadyState(dependency, dependencyCandidate && dependencyCandidate.autolaunchPath)) {
            waitingFor.push(dependency)
          }
        }
        if (waitingFor.length === 0) {
          this.launchCandidate(candidate)
          pending.delete(id)
        } else {
          this.status.apps[id] = {
            ...(this.status.apps[id] || {}),
            state: "waiting",
            waiting_for: waitingFor
          }
        }
      }
      if (pending.size > 0 || hasStartingApps()) {
        await new Promise((resolve) => setTimeout(resolve, pollMs))
      }
    }
    for (const id of pending) {
      this.status.apps[id] = {
        ...(this.status.apps[id] || {}),
        state: "timeout",
        error: "Timed out waiting for dependencies"
      }
    }
    for (const [id, status] of Object.entries(this.status.apps || {})) {
      if (status && status.state === "starting") {
        this.status.apps[id] = {
          ...status,
          state: "timeout",
          error: "Timed out waiting for app to become ready"
        }
      }
    }
    this.status.running = false
    this.status.completed_at = Date.now()
    setTimeout(() => {
      this.kernel.launch_complete = true
      console.log("SETTING launch complete", this.kernel.launch_complete)
    }, 2000)
  }
}

module.exports = Autolaunch
