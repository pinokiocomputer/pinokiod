const path = require('path')
const Environment = require('./environment')

class Autolaunch {
  constructor(kernel) {
    this.kernel = kernel
    this.kernel.autolaunch_status = this.startupStatus()
  }
  startupStatus() {
    return this.kernel.launchRequirements && typeof this.kernel.launchRequirements.startupHomeStatus === "function"
      ? this.kernel.launchRequirements.startupHomeStatus()
      : (this.kernel.autolaunch_status || { running: false, apps: {} })
  }
  setStatus(status) {
    const nextStatus = this.kernel.launchRequirements && typeof this.kernel.launchRequirements.replaceStartupHomeStatus === "function"
      ? this.kernel.launchRequirements.replaceStartupHomeStatus(status)
      : status
    this.kernel.autolaunch_status = nextStatus
    return nextStatus
  }
  async collectCandidates() {
    const apis = this.kernel.i && Array.isArray(this.kernel.i.api) ? this.kernel.i.api : []
    const candidates = []
    for (const api of apis) {
      if (!api || !api.path) {
        continue
      }
      const envPath = path.resolve(this.kernel.api.userdir, api.path)
      const env = await Environment.get(envPath, this.kernel)
      const script = Environment.getScriptAutolaunch(env)
      if (!script || !Environment.getScriptAutolaunchEnabled(env)) {
        continue
      }
      const autolaunchPath = path.resolve(this.kernel.api.userdir, api.path, script)
      const exists = !!(autolaunchPath && await this.kernel.exists(autolaunchPath))
      const dependencies = Environment.getScriptRequirements(env)
      candidates.push({
        id: api.path,
        title: api.title || api.path,
        script,
        autolaunchPath,
        dependencies,
        exists
      })
    }
    return candidates
  }
  async runScheduler() {
    const startedAt = Date.now()
    const candidates = await this.collectCandidates()
    const status = this.kernel.launchRequirements && typeof this.kernel.launchRequirements.seedStartupHomeStatus === "function"
      ? await this.kernel.launchRequirements.seedStartupHomeStatus(candidates, startedAt)
      : this.setStatus({
          running: true,
          started_at: startedAt,
          apps: {}
        })
    this.kernel.autolaunch_status = status
    for (const candidate of candidates) {
      if (!status.apps[candidate.id]) {
        status.apps[candidate.id] = {
          id: candidate.id,
          title: candidate.title,
          script: candidate.script,
          launch_path: candidate.autolaunchPath,
          state: "pending",
          dependencies: candidate.dependencies,
          waiting_for: candidate.dependencies,
          startup_root: true
        }
      }
      if (!candidate.exists) {
        status.apps[candidate.id].state = "blocked"
        status.apps[candidate.id].blocked_reason = candidate.script ? "Launch script does not exist" : "No launch script selected"
        status.apps[candidate.id].waiting_for = []
      }
      status.apps[candidate.id].startup_root = true
    }
    const launchable = candidates.filter((candidate) => {
      const row = status.apps[candidate.id]
      if (!row || !candidate.exists) {
        if (!candidate.exists) {
          console.log("SCRIPT DOES NOT EXIST. Ignoring.", candidate.autolaunchPath)
        }
        return false
      }
      return row.state !== "blocked"
    })
    await Promise.all(launchable.map((candidate) => {
      return this.kernel.api.process({
        uri: candidate.autolaunchPath,
        input: {},
        startup: true
      }).catch((err) => {
        console.warn('[Kernel.init] startup process failed:', err && err.message ? err.message : err)
        const row = status.apps[candidate.id]
        if (row && row.state !== "ready") {
          delete status.apps[candidate.id]
        }
      })
    }))
    status.running = false
    status.completed_at = Date.now()
    setTimeout(() => {
      this.kernel.launch_complete = true
      console.log("SETTING launch complete", this.kernel.launch_complete)
    }, 2000)
  }
}

module.exports = Autolaunch
