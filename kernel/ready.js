const path = require('path')

class ReadyState {
  constructor(kernel) {
    this.kernel = kernel
    this.status = {
      apps: {}
    }
  }
  normalizeAppId(value) {
    if (typeof value !== "string") {
      return ""
    }
    const id = value.trim()
    if (!id || id === "." || id === ".." || id.includes("\0") || /[\\/]/.test(id)) {
      return ""
    }
    return id
  }
  getAppIdForLaunchPath(launchPath) {
    if (!launchPath || typeof launchPath !== "string" || !path.isAbsolute(launchPath)) {
      return ""
    }
    const apiRoot = this.kernel.path("api")
    const relative = path.relative(apiRoot, launchPath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return ""
    }
    return this.normalizeAppId(relative.split(path.sep)[0])
  }
  getAppRelativeLaunchScript(appId, launchPath) {
    const id = this.normalizeAppId(appId)
    if (!id || !launchPath || typeof launchPath !== "string" || !path.isAbsolute(launchPath)) {
      return ""
    }
    const appRoot = path.resolve(this.kernel.path("api"), id)
    const relative = path.relative(appRoot, launchPath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return ""
    }
    return relative.split(path.sep).join("/")
  }
  resolveScriptPath(uri, cwd) {
    if (typeof uri !== "string" || !uri.trim() || !this.kernel.api) {
      return ""
    }
    try {
      return this.kernel.api.filePath(uri.trim(), cwd)
    } catch (e) {
      return ""
    }
  }
  isScriptReady(scriptPath) {
    if (!scriptPath || typeof scriptPath !== "string") {
      return false
    }
    const resolved = path.resolve(scriptPath)
    const appId = this.getAppIdForLaunchPath(resolved)
    if (!appId) {
      return false
    }
    const status = this.status && this.status.apps
      ? this.status.apps[appId]
      : null
    if (!status) {
      return false
    }
    const script = this.getAppRelativeLaunchScript(appId, resolved)
    const scriptStatus = status.scripts ? status.scripts[script] : null
    if (scriptStatus) {
      return scriptStatus.state === "ready"
    }
    return status.state === "ready" && (!status.script || status.script === script)
  }
  ready(requestOrUri) {
    if (typeof requestOrUri === "string") {
      return this.isScriptReady(this.resolveScriptPath(requestOrUri))
    }
    const params = requestOrUri && requestOrUri.params
    const parent = requestOrUri && requestOrUri.parent && typeof requestOrUri.parent === "object"
      ? requestOrUri.parent
      : null
    let uri = ""
    if (typeof params === "string") {
      uri = params
    } else if (params && typeof params === "object") {
      uri = params.uri || params.path || params.script || ""
    } else if (parent && parent.path) {
      uri = parent.path
    }
    return this.isScriptReady(this.resolveScriptPath(uri, requestOrUri && requestOrUri.cwd))
  }
  getScriptProgress(scriptPath) {
    if (!scriptPath || typeof scriptPath !== "string") {
      return null
    }
    const resolved = path.resolve(scriptPath)
    const rpc = this.kernel.memory && this.kernel.memory.rpc
      ? this.kernel.memory.rpc[resolved]
      : null
    if (!rpc || typeof rpc !== "object") {
      return null
    }
    const current = Number(rpc.current)
    const total = Number(rpc.total)
    if (!Number.isInteger(current) || !Number.isInteger(total) || total <= 0) {
      return null
    }
    return {
      step_current: Math.max(1, current + 1),
      step_total: total
    }
  }
  updateLaunchStatus(launchPath, state, details) {
    const appId = this.getAppIdForLaunchPath(launchPath)
    if (!appId) {
      return
    }
    const script = this.getAppRelativeLaunchScript(appId, launchPath)
    const current = this.status.apps[appId] || { id: appId, scripts: {} }
    const scripts = { ...(current.scripts || {}) }
    if (script) {
      scripts[script] = {
        ...(scripts[script] || { script }),
        script,
        state,
        ...details
      }
    }
    this.status.apps[appId] = {
      ...current,
      id: appId,
      state,
      script: script || current.script,
      ...details,
      scripts
    }
  }
  markStarted(launchPath) {
    this.updateLaunchStatus(launchPath, "starting", {
      started_at: Date.now()
    })
  }
  markProgress(launchPath, current, total) {
    const stepCurrent = Number(current)
    const stepTotal = Number(total)
    if (!Number.isInteger(stepCurrent) || !Number.isInteger(stepTotal) || stepTotal <= 0) {
      return null
    }
    const progress = {
      step_current: Math.max(1, stepCurrent + 1),
      step_total: stepTotal
    }
    this.updateLaunchStatus(launchPath, "starting", progress)
    return progress
  }
  markReady(launchPath) {
    this.updateLaunchStatus(launchPath, "ready", {
      ready_at: Date.now()
    })
  }
  markFailed(launchPath, error) {
    this.updateLaunchStatus(launchPath, "failed", {
      error: error && error.message ? error.message : String(error || "Launch failed"),
      failed_at: Date.now()
    })
  }
  markStopped(launchPath) {
    this.updateLaunchStatus(launchPath, "stopped", {
      stopped_at: Date.now()
    })
  }
  isAppReady(appId) {
    const dependencyId = this.normalizeAppId(appId)
    const status = this.status && this.status.apps
      ? this.status.apps[dependencyId]
      : null
    if (!status) {
      return false
    }
    if (status.scripts && Object.values(status.scripts).some((script) => script && script.state === "ready")) {
      return true
    }
    return status.state === "ready"
  }
}

module.exports = ReadyState
