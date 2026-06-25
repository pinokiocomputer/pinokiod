const path = require('path')
const fs = require('fs')
const Environment = require('../kernel/environment')
const Util = require('../kernel/util')

const ex = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

const cloneWithFunctionRefs = (value, seen = new WeakMap()) => {
  if (value === null || typeof value !== "object") {
    return value
  }
  if (seen.has(value)) {
    return seen.get(value)
  }
  if (Array.isArray(value)) {
    const clone = []
    seen.set(value, clone)
    for (const entry of value) {
      clone.push(typeof entry === "function" ? entry : cloneWithFunctionRefs(entry, seen))
    }
    return clone
  }
  const clone = {}
  seen.set(value, clone)
  for (const key of Object.keys(value)) {
    const entry = value[key]
    clone[key] = typeof entry === "function" ? entry : cloneWithFunctionRefs(entry, seen)
  }
  return clone
}

const safeStructuredClone = (value) => {
  try {
    return structuredClone(value)
  } catch (error) {
    return cloneWithFunctionRefs(value)
  }
}

class ServerAutolaunch {
  constructor(server) {
    this.server = server
    this.kernel = server.kernel
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
  compareApps(a, b) {
    const aTitle = a && (a.title || a.name || a.id) ? (a.title || a.name || a.id) : ""
    const bTitle = b && (b.title || b.name || b.id) ? (b.title || b.name || b.id) : ""
    return String(aTitle).localeCompare(String(bTitle), undefined, { sensitivity: "base", numeric: true }) ||
      String((a && a.id) || "").localeCompare(String((b && b.id) || ""), undefined, { sensitivity: "base", numeric: true })
  }
  parseDependencyValue(value) {
    return Environment.parseAutolaunchList(value)
      .map((id) => this.normalizeAppId(id))
      .filter(Boolean)
  }
  normalizeDependencies(ids, apps, currentAppId) {
    const appList = Array.isArray(apps) ? apps : []
    const installedIds = new Set()
    for (const app of appList) {
      if (app && app.id) {
        installedIds.add(app.id)
      }
    }
    const seen = new Set()
    const normalized = []
    for (const id of Array.isArray(ids) ? ids : []) {
      const appId = this.normalizeAppId(id)
      if (!appId || appId === currentAppId || seen.has(appId)) {
        continue
      }
      if (!installedIds.has(appId)) {
        continue
      }
      seen.add(appId)
      normalized.push(appId)
    }
    return normalized
  }
  sortAppStates(states) {
    return states.slice().sort((a, b) => {
      const enabledDelta = Number(!!b.autolaunch_enabled) - Number(!!a.autolaunch_enabled)
      if (enabledDelta !== 0) {
        return enabledDelta
      }
      return this.compareApps(a, b)
    })
  }
  normalizeScriptPath(value) {
    if (typeof value !== "string") {
      return ""
    }
    let script = value.trim().replace(/\\/g, "/")
    if (!script || script.includes("\0")) {
      return ""
    }
    script = script.split("#")[0].split("?")[0].trim()
    if (!script || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(script) || script.startsWith("//")) {
      return ""
    }
    if (script.startsWith("/")) {
      return ""
    }
    const normalized = path.posix.normalize(script).replace(/^\.\/+/, "")
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      return ""
    }
    return normalized
  }
  isScriptFilename(filename) {
    const ext = path.extname(filename || "").toLowerCase()
    if (![".js", ".json", ".mjs", ".cjs"].includes(ext)) {
      return false
    }
    const base = path.basename(filename || "").toLowerCase()
    return !["package.json", "pinokio.js", "pinokio.json", "pinokio_meta.json"].includes(base)
  }
  stripLabel(value) {
    if (typeof value !== "string") {
      return ""
    }
    return value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
  async getAppById(appId) {
    const id = this.normalizeAppId(appId)
    if (!id) {
      return null
    }
    const apps = await this.kernel.api.listApps()
    return apps.find((app) => app && app.id === id) || null
  }
  async getEnvInfo(app) {
    const appRoot = path.resolve(this.kernel.api.userdir, app.id)
    const gotRoot = await Environment.get_root({ path: appRoot }, this.kernel)
    const envRoot = gotRoot && gotRoot.root ? gotRoot.root : appRoot
    const envPath = path.resolve(envRoot, "ENVIRONMENT")
    const env = await Util.parse_env(envPath)
    const value = Environment.getScriptAutolaunch(env)
    const launch = value
    const dependencies = Environment.getScriptRequirements(env)
    const enabled = Environment.getScriptAutolaunchEnabled(env)
    const exists = await this.server.exists(envPath)
    return {
      appRoot,
      envRoot,
      envPath,
      envRelpath: gotRoot && gotRoot.relpath ? gotRoot.relpath : "",
      exists,
      value,
      launch,
      dependencies,
      enabled
    }
  }
  async buildAppState(app) {
    const envInfo = await this.getEnvInfo(app)
    return {
      id: app.id,
      name: app.name,
      title: app.title || app.name || app.id,
      description: app.description || "",
      icon: app.icon || "/pinokio-black.png",
      workspace_path: app.workspace_path,
      launcher_path: app.launcher_path,
      launcher_root: app.launcher_root || "",
      env_path: envInfo.envPath,
      autolaunch: envInfo.launch,
      autolaunch_startup: envInfo.enabled ? envInfo.launch : "",
      autolaunch_depends: envInfo.dependencies,
      autolaunch_enabled: envInfo.enabled
    }
  }
  async buildAppsStateRaw() {
    const apps = await this.kernel.api.listApps()
    const states = []
    for (const app of apps) {
      states.push(await this.buildAppState(app))
    }
    return states
  }
  async buildAppsState() {
    const states = await this.buildAppsStateRaw()
    return this.sortAppStates(states)
  }
  async buildHomeStartupDisplayGraph() {
    if (this.kernel.launch_complete) {
      return new Map()
    }
    const states = await this.buildAppsStateRaw()
    const byId = new Map()
    for (const state of states) {
      if (state && state.id) {
        byId.set(state.id, state)
      }
    }
    const graph = new Map()
    const visited = new Set()
    const isCancelled = (appId) => {
      return !!(this.kernel.launchRequirements &&
        typeof this.kernel.launchRequirements.isCancelled === "function" &&
        this.kernel.launchRequirements.isCancelled(appId))
    }
    const addApp = (appId, startupRoot = false) => {
      const id = this.normalizeAppId(appId)
      if (!id || visited.has(id) || isCancelled(id)) {
        return
      }
      const state = byId.get(id)
      if (!state || !state.autolaunch) {
        return
      }
      visited.add(id)
      const dependencies = Array.isArray(state.autolaunch_depends)
        ? state.autolaunch_depends.map((dependencyId) => this.normalizeAppId(dependencyId)).filter(Boolean)
        : []
      graph.set(id, {
        id,
        title: state.title || state.name || id,
        script: state.autolaunch,
        dependencies,
        waiting_for: dependencies,
        startup_root: !!startupRoot
      })
      for (const dependencyId of dependencies) {
        addApp(dependencyId, false)
      }
    }
    for (const state of states) {
      if (state && state.autolaunch_enabled && state.autolaunch) {
        addApp(state.id, true)
      }
    }
    return graph
  }
  async buildDependencyOptions(appId, states = null) {
    const appStates = Array.isArray(states) ? states : await this.buildAppsStateRaw()
    return this.sortAppStates(appStates)
      .filter((app) => app && app.id !== appId)
      .map((app) => ({
        id: app.id,
        title: app.title || app.name || app.id,
        icon: app.icon || "/pinokio-black.png",
        workspace_path: app.workspace_path,
        launcher_path: app.launcher_path,
        autolaunch: app.autolaunch,
        autolaunch_enabled: !!app.autolaunch_enabled
      }))
  }
  async resolveScript(appRoot, script) {
    const normalized = this.normalizeScriptPath(script)
    if (!normalized || !this.isScriptFilename(normalized)) {
      return null
    }
    const scriptPath = path.resolve(appRoot, normalized)
    if (!this.server.is_subpath(appRoot, scriptPath)) {
      return null
    }
    let stat
    try {
      stat = await fs.promises.stat(scriptPath)
    } catch (_) {
      return null
    }
    if (!stat || !stat.isFile()) {
      return null
    }
    return {
      script: normalized,
      path: scriptPath
    }
  }
  flattenMenu(menu, trail = []) {
    const items = []
    if (!Array.isArray(menu)) {
      return items
    }
    for (const menuitem of menu) {
      if (!menuitem || typeof menuitem !== "object") {
        continue
      }
      const label = this.stripLabel(menuitem.text || menuitem.name || menuitem.html || "")
      const nextTrail = label ? trail.concat(label) : trail
      if (Array.isArray(menuitem.menu)) {
        items.push(...this.flattenMenu(menuitem.menu, nextTrail))
      } else {
        items.push({ item: menuitem, group: trail.join(" / ") })
      }
    }
    return items
  }
  async addCandidate(candidates, seen, candidate, appRoot) {
    const resolved = await this.resolveScript(appRoot, candidate.script)
    if (!resolved || seen.has(resolved.script)) {
      return null
    }
    seen.add(resolved.script)
    const label = this.stripLabel(candidate.label || "") || resolved.script
    const menuDefault = !!candidate.menu_default
    const item = {
      script: resolved.script,
      label,
      group: candidate.group || "",
      icon: candidate.icon || "",
      source: candidate.source || "local",
      menu_default: menuDefault,
      has_params: !!candidate.has_params
    }
    candidates.push(item)
    return item
  }
  async collectScriptFiles(root, appRoot) {
    const results = []
    const ignoredDirs = new Set([
      ".git",
      ".venv",
      "__pycache__",
      "app",
      "cache",
      "data",
      "env",
      "logs",
      "models",
      "node_modules",
      "output",
      "outputs",
      "venv"
    ])
    const maxResults = 500
    const walk = async (dir, depth) => {
      if (depth > 4 || results.length >= maxResults) {
        return
      }
      let entries
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch (_) {
        return
      }
      for (const entry of entries) {
        if (!entry || !entry.name || entry.name.includes("\0")) {
          continue
        }
        const fullPath = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            await walk(fullPath, depth + 1)
          }
          continue
        }
        if (!entry.isFile() || !this.isScriptFilename(entry.name)) {
          continue
        }
        if (!this.server.is_subpath(appRoot, fullPath)) {
          continue
        }
        const rel = path.relative(appRoot, fullPath).split(path.sep).join("/")
        results.push(rel)
      }
    }
    await walk(root, 0)
    results.sort((a, b) => a.localeCompare(b))
    return results
  }
  async buildCandidates(app) {
    const envInfo = await this.getEnvInfo(app)
    const appRoot = envInfo.appRoot
    const launcher = await this.kernel.api.launcher(app.id)
    const launcherRoot = launcher && launcher.launcher_root
      ? path.resolve(appRoot, launcher.launcher_root)
      : appRoot
    const menuCandidates = []
    const otherCandidates = []
    const seen = new Set()

    try {
      let config = await this.kernel.api.meta(app.id)
      config = await this.server.processMenu(app.id, safeStructuredClone(config || {}))
      const flat = this.flattenMenu(config && config.menu ? config.menu : [])
      for (const entry of flat) {
        const menuitem = entry.item
        if (!menuitem || typeof menuitem.href !== "string") {
          continue
        }
        let href = menuitem.href.trim()
        const apiPrefix = `/api/${app.id}/`
        if (href.startsWith(apiPrefix)) {
          href = href.slice(apiPrefix.length)
        } else if (href.startsWith("/")) {
          continue
        }
        const localScript = this.normalizeScriptPath(href)
        if (!localScript) {
          continue
        }
        const scriptPath = path.resolve(launcherRoot, localScript)
        if (!this.server.is_subpath(appRoot, scriptPath)) {
          continue
        }
        const script = path.relative(appRoot, scriptPath).split(path.sep).join("/")
        await this.addCandidate(menuCandidates, seen, {
          script,
          label: menuitem.text || menuitem.name || script,
          group: entry.group,
          icon: typeof menuitem.icon === "string" ? menuitem.icon : "",
          source: "menu",
          menu_default: !!menuitem.default,
          has_params: !!(menuitem.params && typeof menuitem.params === "object")
        }, appRoot)
      }
    } catch (error) {
      console.warn("[autolaunch] failed to resolve menu candidates", app.id, error && error.message ? error.message : error)
    }

    if (envInfo.launch) {
      await this.addCandidate(menuCandidates, seen, {
        script: envInfo.launch,
        label: envInfo.launch,
        source: "current"
      }, appRoot)
    }

    const localScripts = await this.collectScriptFiles(launcherRoot, appRoot)
    for (const script of localScripts) {
      await this.addCandidate(otherCandidates, seen, {
        script,
        label: script,
        source: "local"
      }, appRoot)
    }

    return {
      app: await this.buildAppState(app),
      dependency_apps: await this.buildDependencyOptions(app.id),
      launcher_root: path.relative(appRoot, launcherRoot).split(path.sep).join("/"),
      menu: menuCandidates,
      other: otherCandidates,
      current: envInfo.launch
    }
  }
  async applyHomeStartingState(item, index, homeStartupDisplayGraph = null) {
    let autolaunchInfo = null
    let autolaunchStatus = null
    let startupDisplayInfo = null
    const appId = this.normalizeAppId(item && (item.uri || item.name))
    if (!appId) {
      return false
    }
    try {
      autolaunchStatus = this.kernel.autolaunch_status && this.kernel.autolaunch_status.apps
        ? this.kernel.autolaunch_status.apps[appId]
        : null
      if (!this.kernel.launch_complete || autolaunchStatus) {
        autolaunchInfo = await this.getEnvInfo({ id: appId })
      }
    } catch (error) {
      console.warn("[home] failed to read autolaunch state", appId, error && error.message ? error.message : error)
    }
    if (!autolaunchStatus && !this.kernel.launch_complete) {
      const displayGraph = homeStartupDisplayGraph || await this.buildHomeStartupDisplayGraph()
      startupDisplayInfo = displayGraph && typeof displayGraph.get === "function"
        ? displayGraph.get(appId)
        : null
    }
    const ready = autolaunchStatus && autolaunchStatus.state === "ready"
    const hasActiveStatus = autolaunchStatus && !ready
    const hasConfiguredStartup = !this.kernel.launch_complete && autolaunchInfo && autolaunchInfo.enabled
    const hasStartupDisplayInfo = !this.kernel.launch_complete && !!startupDisplayInfo
    if (ready || (!hasActiveStatus && !hasConfiguredStartup && !hasStartupDisplayInfo)) {
      return false
    }
    const launchScript = (autolaunchStatus && autolaunchStatus.script) ||
      (startupDisplayInfo && startupDisplayInfo.script) ||
      (autolaunchInfo ? autolaunchInfo.value || autolaunchInfo.launch : "")
    const launchPath = autolaunchStatus && autolaunchStatus.launch_path
      ? autolaunchStatus.launch_path
      : (launchScript && autolaunchInfo ? path.resolve(autolaunchInfo.appRoot, launchScript) : "")
    const progress = autolaunchStatus && Number.isInteger(Number(autolaunchStatus.step_current)) && Number.isInteger(Number(autolaunchStatus.step_total))
      ? {
          step_current: Number(autolaunchStatus.step_current),
          step_total: Number(autolaunchStatus.step_total)
        }
      : (this.kernel && typeof this.kernel.getScriptProgress === "function" ? this.kernel.getScriptProgress(launchPath) : null)
    const progressLabel = progress && progress.step_total > 1
      ? ` (${progress.step_current}/${progress.step_total})`
      : ""
    const statusWaitingFor = autolaunchStatus && Array.isArray(autolaunchStatus.waiting_for) ? autolaunchStatus.waiting_for : []
    const configuredDependencies = startupDisplayInfo && Array.isArray(startupDisplayInfo.waiting_for)
      ? startupDisplayInfo.waiting_for
      : (autolaunchInfo && Array.isArray(autolaunchInfo.dependencies) ? autolaunchInfo.dependencies : [])
    const waitingFor = autolaunchStatus ? statusWaitingFor : configuredDependencies
    const waitingLabels = []
    for (const id of waitingFor) {
      const status = this.kernel.autolaunch_status && this.kernel.autolaunch_status.apps
        ? this.kernel.autolaunch_status.apps[id]
        : null
      if (status && status.title) {
        waitingLabels.push(status.title)
        continue
      }
      try {
        const dependencyLauncher = await this.kernel.api.launcher(id)
        waitingLabels.push(dependencyLauncher && dependencyLauncher.script && dependencyLauncher.script.title
          ? dependencyLauncher.script.title
          : id)
      } catch (_) {
        waitingLabels.push(id)
      }
    }
    const waitingLabel = waitingLabels.length > 0 ? `Waiting for ${waitingLabels.join(", ")}` : ""
    item.running = true
    item.autolaunch_starting = true
    item.autolaunch_blocked = autolaunchStatus && autolaunchStatus.state === "blocked"
    item.autolaunch_waiting = !item.autolaunch_blocked && waitingFor.length > 0
    item.autolaunch_status_label = item.autolaunch_blocked
      ? (autolaunchStatus.blocked_reason || "Startup blocked")
      : (item.autolaunch_waiting && waitingLabel ? waitingLabel : `Starting ${launchScript || "automatically"}${progressLabel}`)
    item.autolaunch_script = launchScript
    if (progress) {
      item.autolaunch_step_current = progress.step_current
      item.autolaunch_step_total = progress.step_total
    }
    item.index = index
    return true
  }
  registerRoutes() {
    this.server.app.get("/autolaunch/candidates", ex(async (req, res) => {
      const app = await this.getAppById(req.query.app)
      if (!app) {
        res.status(404).json({ ok: false, error: "App not found." })
        return
      }
      const state = await this.buildCandidates(app)
      res.json({ ok: true, ...state })
    }))
    this.server.app.post("/autolaunch/dependencies", ex(async (req, res) => {
      const app = await this.getAppById(req.body && req.body.app)
      if (!app) {
        res.status(404).json({ ok: false, error: "App not found." })
        return
      }
      const requestedDependencies = req.body && Array.isArray(req.body.dependencies) ? req.body.dependencies : null
      if (!requestedDependencies) {
        res.status(400).json({ ok: false, error: "Dependencies must be an array of app IDs." })
        return
      }
      const states = await this.buildAppsStateRaw()
      const installedIds = new Set(states.map((state) => state && state.id).filter(Boolean))
      const seen = new Set()
      const normalized = []
      for (const rawId of requestedDependencies) {
        const dependencyId = this.normalizeAppId(rawId)
        if (!dependencyId) {
          res.status(400).json({ ok: false, error: "Requirement app id is invalid." })
          return
        }
        if (dependencyId === app.id) {
          res.status(400).json({ ok: false, error: "An app cannot require itself." })
          return
        }
        if (seen.has(dependencyId)) {
          res.status(400).json({ ok: false, error: "Requirement app ids must be unique." })
          return
        }
        if (!installedIds.has(dependencyId)) {
          res.status(400).json({ ok: false, error: `Required app is not installed: ${dependencyId}` })
          return
        }
        seen.add(dependencyId)
        normalized.push(dependencyId)
      }
      if (normalized.length > 0) {
        const envInfo = await this.getEnvInfo(app)
        if (!envInfo.launch) {
          res.status(400).json({ ok: false, error: "Choose this app's launch script before adding requirements." })
          return
        }
        const stateById = new Map(states.map((state) => [state.id, state]))
        const missing = normalized
          .map((id) => stateById.get(id))
          .find((state) => !state || !state.autolaunch)
        if (missing) {
          res.status(400).json({
            ok: false,
            error: `Choose ${missing.title || missing.name || missing.id}'s launch script before adding it as a requirement.`
          })
          return
        }
      }
      const initialized = await Environment.init({ name: app.id }, this.kernel)
      await Util.update_env(initialized.env_path, {
        [Environment.SCRIPT_REQUIREMENTS_KEY]: Environment.formatAutolaunchList(normalized)
      })
      if (this.kernel && typeof this.kernel.clearLaunchRequirementsStatus === "function") {
        this.kernel.clearLaunchRequirementsStatus(app.id)
      }
      res.json({
        ok: true,
        app: await this.buildAppState(app)
      })
    }))
    this.server.app.post("/autolaunch", ex(async (req, res) => {
      const app = await this.getAppById(req.body && req.body.app)
      if (!app) {
        res.status(404).json({ ok: false, error: "App not found." })
        return
      }
      const requestedScript = typeof req.body.script === "string" ? req.body.script.trim() : ""
      const clearScript = !!(req.body && req.body.clear_script === true)
      const hasEnabled = req.body && typeof req.body.enabled === "boolean"
      if (!clearScript && requestedScript && !hasEnabled) {
        res.status(400).json({
          ok: false,
          error: "Startup enabled must be explicit when selecting a launch script."
        })
        return
      }
      const enabled = hasEnabled ? req.body.enabled : false
      if (clearScript) {
        const envInfo = await this.getEnvInfo(app)
        if (envInfo.dependencies && envInfo.dependencies.length > 0) {
          res.status(400).json({
            ok: false,
            error: "Remove requirements before clearing this app's launch script."
          })
          return
        }
        if (envInfo.exists) {
          await Util.update_env(envInfo.envPath, {
            [Environment.SCRIPT_AUTOLAUNCH_KEY]: "",
            [Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY]: ""
          })
        }
        if (this.kernel && typeof this.kernel.clearLaunchRequirementsStatus === "function") {
          this.kernel.clearLaunchRequirementsStatus(app.id)
        }
        res.json({
          ok: true,
          app: await this.buildAppState(app)
        })
        return
      }
      if (!requestedScript) {
        res.status(400).json({
          ok: false,
          error: "Use clear_script: true to clear this app's launch script."
        })
        return
      }

      const envInfo = await this.getEnvInfo(app)
      const resolved = await this.resolveScript(envInfo.appRoot, requestedScript)
      if (!resolved) {
        res.status(400).json({
          ok: false,
          error: "Select an existing local script inside the app."
        })
        return
      }
      const initialized = await Environment.init({ name: app.id }, this.kernel)
      await Util.update_env(initialized.env_path, {
        [Environment.SCRIPT_AUTOLAUNCH_KEY]: resolved.script,
        [Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY]: enabled ? "true" : "false"
      })
      if (this.kernel && typeof this.kernel.clearLaunchRequirementsStatus === "function") {
        this.kernel.clearLaunchRequirementsStatus(app.id)
      }
      res.json({
        ok: true,
        app: await this.buildAppState(app)
      })
    }))
    this.server.app.post("/autolaunch/disable-all", ex(async (req, res) => {
      const apps = await this.kernel.api.listApps()
      let disabled = 0
      for (const app of apps) {
        const envInfo = await this.getEnvInfo(app)
        if (envInfo.exists && envInfo.enabled) {
          await Util.update_env(envInfo.envPath, {
            [Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY]: "false"
          })
          disabled++
        }
      }
      res.json({
        ok: true,
        disabled,
        apps: await this.buildAppsState()
      })
    }))
    this.server.app.get("/autolaunch", ex(async (req, res) => {
      const peerAccess = await this.server.composePeerAccessPayload()
      const list = this.server.getPeers()
      const apps = await this.buildAppsState()
      const appsJson = JSON.stringify(apps).replace(/</g, "\\u003c")
      res.render("autolaunch", {
        current_host: this.kernel.peer.host,
        ...peerAccess,
        apps,
        appsJson,
        enabledCount: apps.filter((app) => app.autolaunch_enabled).length,
        portal: this.server.portal,
        logo: this.server.logo,
        theme: this.server.theme,
        agent: req.agent,
        list,
      })
    }))
  }
}

module.exports = ServerAutolaunch
