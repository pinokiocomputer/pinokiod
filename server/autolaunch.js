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
    const value = typeof env.PINOKIO_SCRIPT_AUTOLAUNCH === "string"
      ? env.PINOKIO_SCRIPT_AUTOLAUNCH.trim()
      : ""
    const dependencies = this.parseDependencyValue(env[Environment.SCRIPT_AUTOLAUNCH_DEPENDS_KEY])
    const exists = await this.server.exists(envPath)
    return {
      appRoot,
      envRoot,
      envPath,
      envRelpath: gotRoot && gotRoot.relpath ? gotRoot.relpath : "",
      exists,
      value,
      dependencies,
      enabled: value.length > 0
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
      autolaunch: envInfo.value,
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

    if (envInfo.value) {
      await this.addCandidate(menuCandidates, seen, {
        script: envInfo.value,
        label: envInfo.value,
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
      current: envInfo.value
    }
  }
  async applyHomeStartingState(item, index) {
    let autolaunchInfo = null
    let autolaunchStatus = null
    if (!this.kernel.launch_complete) {
      try {
        autolaunchInfo = await this.getEnvInfo({ id: item.name })
        autolaunchStatus = this.kernel.autolaunch_status && this.kernel.autolaunch_status.apps
          ? this.kernel.autolaunch_status.apps[item.name]
          : null
      } catch (error) {
        console.warn("[home] failed to read autolaunch state", item.name, error && error.message ? error.message : error)
      }
    }
    if (!autolaunchInfo || !autolaunchInfo.enabled) {
      return false
    }
    const launchPath = path.resolve(autolaunchInfo.appRoot, autolaunchInfo.value)
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
    const configuredDependencies = Array.isArray(autolaunchInfo.dependencies) ? autolaunchInfo.dependencies : []
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
    item.autolaunch_blocked = autolaunchStatus && ["blocked", "failed", "timeout"].includes(autolaunchStatus.state)
    item.autolaunch_waiting = !item.autolaunch_blocked && waitingFor.length > 0
    item.autolaunch_status_label = item.autolaunch_blocked
      ? (autolaunchStatus.error || "Autolaunch blocked")
      : (item.autolaunch_waiting && waitingLabel ? waitingLabel : `Starting ${autolaunchInfo.value}${progressLabel}`)
    item.autolaunch_script = autolaunchInfo.value
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
      const normalized = this.normalizeDependencies(requestedDependencies, states, app.id)
      const initialized = await Environment.init({ name: app.id }, this.kernel)
      await Util.update_env(initialized.env_path, {
        [Environment.SCRIPT_AUTOLAUNCH_DEPENDS_KEY]: Environment.formatAutolaunchList(normalized)
      })
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
      if (!requestedScript) {
        const envInfo = await this.getEnvInfo(app)
        if (envInfo.exists) {
          await Util.update_env(envInfo.envPath, {
            PINOKIO_SCRIPT_AUTOLAUNCH: ""
          })
        }
        res.json({
          ok: true,
          app: await this.buildAppState(app)
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
        PINOKIO_SCRIPT_AUTOLAUNCH: resolved.script
      })
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
        if (envInfo.exists && envInfo.value) {
          await Util.update_env(envInfo.envPath, {
            PINOKIO_SCRIPT_AUTOLAUNCH: ""
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
