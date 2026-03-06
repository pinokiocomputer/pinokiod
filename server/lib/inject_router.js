"use strict"

const fs = require("fs")
const path = require("path")

const { resolveDesktopEventWorkspace } = require("./desktop_event_router")

const normalizeInjectHrefList = (value) => {
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
  return normalizeInjectHrefList(entries)
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

    const frameUrl = typeof context.frameUrl === "string" ? context.frameUrl : ""
    const frameInjectEntries = parseFrameInjectEntries(frameUrl)
    if (frameInjectEntries.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          matched: false,
          workspace,
          scripts: [],
          reason: "inject_not_requested"
        }
      }
    }

    const scripts = []
    for (const hrefRaw of frameInjectEntries) {
      const launchUrl = await resolveInjectLaunchUrl({
        workspace,
        workspaceRoot,
        launcher,
        hrefRaw
      })
      if (!launchUrl) {
        continue
      }
      scripts.push(launchUrl)
    }

    const uniqueScripts = [...new Set(scripts)]
    return {
      status: 200,
      body: {
        ok: true,
        matched: uniqueScripts.length > 0,
        workspace,
        scripts: uniqueScripts,
        source: "frame_query"
      }
    }
  }

  return {
    handle
  }
}

module.exports = {
  createInjectRouter,
  normalizeInjectHrefList
}
