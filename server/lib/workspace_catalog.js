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

function newestNote(notes) {
  return [...notes].sort((a, b) => {
    return (new Date(b.updatedAt || 0).getTime() || 0) - (new Date(a.updatedAt || 0).getTime() || 0)
  })[0] || null
}

function createWorkspaceCatalogService({ kernel, workspaceRuntime, notes }) {
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

    const noteByPath = new Map()
    const pendingNotes = notes ? await notes.listPending({}).catch(() => []) : []
    for (const note of pendingNotes) {
      if (!note.cwd) continue
      const key = normalizePathKey(note.cwd)
      const list = noteByPath.get(key) || []
      list.push(note)
      noteByPath.set(key, list)
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
      const workspaceNotes = noteByPath.get(key) || []
      const note = newestNote(workspaceNotes)
      const modifiedAtMs = stats?.mtimeMs || 0
      const lastOpenedAtMs = latestTimestamp([
        modifiedAtMs,
        ...shells.map((shell) => shell.start_time),
        ...workspaceNotes.map((item) => item.updatedAt),
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
          notes: workspaceNotes.length,
        },
        shells,
        scripts,
        note,
        noteReady: Boolean(note),
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
        notes: items.filter((item) => item.noteReady).length,
      },
    }
  }

  return { list, normalizeSortMode }
}

module.exports = { createWorkspaceCatalogService, normalizeSortMode }
