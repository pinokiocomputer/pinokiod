const path = require('path')
const Environment = require('./environment')

class LaunchRequirements {
  constructor(kernel) {
    this.kernel = kernel
    this.status = {
      targets: {},
      startup: {
        running: false,
        apps: {}
      }
    }
    this.cancelled = new Set()
    this.inflightStarts = new Map()
    this.activeLaunches = new Map()
    this.activeLaunchCounter = 0
  }
  normalizeAppId(value) {
    return this.kernel && typeof this.kernel.normalizeAppId === "function"
      ? this.kernel.normalizeAppId(value)
      : ""
  }
  blocked(reason, extra = {}) {
    const error = new Error(reason)
    error.blocked_reason = reason
    Object.assign(error, extra)
    return error
  }
  cancelledError(appId) {
    const error = new Error("Launch cancelled")
    error.cancelled = true
    error.app_id = appId
    return error
  }
  controlResult(action, extra = {}) {
    return {
      action,
      ...extra
    }
  }
  blockedResult(errorOrReason, extra = {}) {
    const reason = errorOrReason && errorOrReason.blocked_reason
      ? errorOrReason.blocked_reason
      : String(errorOrReason || "Launch requirements blocked")
    return this.controlResult("blocked", {
      reason,
      blocked_reason: reason,
      app_id: errorOrReason && errorOrReason.app_id ? errorOrReason.app_id : extra.app_id,
      ...extra
    })
  }
  cancelledResult(appId) {
    const id = this.normalizeAppId(appId)
    if (id) {
      this.clearAttemptStartupStatus(id)
    }
    return this.controlResult("cancelled", { app_id: id || appId })
  }
  handledResult(appId, status) {
    return this.controlResult("handled", {
      app_id: appId,
      state: status && status.state ? status.state : ""
    })
  }
  resultFromError(error, fallbackAppId = "") {
    if (error && error.cancelled) {
      return this.cancelledResult(error.app_id || fallbackAppId)
    }
    if (error && error.blocked_reason) {
      return this.blockedResult(error, { app_id: error.app_id || fallbackAppId })
    }
    return null
  }
  statusChannel(appId) {
    const id = this.normalizeAppId(appId)
    return id ? `kernel.launch_requirements:${id}` : ""
  }
  emitStatus(appId) {
    const channel = this.statusChannel(appId)
    if (!channel || !this.kernel || !this.kernel.api || typeof this.kernel.api.ondata !== "function") {
      return
    }
    this.kernel.api.ondata({
      id: channel,
      kernel: true,
      type: "launch.requirements",
      data: {
        status: this.getStatus(appId)
      }
    })
  }
  activePreparationStates() {
    return new Set(["pending", "waiting", "starting", "blocked"])
  }
  beginLaunchOperation(launchPath, meta = {}) {
    if (!launchPath || typeof launchPath !== "string") {
      return null
    }
    const key = path.resolve(launchPath)
    const token = {
      id: ++this.activeLaunchCounter,
      key,
      started_at: Date.now(),
      ...meta
    }
    if (!this.activeLaunches.has(key)) {
      this.activeLaunches.set(key, new Set())
    }
    this.activeLaunches.get(key).add(token)
    return token
  }
  endLaunchOperation(token) {
    if (!token || !token.key || !this.activeLaunches.has(token.key)) {
      return false
    }
    const active = this.activeLaunches.get(token.key)
    active.delete(token)
    if (active.size === 0) {
      this.activeLaunches.delete(token.key)
    }
    return true
  }
  hasActiveLaunch(config, owner) {
    const key = this.inflightKey(config)
    if (!key || !this.activeLaunches.has(key)) {
      return false
    }
    const active = this.activeLaunches.get(key)
    for (const token of active) {
      if (token !== owner) {
        return true
      }
    }
    return false
  }
  startupHomeStatus() {
    if (!this.status.startup || !this.status.startup.apps) {
      this.status.startup = {
        running: false,
        apps: {}
      }
    }
    return this.status.startup
  }
  replaceStartupHomeStatus(status) {
    this.status.startup = {
      running: !!(status && status.running),
      ...(status || {}),
      apps: status && status.apps ? status.apps : {}
    }
    return this.startupHomeStatus()
  }
  markStartupStarted(appId) {
    const id = this.normalizeAppId(appId)
    const startupStatus = this.startupHomeStatus()
    const status = id && startupStatus.apps ? startupStatus.apps[id] : null
    if (!status || status.state === "blocked") {
      return
    }
    startupStatus.apps[id] = {
      ...this.stripProgress(status),
      state: "starting",
      started_at: status.started_at || Date.now(),
      waiting_for: [],
      process_started: true
    }
  }
  markStartupReady(appId) {
    const id = this.normalizeAppId(appId)
    const startupStatus = this.startupHomeStatus()
    const status = id && startupStatus.apps ? startupStatus.apps[id] : null
    if (!status || status.state === "blocked") {
      return
    }
    startupStatus.apps[id] = {
      ...this.stripProgress(status),
      state: "ready",
      ready_at: status.ready_at || Date.now(),
      waiting_for: [],
      process_started: true
    }
  }
  markStartupStopped(appId) {
    const id = this.normalizeAppId(appId)
    const startupStatus = this.startupHomeStatus()
    const status = id && startupStatus.apps ? startupStatus.apps[id] : null
    if (!status) {
      return
    }
    delete startupStatus.apps[id]
  }
  activeTargetStatus(appId, launchPath) {
    const id = this.normalizeAppId(appId)
    const target = id ? this.status.targets[id] : null
    const activeStates = this.activePreparationStates()
    if (!target || !activeStates.has(target.state) || !launchPath || !target.launch_path) {
      return null
    }
    return path.resolve(target.launch_path) === path.resolve(launchPath) ? target : null
  }
  hasRuntimeForLaunchPath(launchPath) {
    const targetInfo = this.targetForLaunchPath(launchPath)
    if (!targetInfo || !targetInfo.appId) {
      return false
    }
    const appId = targetInfo.appId
    if (this.status.targets[appId]) {
      return true
    }
    for (const targetId of Object.keys(this.status.targets)) {
      if (this.referencesApp(this.status.targets[targetId], appId)) {
        return true
      }
    }
    const startupApps = this.status.startup && this.status.startup.apps ? this.status.startup.apps : {}
    if (startupApps[appId]) {
      return true
    }
    return Object.keys(startupApps).some((statusId) => this.referencesApp(startupApps[statusId], appId))
  }
  async appMap() {
    const apps = this.kernel && this.kernel.api && typeof this.kernel.api.listApps === "function"
      ? await this.kernel.api.listApps()
      : []
    return new Map(apps
      .filter((app) => app && app.id)
      .map((app) => [app.id, app]))
  }
  async configFor(appId, apps, override = {}) {
    const id = this.normalizeAppId(appId)
    if (!id || !apps.has(id)) {
      return null
    }
    const app = apps.get(id)
    const appRoot = path.resolve(this.kernel.api.userdir, id)
    const env = await Environment.get(appRoot, this.kernel)
    const configuredLaunchScript = typeof env.PINOKIO_SCRIPT_AUTOLAUNCH === "string"
      ? env.PINOKIO_SCRIPT_AUTOLAUNCH.trim()
      : ""
    const launchScript = typeof override.launchScript === "string"
      ? override.launchScript.trim()
      : configuredLaunchScript
    const launchPath = typeof override.launchPath === "string" && override.launchPath
      ? path.resolve(override.launchPath)
      : (launchScript ? path.resolve(appRoot, launchScript) : "")
    const dependencies = Environment.getScriptRequirements(env)
      .map((dependencyId) => this.normalizeAppId(dependencyId))
      .filter((dependencyId, index, list) => dependencyId && dependencyId !== id && list.indexOf(dependencyId) === index)
    return {
      id,
      title: app.title || app.name || id,
      icon: app.icon || "/pinokio-black.png",
      appRoot,
      launchScript,
      configuredLaunchScript,
      launchPath,
      dependencies,
      startup_root: !!override.startup_root
    }
  }
  shouldPrepareLaunchPath(config, requestedScript) {
    if (!config || !requestedScript || !Array.isArray(config.dependencies) || config.dependencies.length === 0) {
      return false
    }
    return !!(config.configuredLaunchScript && requestedScript === config.configuredLaunchScript)
  }
  isReady(config) {
    return !!(config && config.launchPath && this.kernel && typeof this.kernel.isScriptReady === "function" && this.kernel.isScriptReady(config.launchPath))
  }
  isRunning(config) {
    return !!(config && config.launchPath && this.kernel && this.kernel.api && this.kernel.api.running && this.kernel.api.running[config.launchPath])
  }
  inflightKey(config) {
    return config && config.launchPath ? path.resolve(config.launchPath) : ""
  }
  targetForLaunchPath(launchPath) {
    if (!launchPath || !this.kernel || typeof this.kernel.getAppIdForLaunchPath !== "function") {
      return null
    }
    const appId = this.kernel.getAppIdForLaunchPath(launchPath)
    if (!appId) {
      return null
    }
    return {
      appId,
      script: typeof this.kernel.getAppRelativeLaunchScript === "function"
        ? this.kernel.getAppRelativeLaunchScript(appId, launchPath)
        : "",
      launchPath
    }
  }
  scriptProgress(config) {
    if (!config || (!this.isRunning(config) && !this.hasActiveLaunch(config) && !this.inflightStarts.has(this.inflightKey(config)))) {
      return null
    }
    return config && config.launchPath && this.kernel && typeof this.kernel.getScriptProgress === "function"
      ? this.kernel.getScriptProgress(config.launchPath)
      : null
  }
  stripProgress(row = {}) {
    const next = { ...row }
    delete next.step_current
    delete next.step_total
    return next
  }
  ownerIds(row = {}) {
    const ids = []
    const add = (value) => {
      const id = this.normalizeAppId(value)
      if (id && !ids.includes(id)) {
        ids.push(id)
      }
    }
    if (Array.isArray(row.owner_app_ids)) {
      row.owner_app_ids.forEach(add)
    }
    add(row.owner_app_id)
    return ids
  }
  mergeOwnerIds(current = {}, extra = {}) {
    const ids = this.ownerIds(current)
    const add = (value) => {
      const id = this.normalizeAppId(value)
      if (id && !ids.includes(id)) {
        ids.push(id)
      }
    }
    if (Array.isArray(extra.owner_app_ids)) {
      extra.owner_app_ids.forEach(add)
    }
    add(extra.owner_app_id)
    return ids
  }
  rowIsReady(row = {}) {
    return !!(
      row.launch_path &&
      this.kernel &&
      typeof this.kernel.isScriptReady === "function" &&
      this.kernel.isScriptReady(row.launch_path)
    )
  }
  rowIsRunning(row = {}) {
    if (!row.launch_path || !this.kernel || !this.kernel.api || !this.kernel.api.running) {
      return false
    }
    return !!this.kernel.api.running[path.resolve(row.launch_path)]
  }
  rowHasRealLifecycle(row = {}) {
    return !!(this.rowIsRunning(row) || this.rowIsReady(row))
  }
  lifecycleRow(row = {}) {
    const next = this.stripProgress(row)
    delete next.owner_app_id
    delete next.owner_app_ids
    next.waiting_for = []
    if (this.rowIsReady(row)) {
      next.state = "ready"
      next.ready_at = next.ready_at || Date.now()
      next.process_started = true
    } else {
      next.state = "starting"
      next.process_started = true
    }
    return next
  }
  clearAttemptStartupStatus(ownerAppId) {
    const ownerId = this.normalizeAppId(ownerAppId)
    const startupStatus = this.startupHomeStatus()
    const apps = startupStatus && startupStatus.apps ? startupStatus.apps : null
    if (!ownerId || !apps) {
      return
    }
    for (const appId of Object.keys(apps)) {
      const row = apps[appId]
      const owners = this.ownerIds(row)
      if (appId === ownerId) {
        delete apps[appId]
        continue
      }
      if (!owners.includes(ownerId)) {
        continue
      }
      const remainingOwners = owners.filter((id) => id !== ownerId)
      if (this.rowHasRealLifecycle(row)) {
        const next = this.lifecycleRow(row)
        if (remainingOwners.length > 0) {
          next.owner_app_ids = remainingOwners
        }
        apps[appId] = next
        continue
      }
      if (remainingOwners.length > 0) {
        apps[appId] = {
          ...row,
          owner_app_ids: remainingOwners
        }
        delete apps[appId].owner_app_id
        continue
      }
      delete apps[appId]
    }
  }
  makeRow(config, state, extra = {}) {
    return {
      id: config.id,
      title: config.title,
      icon: config.icon,
      script: config.launchScript,
      launch_path: config.launchPath,
      state,
      ...(this.scriptProgress(config) || {}),
      ...extra
    }
  }
  setRequirementRow(targetId, config, state, extra = {}) {
    const target = this.status.targets[targetId]
    if (!target || !config || config.id === targetId) {
      return
    }
    if (!target.requirement_order.includes(config.id)) {
      target.requirement_order.push(config.id)
    }
    target.requirements[config.id] = {
      ...this.stripProgress(target.requirements[config.id] || {}),
      ...this.makeRow(config, state, extra)
    }
    this.emitStatus(targetId)
  }
  setTargetStatus(config, state, extra = {}) {
    if (!config || !config.id) {
      return null
    }
    const current = this.status.targets[config.id] || {}
    const target = {
      ...this.stripProgress(current),
      app_id: config.id,
      title: config.title,
      script: config.launchScript,
      launch_path: config.launchPath,
      state,
      started_at: current.started_at || Date.now(),
      requirements: current.requirements || {},
      requirement_order: Array.isArray(current.requirement_order) ? current.requirement_order : [],
      waiting_for: Array.isArray(current.waiting_for) ? current.waiting_for : [],
      ...extra
    }
    this.status.targets[config.id] = target
    this.emitStatus(config.id)
    return target
  }
  seedTargetRequirements(targetConfig, requirementIds, configs) {
    const target = this.status.targets[targetConfig.id]
    if (!target) {
      return
    }
    const ids = Array.isArray(requirementIds) ? requirementIds.filter((id) => id && id !== targetConfig.id) : []
    target.requirements = {}
    target.requirement_order = ids
    target.waiting_for = ids
    for (const id of ids) {
      const config = configs && typeof configs.get === "function" ? configs.get(id) : null
      if (config) {
        this.setRequirementRow(targetConfig.id, config, this.isReady(config) ? "ready" : "waiting")
      }
    }
    this.emitStatus(targetConfig.id)
  }
  async markBlockedTarget(targetConfig, error, apps, knownConfigs = []) {
    const blocked_reason = error && error.blocked_reason ? error.blocked_reason : String(error || "Launch requirements blocked")
    const target = this.setTargetStatus(targetConfig, "blocked", {
      blocked_reason,
      startup: !!targetConfig.startup_root
    })
    const blockedId = this.normalizeAppId(error && error.app_id)
    if (!target || !blockedId || blockedId === targetConfig.id) {
      return blocked_reason
    }
    const partialConfigs = error && error.configs && typeof error.configs.get === "function" ? error.configs : null
    const known = new Map((Array.isArray(knownConfigs) ? knownConfigs : [])
      .filter((config) => config && config.id)
      .map((config) => [config.id, config]))
    const chain = Array.isArray(error && error.chain)
      ? error.chain.filter((id) => id && id !== targetConfig.id)
      : []
    const orderedChain = chain.slice().reverse()
    if (chain.length > 0) {
      target.requirement_order = orderedChain
    }
    for (const chainId of orderedChain) {
      if (chainId === blockedId) {
        continue
      }
      const chainConfig = known.get(chainId) || (partialConfigs ? partialConfigs.get(chainId) : null)
      if (chainConfig) {
        this.setRequirementRow(targetConfig.id, chainConfig, "waiting", {
          waiting_for: [blockedId]
        })
      }
    }
    let blockedConfig = known.get(blockedId) || (partialConfigs ? partialConfigs.get(blockedId) : null)
    if (!blockedConfig) {
      blockedConfig = await this.configFor(blockedId, apps).catch(() => null)
    }
    if (blockedConfig) {
      this.setRequirementRow(targetConfig.id, blockedConfig, "blocked", { blocked_reason })
      target.waiting_for = [blockedConfig.id]
    }
    return blocked_reason
  }
  setStartupRow(status, config, state, extra = {}) {
    if (!status || !status.apps || !config) {
      return
    }
    const current = status.apps[config.id] || {}
    const row = {
      ...this.stripProgress(current),
      ...this.makeRow(config, state, extra),
      dependencies: config.dependencies,
      startup_root: !!(current.startup_root || config.startup_root)
    }
    const ownerIds = this.mergeOwnerIds(current, extra)
    delete row.owner_app_id
    if (ownerIds.length > 0) {
      row.owner_app_ids = ownerIds
    } else {
      delete row.owner_app_ids
    }
    status.apps[config.id] = row
  }
  async seedStartupHomeStatus(candidates, startedAt = Date.now()) {
    const status = this.replaceStartupHomeStatus({
      running: true,
      started_at: startedAt,
      apps: {}
    })
    const apps = await this.appMap()
    const configs = new Map()
    const visiting = new Set()
    const visited = new Set()

    const configForCandidate = async (candidate) => {
      const config = await this.configFor(candidate.id, apps, {
        launchScript: candidate.script,
        launchPath: candidate.autolaunchPath,
        startup_root: true
      })
      if (config) {
        configs.set(config.id, config)
      }
      return config
    }

    const dependencyConfig = async (dependencyId) => {
      const id = this.normalizeAppId(dependencyId)
      if (!id) {
        return null
      }
      if (configs.has(id)) {
        return configs.get(id)
      }
      const config = await this.configFor(id, apps)
      if (config) {
        configs.set(id, config)
      }
      return config
    }

    const setMissingDependency = (id, reason, ownerId) => {
      if (!id || status.apps[id]) {
        return
      }
      status.apps[id] = {
        id,
        title: id,
        icon: "/pinokio-black.png",
        script: "",
        launch_path: "",
        state: "blocked",
        blocked_reason: reason,
        dependencies: [],
        waiting_for: [],
        startup_root: false,
        owner_app_ids: ownerId ? [ownerId] : []
      }
    }

    const seedConfig = async (config, ownerId) => {
      if (!config || visited.has(config.id)) {
        return
      }
      if (visiting.has(config.id)) {
        this.setStartupRow(status, config, "blocked", {
          blocked_reason: `Requirement cycle detected at ${config.title || config.id}`,
          waiting_for: [],
          owner_app_id: ownerId
        })
        return
      }
      visiting.add(config.id)
      for (const dependencyId of config.dependencies) {
        const dependency = await dependencyConfig(dependencyId)
        if (dependency) {
          await seedConfig(dependency, ownerId)
        } else {
          setMissingDependency(dependencyId, `Required app is not installed: ${dependencyId}`, ownerId)
        }
      }
      visiting.delete(config.id)
      visited.add(config.id)

      const waitingFor = config.dependencies.filter((dependencyId) => {
        const row = status.apps[dependencyId]
        return !row || row.state !== "ready"
      })
      const missingLaunchScript = !config.launchScript || !config.launchPath
      const state = missingLaunchScript
        ? "blocked"
        : (this.isReady(config) ? "ready" : (waitingFor.length > 0 ? "waiting" : "pending"))
      this.setStartupRow(status, config, state, {
        waiting_for: state === "blocked" ? [] : waitingFor,
        owner_app_id: ownerId,
        process_started: this.isRunning(config) || this.isReady(config),
        ...(missingLaunchScript ? { blocked_reason: `${config.title || config.id} has no launch script selected` } : {})
      })
    }

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const config = await configForCandidate(candidate)
      if (!config) {
        status.apps[candidate.id] = {
          id: candidate.id,
          title: candidate.title || candidate.id,
          script: candidate.script || "",
          launch_path: candidate.autolaunchPath || "",
          state: "blocked",
          blocked_reason: "Startup app is not installed",
          dependencies: [],
          waiting_for: [],
          startup_root: true
        }
        continue
      }
      await seedConfig(config, config.id)
      const row = status.apps[config.id]
      if (!candidate.exists && row) {
        status.apps[config.id] = {
          ...row,
          state: "blocked",
          blocked_reason: config.launchScript ? "Launch script does not exist" : "No launch script selected",
          waiting_for: []
        }
      }
    }

    return status
  }
  checkCancelled(targetId) {
    if (targetId && this.cancelled.has(targetId)) {
      throw this.cancelledError(targetId)
    }
  }
  isCancelled(appId) {
    const id = this.normalizeAppId(appId)
    return !!(id && this.cancelled.has(id))
  }
  cancel(launchPath, options = {}) {
    const targetInfo = this.targetForLaunchPath(launchPath)
    if (!targetInfo) {
      return false
    }
    const target = this.status.targets[targetInfo.appId]
    if (!target) {
      if (options && options.force) {
        this.cancelled.add(targetInfo.appId)
        this.clearAttemptStartupStatus(targetInfo.appId)
        this.emitStatus(targetInfo.appId)
        return true
      }
      return false
    }
    if (target.state === "blocked" && !(options && options.force)) {
      return false
    }
    this.cancelled.add(targetInfo.appId)
    delete this.status.targets[targetInfo.appId]
    this.clearAttemptStartupStatus(targetInfo.appId)
    this.emitStatus(targetInfo.appId)
    return true
  }
  referencesApp(status, appId) {
    if (!status || !appId) {
      return false
    }
    const lists = [status.waiting_for, status.dependencies, status.requirement_order]
    if (lists.some((list) => Array.isArray(list) && list.includes(appId))) {
      return true
    }
    return !!(status.requirements && status.requirements[appId])
  }
  clearRelated(appId) {
    const id = this.normalizeAppId(appId)
    if (!id) {
      return
    }
    this.cancelled.delete(id)
    const changedTargets = new Set()
    if (this.status.targets[id]) {
      changedTargets.add(id)
    }
    delete this.status.targets[id]
    for (const targetId of Object.keys(this.status.targets)) {
      if (this.referencesApp(this.status.targets[targetId], id)) {
        changedTargets.add(targetId)
        delete this.status.targets[targetId]
      }
    }
    changedTargets.forEach((targetId) => this.cancelled.add(targetId))
    const startupStatus = this.startupHomeStatus()
    const apps = startupStatus && startupStatus.apps ? startupStatus.apps : null
    if (apps) {
      delete apps[id]
      for (const statusId of Object.keys(apps)) {
        if (this.referencesApp(apps[statusId], id)) {
          delete apps[statusId]
        }
      }
    }
    changedTargets.forEach((targetId) => this.emitStatus(targetId))
  }
  markStarted(launchPath) {
    const targetInfo = this.targetForLaunchPath(launchPath)
    if (!targetInfo) {
      return
    }
    const hadTarget = !!this.status.targets[targetInfo.appId]
    this.cancelled.delete(targetInfo.appId)
    delete this.status.targets[targetInfo.appId]
    if (hadTarget) {
      this.emitStatus(targetInfo.appId)
    }
  }
  markProgress(launchPath, progress) {
    const targetInfo = this.targetForLaunchPath(launchPath)
    if (!targetInfo || !progress) {
      return
    }
    const target = this.status.targets[targetInfo.appId]
    if (target) {
      target.step_current = progress.step_current
      target.step_total = progress.step_total
      this.emitStatus(targetInfo.appId)
    }
  }
  markDone(launchPath) {
    const targetInfo = this.targetForLaunchPath(launchPath)
    if (!targetInfo) {
      return
    }
    const hadTarget = !!this.status.targets[targetInfo.appId]
    delete this.status.targets[targetInfo.appId]
    this.cancelled.delete(targetInfo.appId)
    if (hadTarget) {
      this.emitStatus(targetInfo.appId)
    }
  }
  async resolveGraph(rootConfigs, apps) {
    const configs = new Map()
    const order = []
    const visited = new Set()
    const visiting = []
    const overrides = new Map(rootConfigs.map((config) => [config.id, config]))
    const visit = async (appId) => {
      const id = this.normalizeAppId(appId)
      if (!id) {
        return
      }
      const cycleIndex = visiting.indexOf(id)
      if (cycleIndex >= 0) {
        const cycle = visiting.slice(cycleIndex).concat(id)
        throw this.blocked(`Requirement cycle detected: ${cycle.join(" -> ")}`, {
          app_id: id,
          cycle
        })
      }
      if (visited.has(id)) {
        return
      }
      visiting.push(id)
      let config = configs.get(id)
      if (!config) {
        config = await this.configFor(id, apps, overrides.get(id) || {})
        if (!config) {
          throw this.blocked(`Required app is not installed: ${id}`, {
            app_id: id
          })
        }
        configs.set(id, config)
      }
      if (!config.launchScript || !config.launchPath) {
        throw this.blocked(`${config.title || config.id} has no launch script selected`, {
          app_id: config.id
        })
      }
      for (const dependencyId of config.dependencies) {
        await visit(dependencyId)
      }
      visiting.pop()
      visited.add(id)
      order.push(id)
    }
    try {
      for (const config of rootConfigs) {
        await visit(config.id)
      }
    } catch (error) {
      if (error && typeof error === "object") {
        error.configs = configs
        error.order = order.slice()
        error.chain = visiting.slice()
      }
      throw error
    }
    return {
      configs,
      order
    }
  }
  async waitUntilReady(config, context) {
    while (true) {
      this.checkCancelled(context.targetId)
      if (this.isReady(config)) {
        this.setRequirementRow(context.targetId, config, "ready")
        this.setStartupRow(context.startupStatus, config, "ready", {
          ready_at: Date.now(),
          waiting_for: [],
          owner_app_id: context.targetId,
          process_started: true
        })
        return
      }
      this.setRequirementRow(context.targetId, config, "starting")
      this.setStartupRow(context.startupStatus, config, "starting", {
        waiting_for: [],
        owner_app_id: context.targetId,
        process_started: this.isRunning(config) || this.isReady(config)
      })
      await new Promise((resolve) => setTimeout(resolve, context.pollMs))
    }
  }
  async startConfigIfNeeded(config) {
    const key = this.inflightKey(config)
    if (!key || this.isReady(config) || this.isRunning(config)) {
      return
    }
    if (this.hasActiveLaunch(config)) {
      return
    }
    const existing = this.inflightStarts.get(key)
    if (existing) {
      await existing
      return
    }
    let promise
    promise = Promise.resolve().then(async () => {
      try {
        if (!this.isReady(config) && !this.isRunning(config)) {
          await this.kernel.api.process({
            uri: config.launchPath,
            input: {},
            skip_requirements: true
          })
        }
      } finally {
        if (this.inflightStarts.get(key) === promise) {
          this.inflightStarts.delete(key)
        }
      }
    })
    this.inflightStarts.set(key, promise)
    await promise
  }
  async ensureConfigReady(config, context) {
    this.checkCancelled(context.targetId)
    if (this.isReady(config)) {
      this.setRequirementRow(context.targetId, config, "ready")
      this.setStartupRow(context.startupStatus, config, "ready", {
        ready_at: Date.now(),
        waiting_for: [],
        owner_app_id: context.targetId,
        process_started: true
      })
      return
    }
    if (!this.isRunning(config)) {
      this.setRequirementRow(context.targetId, config, "starting")
      this.setStartupRow(context.startupStatus, config, "starting", {
        started_at: Date.now(),
        waiting_for: [],
        owner_app_id: context.targetId,
        process_started: false
      })
      await this.startConfigIfNeeded(config)
    } else {
      this.setRequirementRow(context.targetId, config, "starting")
      this.setStartupRow(context.startupStatus, config, "starting", {
        waiting_for: [],
        owner_app_id: context.targetId,
        process_started: true
      })
    }
    await this.waitUntilReady(config, context)
  }
  ensureNode(config, context) {
    if (context.promises.has(config.id)) {
      return context.promises.get(config.id)
    }
    const promise = (async () => {
      this.checkCancelled(context.targetId)
      const dependencyConfigs = config.dependencies
        .map((dependencyId) => context.configs.get(dependencyId))
        .filter(Boolean)
      const waitingFor = dependencyConfigs
        .filter((dependency) => !this.isReady(dependency))
        .map((dependency) => dependency.id)
      if (waitingFor.length > 0) {
        this.setRequirementRow(context.targetId, config, "waiting", {
          waiting_for: waitingFor
        })
        this.setStartupRow(context.startupStatus, config, "waiting", {
          waiting_for: waitingFor,
          owner_app_id: context.targetId
        })
      }
      await Promise.all(dependencyConfigs.map((dependency) => this.ensureNode(dependency, context)))
      await this.ensureConfigReady(config, context)
    })()
    context.promises.set(config.id, promise)
    return promise
  }
  async ensureForLaunchPath(launchPath, options = {}) {
    if (!launchPath || options.skip === true) {
      return this.controlResult("continue")
    }
    const targetId = this.kernel.getAppIdForLaunchPath(launchPath)
    if (!targetId) {
      return this.controlResult("continue")
    }
    const startupRequest = !!(options.request && options.request.startup)
    const owner = options.owner || null
    const targetWasCancelled = this.cancelled.has(targetId)
    const apps = await this.appMap()
    const requestedScript = this.kernel.getAppRelativeLaunchScript(targetId, launchPath)
    const targetConfig = await this.configFor(targetId, apps, {
      launchScript: requestedScript,
      launchPath,
      startup_root: startupRequest
    })
    if (!targetConfig || !this.shouldPrepareLaunchPath(targetConfig, requestedScript)) {
      if (this.status.targets[targetId]) {
        delete this.status.targets[targetId]
        this.emitStatus(targetId)
      }
      return this.controlResult("continue")
    }
    if (targetWasCancelled) {
      if (startupRequest || this.hasActiveLaunch(targetConfig, owner)) {
        return this.cancelledResult(targetId)
      }
      this.cancelled.delete(targetId)
    }
    const activeTarget = this.activeTargetStatus(targetId, launchPath)
    if (activeTarget) {
      if (activeTarget.state === "blocked") {
        delete this.status.targets[targetId]
        this.emitStatus(targetId)
      } else {
        return this.handledResult(targetId, activeTarget)
      }
    }
    if (this.hasActiveLaunch(targetConfig, owner)) {
      return this.handledResult(targetId, {
        state: "starting"
      })
    }
    let graph
    const dependencyRoots = []
    try {
      for (const dependencyId of targetConfig.dependencies) {
        const config = await this.configFor(dependencyId, apps)
        if (!config) {
          throw this.blocked(`Required app is not installed: ${dependencyId}`, {
            app_id: dependencyId
          })
        }
        dependencyRoots.push(config)
      }
      const initialRequirementIds = dependencyRoots.map((config) => config.id)
      this.setTargetStatus(targetConfig, "waiting", {
        startup: startupRequest,
        requirements: {},
        requirement_order: initialRequirementIds,
        waiting_for: initialRequirementIds
      })
      for (const config of dependencyRoots) {
        this.setRequirementRow(targetId, config, this.isReady(config) ? "ready" : "waiting")
      }
      graph = await this.resolveGraph(dependencyRoots, apps)
    } catch (error) {
      await this.markBlockedTarget(targetConfig, error, apps, dependencyRoots)
      const startupStatus = this.startupHomeStatus()
      if (startupRequest && startupStatus) {
        const target = this.status.targets[targetId]
        this.setStartupRow(startupStatus, targetConfig, "blocked", {
          blocked_reason: target && target.blocked_reason ? target.blocked_reason : (error && error.blocked_reason ? error.blocked_reason : String(error || "Launch requirements blocked")),
          requirement_order: target && Array.isArray(target.requirement_order) ? target.requirement_order : [],
          waiting_for: target && Array.isArray(target.waiting_for) ? target.waiting_for : []
        })
      }
      const result = this.resultFromError(error, targetId)
      if (result) {
        return result
      }
      throw error
    }
    this.checkCancelled(targetId)
    const orderedRequirementIds = graph.order.filter((id) => id !== targetId)
    const target = this.status.targets[targetId]
    if (!target) {
      return this.cancelledResult(targetId)
    }
    this.seedTargetRequirements(targetConfig, orderedRequirementIds, graph.configs)
    const startupStatus = this.startupHomeStatus()
    const context = {
      targetId,
      configs: graph.configs,
      promises: new Map(),
      startupStatus,
      pollMs: options.pollMs || 1000
    }
    try {
      await Promise.all(targetConfig.dependencies.map((dependencyId) => {
        const config = graph.configs.get(dependencyId)
        return config ? this.ensureNode(config, context) : null
      }))
      this.checkCancelled(targetId)
      delete this.status.targets[targetId]
      this.emitStatus(targetId)
      return this.controlResult("continue")
    } catch (error) {
      if (error && error.cancelled) {
        delete this.status.targets[targetId]
        this.emitStatus(targetId)
        return this.cancelledResult(targetId)
      }
      const target = this.status.targets[targetId]
      if (target) {
        target.state = "blocked"
        target.blocked_reason = error && error.blocked_reason ? error.blocked_reason : String(error || "Launch requirements blocked")
        this.emitStatus(targetId)
      }
      const result = this.resultFromError(error, targetId)
      if (result) {
        return result
      }
      throw error
    }
  }
  getStatus(appId) {
    const id = this.normalizeAppId(appId)
    if (!id || !this.status.targets[id]) {
      return null
    }
    const target = this.status.targets[id]
    const orderedIds = Array.isArray(target.requirement_order) ? target.requirement_order : Object.keys(target.requirements || {})
    const requirements = orderedIds
      .map((rowId) => target.requirements[rowId])
      .filter(Boolean)
      .map((row) => {
        const progress = this.scriptProgress({
          id: row.id,
          launchPath: row.launch_path
        })
        return {
          ...row,
          ...(progress || {})
        }
      })
    return this.formatStatus(id, target, requirements, {
      visible_states: ["blocked"]
    })
  }
  formatStatus(appId, target, requirements, options = {}) {
    const waitingFor = requirements
      .filter((row) => row && row.state !== "ready")
      .map((row) => row.id)
    const visibleStates = new Set(Array.isArray(options.visible_states) ? options.visible_states : ["blocked"])
    if (!visibleStates.has(target.state) && waitingFor.length === 0) {
      return null
    }
    return {
      ...target,
      app_id: appId,
      title: target.title || appId,
      script: target.script || "",
      state: target.state,
      blocked_reason: target.blocked_reason || "",
      startup: Object.prototype.hasOwnProperty.call(options, "startup") ? !!options.startup : !!target.startup,
      requirements,
      waiting_for: waitingFor
    }
  }
}

module.exports = LaunchRequirements
