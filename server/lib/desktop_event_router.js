"use strict"

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const DESKTOP_EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,127}$/
const DESKTOP_EVENT_RUN_TOKEN_PATTERN = /^[a-f0-9]{32}$/i
const DESKTOP_EVENT_RUN_TTL_MS = 60 * 60 * 1000
const DESKTOP_EVENT_RUN_STORE_LIMIT = 2048
const WORKSPACE_PATH_PATTERNS = [
  /^\/pinokio\/([^/?#]+)/i,
  /^\/p\/([^/?#]+)/i,
  /^\/api\/([^/?#]+)/i,
  /^\/_api\/([^/?#]+)/i,
  /^\/raw\/api\/([^/?#]+)/i,
  /^\/asset\/api\/([^/?#]+)/i,
  /^\/files\/api\/([^/?#]+)/i,
  /^\/env\/api\/([^/?#]+)/i,
  /^\/run\/api\/([^/?#]+)/i,
]

const normalizeDesktopEventName = (eventName) => {
  if (typeof eventName !== "string") {
    return null
  }
  const normalized = eventName.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  if (!DESKTOP_EVENT_NAME_PATTERN.test(normalized)) {
    return null
  }
  return normalized
}

const sanitizeDesktopWorkspaceName = (input) => {
  if (typeof input !== "string") {
    return null
  }
  const raw = input.trim()
  if (!raw) {
    return null
  }
  const normalized = raw.replace(/\\+/g, "/").replace(/^~\//, "").replace(/^\/+/, "")
  const parts = normalized.split("/").map((part) => part.trim()).filter((part) => part.length > 0 && part !== ".")
  if (parts.length === 0) {
    return null
  }
  let workspace = parts[0]
  if (workspace === "api" && parts.length > 1) {
    workspace = parts[1]
  }
  if (!workspace || workspace === "." || workspace === "..") {
    return null
  }
  if (workspace.includes("/") || workspace.includes("\\")) {
    return null
  }
  return workspace
}

const extractWorkspaceFromPathname = (pathname) => {
  if (typeof pathname !== "string") {
    return null
  }
  const normalizedPath = pathname.trim().replace(/\\+/g, "/")
  if (!normalizedPath) {
    return null
  }
  for (const pattern of WORKSPACE_PATH_PATTERNS) {
    const match = normalizedPath.match(pattern)
    if (match && match[1]) {
      let candidateRaw = match[1]
      try {
        candidateRaw = decodeURIComponent(candidateRaw)
      } catch (_) {}
      const candidate = sanitizeDesktopWorkspaceName(candidateRaw)
      if (candidate) {
        return candidate
      }
    }
  }
  return null
}

const extractWorkspaceFromUrl = (rawUrl) => {
  if (typeof rawUrl !== "string") {
    return null
  }
  const value = rawUrl.trim()
  if (!value) {
    return null
  }
  let parsedUrl
  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
      parsedUrl = new URL(value)
    } else {
      parsedUrl = new URL(value, "http://localhost")
    }
  } catch (_) {
    return extractWorkspaceFromPathname(value)
  }
  return extractWorkspaceFromPathname(parsedUrl.pathname)
}

const toHttpHostKey = (rawUrl) => {
  if (typeof rawUrl !== "string") {
    return null
  }
  const value = rawUrl.trim()
  if (!value) {
    return null
  }
  let parsed
  try {
    parsed = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)
      ? new URL(value)
      : new URL(value, "http://localhost")
  } catch (_) {
    return null
  }
  const protocol = parsed.protocol || ""
  if (protocol !== "http:" && protocol !== "https:") {
    return null
  }
  const host = (parsed.host || "").trim().toLowerCase()
  return host || null
}

const collectUrlLikeValues = (value, out = new Set(), depth = 0) => {
  if (depth > 4 || value === null || value === undefined) {
    return out
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed) {
      out.add(trimmed)
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUrlLikeValues(entry, out, depth + 1)
    }
    return out
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (!key) {
        continue
      }
      if (typeof entry === "string" && /url/i.test(key)) {
        const trimmed = entry.trim()
        if (trimmed) {
          out.add(trimmed)
        }
        continue
      }
      if (typeof entry === "object" && entry !== null) {
        collectUrlLikeValues(entry, out, depth + 1)
      }
    }
  }
  return out
}

const resolveWorkspaceFromRunningScripts = (kernel, context = {}) => {
  if (!kernel || !kernel.info || typeof kernel.info.scriptsByApi !== "function") {
    return null
  }
  const contextHosts = new Set()
  const contextUrlCandidates = [
    context.frameUrl,
    context.pageUrl,
    context.currentUrl,
    context.sourceUrl,
    context.referrerUrl,
    context.topUrl,
    context.destinationUrl,
    context.url,
  ]
  for (const candidate of contextUrlCandidates) {
    const hostKey = toHttpHostKey(candidate)
    if (hostKey) {
      contextHosts.add(hostKey)
    }
  }
  if (contextHosts.size === 0) {
    return null
  }
  let scriptsByApi
  try {
    scriptsByApi = kernel.info.scriptsByApi()
  } catch (_) {
    return null
  }
  if (!scriptsByApi || typeof scriptsByApi !== "object") {
    return null
  }
  const matches = new Set()
  for (const [workspace, entries] of Object.entries(scriptsByApi)) {
    if (!workspace || !Array.isArray(entries)) {
      continue
    }
    const normalizedWorkspace = sanitizeDesktopWorkspaceName(workspace)
    if (!normalizedWorkspace) {
      continue
    }
    let matched = false
    for (const entry of entries) {
      const urlValues = collectUrlLikeValues(entry, new Set())
      for (const value of urlValues) {
        const hostKey = toHttpHostKey(value)
        if (hostKey && contextHosts.has(hostKey)) {
          matched = true
          break
        }
      }
      if (matched) {
        break
      }
    }
    if (matched) {
      matches.add(normalizedWorkspace)
    }
  }
  if (matches.size === 1) {
    return [...matches][0]
  }
  return null
}

const resolveDesktopEventWorkspace = async (context = {}, kernel = null) => {
  const explicitCandidates = [
    context.workspace,
    context.app,
    context.name,
    context.project,
  ]
  for (const candidate of explicitCandidates) {
    const workspaceName = sanitizeDesktopWorkspaceName(candidate)
    if (workspaceName) {
      return workspaceName
    }
  }
  const urlCandidates = [
    context.frameUrl,
    context.pageUrl,
    context.url,
    context.currentUrl,
    context.sourceUrl,
    context.referrerUrl,
    context.topUrl,
    context.destinationUrl,
  ]
  for (const candidate of urlCandidates) {
    const workspaceName = extractWorkspaceFromUrl(candidate)
    if (workspaceName) {
      return workspaceName
    }
  }
  const workspaceByHost = resolveWorkspaceFromRunningScripts(kernel, context)
  if (workspaceByHost) {
    return workspaceByHost
  }
  return null
}

const normalizeDesktopEventUi = (ui = {}) => {
  const normalized = {}
  const mode = typeof ui.mode === "string" ? ui.mode.trim() : ""
  if (mode === "background" || mode === "sidebar" || mode === "overlay" || mode === "bottom") {
    normalized.mode = mode
  } else {
    normalized.mode = "background"
  }
  const title = typeof ui.title === "string" ? ui.title.trim() : ""
  if (title) {
    normalized.title = title
  }
  const open = typeof ui.open === "string" ? ui.open.trim() : ""
  if (open === "auto" || open === "manual") {
    normalized.open = open
  } else {
    normalized.open = "auto"
  }
  normalized.closeOnSuccess = Boolean(ui.closeOnSuccess)
  const refreshOnClose = typeof ui.refreshOnClose === "string"
    ? ui.refreshOnClose.trim().toLowerCase()
    : ui.refreshOnClose
  if (refreshOnClose === true) {
    normalized.refreshOnClose = "source"
  } else if (refreshOnClose === "source" || refreshOnClose === "root" || refreshOnClose === "active") {
    normalized.refreshOnClose = refreshOnClose
  } else {
    normalized.refreshOnClose = false
  }
  return normalized
}

const cloneDesktopEventValue = (value) => {
  if (value === null || value === undefined) {
    return value
  }
  try {
    return structuredClone(value)
  } catch (_) {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (_) {
      return value
    }
  }
}

const normalizeDesktopEventRunToken = (value) => {
  if (typeof value !== "string") {
    return null
  }
  const token = value.trim().toLowerCase()
  if (!token || !DESKTOP_EVENT_RUN_TOKEN_PATTERN.test(token)) {
    return null
  }
  return token
}

const createDesktopEventRunStore = () => {
  const runs = new Map()

  const pruneExpired = () => {
    const now = Date.now()
    for (const [token, entry] of runs.entries()) {
      if (!entry || !entry.expiresAt || entry.expiresAt <= now) {
        runs.delete(token)
      }
    }
  }

  const trimToLimit = () => {
    if (runs.size < DESKTOP_EVENT_RUN_STORE_LIMIT) {
      return
    }
    const entries = [...runs.entries()].sort((a, b) => {
      const aTime = a[1] && a[1].createdAt ? a[1].createdAt : 0
      const bTime = b[1] && b[1].createdAt ? b[1].createdAt : 0
      return aTime - bTime
    })
    const overflow = (runs.size - DESKTOP_EVENT_RUN_STORE_LIMIT) + 1
    for (let i = 0; i < overflow; i += 1) {
      const entry = entries[i]
      if (entry && entry[0]) {
        runs.delete(entry[0])
      }
    }
  }

  const save = (payload = {}) => {
    pruneExpired()
    trimToLimit()
    const token = crypto.randomBytes(16).toString("hex")
    const now = Date.now()
    runs.set(token, {
      createdAt: now,
      expiresAt: now + DESKTOP_EVENT_RUN_TTL_MS,
      payload: cloneDesktopEventValue(payload)
    })
    return token
  }

  const read = (token) => {
    pruneExpired()
    const normalized = normalizeDesktopEventRunToken(token)
    if (!normalized) {
      return null
    }
    const entry = runs.get(normalized)
    if (!entry) {
      return null
    }
    if (!entry.expiresAt || entry.expiresAt <= Date.now()) {
      runs.delete(normalized)
      return null
    }
    return cloneDesktopEventValue(entry.payload)
  }

  return {
    save,
    read
  }
}

const normalizeDesktopEventInput = ({ eventName, payload, context = {} }) => {
  const input = {}
  const positional = []

  if (Array.isArray(payload)) {
    positional.push(...payload)
  } else if (payload && typeof payload === "object") {
    if (Array.isArray(payload._)) {
      positional.push(...payload._)
    } else if (Array.isArray(payload.args)) {
      positional.push(...payload.args)
    }
    for (const [key, value] of Object.entries(payload)) {
      if (!key || key === "_" || key === "args" || key.startsWith("__")) {
        continue
      }
      input[key] = cloneDesktopEventValue(value)
    }
  } else if (payload !== undefined && payload !== null) {
    positional.push(payload)
  }

  input._ = positional.map((value) => cloneDesktopEventValue(value))
  input.event = {
    name: eventName,
    source: typeof context.source === "string" ? context.source : "",
    sourceEvent: typeof context.sourceEvent === "string" ? context.sourceEvent : "",
    pageUrl: typeof context.pageUrl === "string" ? context.pageUrl : "",
    frameUrl: typeof context.frameUrl === "string" ? context.frameUrl : "",
    currentUrl: typeof context.currentUrl === "string" ? context.currentUrl : "",
    topUrl: typeof context.topUrl === "string" ? context.topUrl : "",
    referrerUrl: typeof context.referrerUrl === "string" ? context.referrerUrl : ""
  }
  return input
}

const resolveDesktopEventHandler = async ({ kernel, eventName, payload, context = {}, runStore }) => {
  const workspace = await resolveDesktopEventWorkspace(context, kernel)
  if (!workspace) {
    return { matched: false, reason: "workspace_not_resolved" }
  }
  const workspaceRoot = kernel.path("api", workspace)
  let workspaceStats
  try {
    workspaceStats = await fs.promises.stat(workspaceRoot)
  } catch (_) {
    return { matched: false, workspace, reason: "workspace_not_found" }
  }
  if (!workspaceStats.isDirectory()) {
    return { matched: false, workspace, reason: "workspace_not_directory" }
  }

  const launcher = await kernel.api.launcher(workspace)
  if (!launcher || !launcher.script) {
    return { matched: false, workspace, reason: "launcher_not_found" }
  }

  let onConfig = launcher.script.on
  if (typeof onConfig === "function") {
    if (onConfig.constructor.name === "AsyncFunction") {
      onConfig = await onConfig(kernel, kernel.info)
    } else {
      onConfig = onConfig(kernel, kernel.info)
    }
  }
  if (!onConfig || typeof onConfig !== "object" || Array.isArray(onConfig)) {
    return { matched: false, workspace, reason: "event_config_not_found" }
  }

  const handlerConfigRaw = onConfig[eventName]
  if (!handlerConfigRaw) {
    return { matched: false, workspace, reason: "event_handler_not_found" }
  }

  const handlerConfig = typeof handlerConfigRaw === "string"
    ? { href: handlerConfigRaw }
    : handlerConfigRaw

  if (!handlerConfig || typeof handlerConfig !== "object") {
    return { matched: false, workspace, reason: "event_handler_invalid" }
  }

  const hrefRaw = typeof handlerConfig.href === "string" ? handlerConfig.href.trim() : ""
  if (!hrefRaw) {
    return { matched: false, workspace, reason: "event_handler_href_missing" }
  }

  let hrefPath = hrefRaw
  let querySuffix = ""
  const queryIndex = hrefRaw.indexOf("?")
  if (queryIndex >= 0) {
    hrefPath = hrefRaw.slice(0, queryIndex)
    querySuffix = hrefRaw.slice(queryIndex + 1)
  }
  if (!hrefPath) {
    return { matched: false, workspace, reason: "event_handler_href_invalid" }
  }

  let launchPath
  if (hrefPath.startsWith("/")) {
    launchPath = hrefPath
  } else {
    const launcherRoot = launcher.launcher_root
      ? path.resolve(workspaceRoot, launcher.launcher_root)
      : workspaceRoot
    const absoluteHandlerPath = path.resolve(launcherRoot, hrefPath)
    const relativeToWorkspace = path.relative(workspaceRoot, absoluteHandlerPath)
    if (!relativeToWorkspace || relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      return { matched: false, workspace, reason: "event_handler_outside_workspace" }
    }
    let handlerStats
    try {
      handlerStats = await fs.promises.stat(absoluteHandlerPath)
    } catch (_) {
      return { matched: false, workspace, reason: "event_handler_not_found" }
    }
    if (!handlerStats.isFile()) {
      return { matched: false, workspace, reason: "event_handler_not_file" }
    }
    const routeSegments = relativeToWorkspace
      .split(path.sep)
      .filter((segment) => segment && segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
    if (routeSegments.length === 0) {
      return { matched: false, workspace, reason: "event_handler_href_invalid" }
    }
    launchPath = `/api/${encodeURIComponent(workspace)}/${routeSegments.join("/")}`
  }

  const queryParams = new URLSearchParams(querySuffix)
  const runInput = normalizeDesktopEventInput({ eventName, payload, context })
  const runToken = runStore && typeof runStore.save === "function"
    ? runStore.save({
      workspace,
      event: eventName,
      input: runInput
    })
    : null
  if (!runToken) {
    return { matched: false, workspace, reason: "event_run_token_failed" }
  }
  queryParams.set("__pinokio_event_run", runToken)

  const queryString = queryParams.toString()
  const launchUrl = queryString ? `${launchPath}?${queryString}` : launchPath
  return {
    matched: true,
    workspace,
    event: eventName,
    launch: {
      url: launchUrl,
      ui: normalizeDesktopEventUi(handlerConfig.ui || {}),
    }
  }
}

const createDesktopEventRouter = ({ kernel }) => {
  const runStore = createDesktopEventRunStore()

  const handle = async (body = {}) => {
    const eventName = normalizeDesktopEventName(body ? body.event : null)
    if (!eventName) {
      return {
        status: 400,
        body: {
          ok: false,
          error: "Invalid event name"
        }
      }
    }
    const payload = body && Object.prototype.hasOwnProperty.call(body, "payload") ? body.payload : {}
    const context = body && body.context && typeof body.context === "object" ? body.context : {}
    const result = await resolveDesktopEventHandler({ kernel, eventName, payload, context, runStore })
    if (!result.matched) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          event: eventName,
          workspace: result.workspace || null,
          reason: result.reason || "event_handler_not_found"
        }
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        matched: true,
        event: result.event,
        workspace: result.workspace,
        launch: result.launch
      }
    }
  }

  const resolveRun = (token) => {
    const payload = runStore.read(token)
    if (!payload || typeof payload !== "object") {
      return null
    }
    return payload
  }

  return {
    handle,
    resolveRun
  }
}

module.exports = {
  createDesktopEventRouter,
  resolveDesktopEventWorkspace
}
