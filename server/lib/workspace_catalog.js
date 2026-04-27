const fs = require("fs")
const path = require("path")

const SORT_MODES = new Set(["most_used", "last_opened", "az"])

function normalizeSortMode(sort) {
  if (SORT_MODES.has(sort)) return sort
  return "most_used"
}

function normalizePathKey(filepath) {
  const resolved = path.resolve(filepath).replace(/[\\/]+$/, "")
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function toRoutePath(filepath) {
  const resolved = path.resolve(filepath).replace(/\\/g, "/")
  const encoded = resolved
    .split("/")
    .map((segment, index) => {
      if (index === 0 && segment === "") return ""
      return encodeURIComponent(segment)
    })
    .join("/")
  return encoded.startsWith("/") ? `/d${encoded}` : `/d/${encoded}`
}

function latestTimestamp(values) {
  return values.reduce((latest, value) => {
    if (!value) return latest
    const timestamp = typeof value === "number" ? value : new Date(value).getTime()
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest
  }, 0)
}

function sortWorkspaces(items, sort) {
  const mode = normalizeSortMode(sort)
  const sorted = [...items]
  sorted.sort((a, b) => {
    if (mode === "az") {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    }
    if (mode === "last_opened") {
      const delta = (b.lastOpenedAtMs || b.modifiedAtMs || 0) - (a.lastOpenedAtMs || a.modifiedAtMs || 0)
      if (delta !== 0) return delta
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    }
    const usageDelta = (b.usageCount || 0) - (a.usageCount || 0)
    if (usageDelta !== 0) return usageDelta
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
  return sorted
}

function newestDraft(drafts) {
  return [...drafts].sort((a, b) => {
    return (new Date(b.updatedAt || 0).getTime() || 0) - (new Date(a.updatedAt || 0).getTime() || 0)
  })[0] || null
}

function createWorkspaceCatalogService({ kernel, workspaceRuntime, drafts }) {
  async function list(options = {}) {
    const sort = normalizeSortMode(options.sort)
    const root = path.resolve(kernel.path("workspaces"))
    const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
    const runtime = workspaceRuntime.list()
    const liveByPath = new Map()

    for (const group of runtime.workspaces || []) {
      if (group.root !== "workspaces") continue
      liveByPath.set(normalizePathKey(group.cwd), group)
    }

    const draftByPath = new Map()
    const pendingDrafts = drafts ? await drafts.listPending({}).catch(() => []) : []
    for (const draft of pendingDrafts) {
      if (!draft.cwd) continue
      const key = normalizePathKey(draft.cwd)
      const list = draftByPath.get(key) || []
      list.push(draft)
      draftByPath.set(key, list)
    }

    const folders = entries.filter((entry) => entry.isDirectory())
    const items = []

    for (const entry of folders) {
      const cwd = path.join(root, entry.name)
      const stats = await fs.promises.stat(cwd).catch(() => null)
      const key = normalizePathKey(cwd)
      const live = liveByPath.get(key)
      const shells = live?.shells || []
      const scripts = live?.scripts || []
      const workspaceDrafts = draftByPath.get(key) || []
      const draft = newestDraft(workspaceDrafts)
      const modifiedAtMs = stats?.mtimeMs || 0
      const lastOpenedAtMs = latestTimestamp([
        modifiedAtMs,
        ...shells.map((shell) => shell.start_time),
        ...workspaceDrafts.map((item) => item.updatedAt),
      ])
      const primaryShell = shells.length === 1 ? shells[0] : null
      const primaryScript = scripts.length === 1 ? scripts[0] : null
      const usageCount = shells.length + scripts.length

      items.push({
        name: entry.name,
        cwd,
        relpath: entry.name,
        modifiedAt: modifiedAtMs ? new Date(modifiedAtMs).toISOString() : null,
        modifiedAtMs,
        lastOpenedAt: lastOpenedAtMs ? new Date(lastOpenedAtMs).toISOString() : null,
        lastOpenedAtMs,
        usageCount,
        running: shells.length > 0 || scripts.length > 0,
        counts: {
          shells: shells.length,
          scripts: scripts.length,
          drafts: workspaceDrafts.length,
        },
        shells,
        scripts,
        draft,
        draftReady: Boolean(draft),
        primaryUrl: primaryScript?.url || primaryShell?.url || null,
        launchUrl: toRoutePath(cwd),
      })
    }

    const running = sortWorkspaces(items.filter((item) => item.running), sort)
    const offline = sortWorkspaces(items.filter((item) => !item.running), sort)

    return {
      root,
      sort,
      running,
      offline,
      items: [...running, ...offline],
      counts: {
        total: items.length,
        running: running.length,
        offline: offline.length,
        drafts: items.filter((item) => item.draftReady).length,
      },
    }
  }

  return { list, normalizeSortMode }
}

module.exports = { createWorkspaceCatalogService, normalizeSortMode }
