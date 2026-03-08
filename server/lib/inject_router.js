"use strict"

const fs = require("fs")
const path = require("path")

const { resolveDesktopEventWorkspace } = require("./desktop_event_router")

const VALID_INJECT_WORLDS = new Set(["main", "isolated"])
const VALID_INJECT_WHEN = new Set(["start", "end", "idle"])
const VALID_INJECT_FRAMES = new Set(["top", "all"])

const normalizeInjectMatchList = (value) => {
  if (!value) {
    return []
  }
  const values = Array.isArray(value) ? value : [value]
  const normalized = []
  const seen = new Set()
  for (const entry of values) {
    if (typeof entry !== "string") {
      continue
    }
    const raw = entry.trim()
    if (!raw) {
      continue
    }
    const parts = raw.split(",").map((item) => item.trim()).filter(Boolean)
    for (const part of parts) {
      if (part.length > 1024) {
        continue
      }
      if (seen.has(part)) {
        continue
      }
      seen.add(part)
      normalized.push(part)
    }
  }
  return normalized
}

const normalizeInjectHrefList = (value) => {
  return normalizeInjectList(value).map((entry) => entry.src)
}

const normalizeInjectEntry = (value) => {
  let src = ""
  let match = []
  let world = "main"
  let when = "idle"
  let frame = "top"

  if (typeof value === "string") {
    src = value.trim()
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    src = typeof value.src === "string" ? value.src.trim() : ""
    match = normalizeInjectMatchList(value.match)
    if (typeof value.world === "string") {
      const normalizedWorld = value.world.trim().toLowerCase()
      if (VALID_INJECT_WORLDS.has(normalizedWorld)) {
        world = normalizedWorld
      }
    }
    if (typeof value.when === "string") {
      const normalizedWhen = value.when.trim().toLowerCase()
      if (VALID_INJECT_WHEN.has(normalizedWhen)) {
        when = normalizedWhen
      }
    }
    if (typeof value.frame === "string") {
      const normalizedFrame = value.frame.trim().toLowerCase()
      if (VALID_INJECT_FRAMES.has(normalizedFrame)) {
        frame = normalizedFrame
      }
    }
  }

  if (!src || src.length > 1024) {
    return null
  }

  return {
    src,
    match: match.length > 0 ? match : ["*"],
    world,
    when,
    frame
  }
}

const normalizeInjectList = (value) => {
  if (!value) {
    return []
  }
  const values = Array.isArray(value) ? value : [value]
  const normalized = []
  const seen = new Set()
  for (const entry of values) {
    if (typeof entry === "string") {
      const parts = entry.split(",").map((item) => item.trim()).filter(Boolean)
      for (const part of parts) {
        const normalizedEntry = normalizeInjectEntry(part)
        if (!normalizedEntry) {
          continue
        }
        const signature = JSON.stringify(normalizedEntry)
        if (seen.has(signature)) {
          continue
        }
        seen.add(signature)
        normalized.push(normalizedEntry)
      }
      continue
    }
    const normalizedEntry = normalizeInjectEntry(entry)
    if (!normalizedEntry) {
      continue
    }
    const signature = JSON.stringify(normalizedEntry)
    if (seen.has(signature)) {
      continue
    }
    seen.add(signature)
    normalized.push(normalizedEntry)
  }
  return normalized
}

const parseFrameInjectEntries = (frameUrl) => {
  if (typeof frameUrl !== "string") {
    return []
  }
  const value = frameUrl.trim()
  if (!value) {
    return []
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    return []
  }
  const entries = parsed.searchParams.getAll("__pinokio_inject")
  return normalizeInjectList(entries)
}

const resolveInjectLaunchUrl = async ({ workspace, workspaceRoot, launcher, hrefRaw }) => {
  let hrefPath = hrefRaw
  let querySuffix = ""
  const queryIndex = hrefRaw.indexOf("?")
  if (queryIndex >= 0) {
    hrefPath = hrefRaw.slice(0, queryIndex)
    querySuffix = hrefRaw.slice(queryIndex + 1)
  }
  if (!hrefPath) {
    return null
  }

  let launchPath
  if (hrefPath.startsWith("/")) {
    const normalized = hrefPath.trim()
    if (normalized.startsWith("/api/")) {
      launchPath = `/raw/${normalized.slice("/api/".length)}`
    } else if (normalized.startsWith("/_api/")) {
      launchPath = `/raw/${normalized.slice("/_api/".length)}`
    } else {
      launchPath = normalized
    }
  } else {
    const launcherRoot = launcher.launcher_root
      ? path.resolve(workspaceRoot, launcher.launcher_root)
      : workspaceRoot
    const absoluteHandlerPath = path.resolve(launcherRoot, hrefPath)
    const relativeToWorkspace = path.relative(workspaceRoot, absoluteHandlerPath)
    if (!relativeToWorkspace || relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      return null
    }
    let handlerStats
    try {
      handlerStats = await fs.promises.stat(absoluteHandlerPath)
    } catch (_) {
      return null
    }
    if (!handlerStats.isFile()) {
      return null
    }
    const routeSegments = relativeToWorkspace
      .split(path.sep)
      .filter((segment) => segment && segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
    if (routeSegments.length === 0) {
      return null
    }
    launchPath = `/raw/${encodeURIComponent(workspace)}/${routeSegments.join("/")}`
  }

  const queryParams = new URLSearchParams(querySuffix)
  const queryString = queryParams.toString()
  return queryString ? `${launchPath}?${queryString}` : launchPath
}

const resolveInjectDescriptor = async ({ workspace, workspaceRoot, launcher, descriptor }) => {
  const resolvedSrc = await resolveInjectLaunchUrl({
    workspace,
    workspaceRoot,
    launcher,
    hrefRaw: descriptor.src
  })
  if (!resolvedSrc) {
    return null
  }
  return {
    src: resolvedSrc,
    match: Array.isArray(descriptor.match) ? descriptor.match.slice() : ["*"],
    world: descriptor.world || "main",
    when: descriptor.when || "idle",
    frame: descriptor.frame || "top"
  }
}

const createInjectRouter = ({ kernel }) => {
  const handle = async (body = {}) => {
    const context = body && body.context && typeof body.context === "object" ? body.context : {}
    const workspace = await resolveDesktopEventWorkspace(context, kernel)
    if (!workspace) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          workspace: null,
          scripts: [],
          reason: "workspace_not_resolved"
        }
      }
    }

    const workspaceRoot = kernel.path("api", workspace)
    let workspaceStats
    try {
      workspaceStats = await fs.promises.stat(workspaceRoot)
    } catch (_) {
      workspaceStats = null
    }
    if (!workspaceStats || !workspaceStats.isDirectory()) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          workspace,
          scripts: [],
          reason: "workspace_not_found"
        }
      }
    }

    const launcher = await kernel.api.launcher(workspace)
    if (!launcher || !launcher.script) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          workspace,
          scripts: [],
          reason: "launcher_not_found"
        }
      }
    }

    const requestInjectEntries = normalizeInjectList(body && body.inject)
    const frameUrl = typeof context.frameUrl === "string" ? context.frameUrl : ""
    const injectEntries = requestInjectEntries.length > 0
      ? requestInjectEntries
      : parseFrameInjectEntries(frameUrl)
    if (injectEntries.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          workspace,
          inject: [],
          scripts: [],
          reason: "inject_not_requested"
        }
      }
    }

    const inject = []
    for (const descriptor of injectEntries) {
      const resolvedDescriptor = await resolveInjectDescriptor({
        workspace,
        workspaceRoot,
        launcher,
        descriptor
      })
      if (!resolvedDescriptor) {
        continue
      }
      inject.push(resolvedDescriptor)
    }

    const uniqueInject = []
    const seen = new Set()
    for (const descriptor of inject) {
      const signature = JSON.stringify(descriptor)
      if (seen.has(signature)) {
        continue
      }
      seen.add(signature)
      uniqueInject.push(descriptor)
    }
    const scripts = uniqueInject.map((descriptor) => descriptor.src)
    return {
      status: 200,
      body: {
        ok: true,
        matched: uniqueInject.length > 0,
        workspace,
        inject: uniqueInject,
        scripts,
        source: requestInjectEntries.length > 0 ? "request_body" : "frame_query"
      }
    }
  }

  return {
    handle
  }
}

module.exports = {
  createInjectRouter,
  normalizeInjectHrefList,
  normalizeInjectList
}
