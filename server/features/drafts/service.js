const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const {
  RESULT_RELATIVE_DIR,
  POST_FILENAME,
  DEFAULT_READY_FILENAME,
  buildExcerpt,
  describeMediaRefs,
  extractTitle,
  parseDraftMetadata
} = require("./parser")

const STATE_FILENAME = "drafts.json"
const MAX_PREVIEW_BYTES = 256 * 1024

function createHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)
}

function dismissalKey(id, revision) {
  const normalizedId = typeof id === "string" ? id.trim() : ""
  const normalizedRevision = typeof revision === "string" ? revision.trim() : ""
  return normalizedRevision ? `${normalizedId}:${normalizedRevision}` : normalizedId
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_) {
    return null
  }
}

function normalizeRelativePath(value, fallback) {
  const raw = String(value || fallback || "").trim().replace(/\\/g, "/")
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    return fallback
  }
  const normalized = path.posix.normalize(raw)
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return fallback
  }
  return normalized
}

function normalizeDraftConfig(config = {}) {
  const params = config && typeof config === "object" ? config : {}
  return {
    path: normalizeRelativePath(params.path, RESULT_RELATIVE_DIR),
    content: normalizeRelativePath(params.content || params.post, POST_FILENAME),
    ready: normalizeRelativePath(params.ready, DEFAULT_READY_FILENAME),
    description: typeof params.description === "string" ? params.description.trim() : "",
    publish: clonePlainObject(params.publish)
  }
}

function createDraftService({ kernel, taskWorkspaceLinks } = {}) {
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const statePath = () => path.resolve(kernel.path("tasks"), STATE_FILENAME)
  const resultsByWorkspace = new Map()
  const dismissedIds = new Set()
  let started = false
  let stateLoaded = false

  async function ensureStateLoaded() {
    if (stateLoaded) return
    stateLoaded = true
    try {
      const raw = await fs.promises.readFile(statePath(), "utf8")
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.dismissed)) {
        parsed.dismissed.forEach((id) => {
          if (typeof id === "string" && id.trim()) {
            dismissedIds.add(id.trim())
          }
        })
      }
    } catch (_) {
    }
  }

  async function saveState() {
    await fs.promises.mkdir(path.dirname(statePath()), { recursive: true })
    const payload = {
      version: 1,
      dismissed: Array.from(dismissedIds).slice(-500)
    }
    await fs.promises.writeFile(statePath(), JSON.stringify(payload, null, 2))
  }

  async function readMarkdownPreview(postPath) {
    const handle = await fs.promises.open(postPath, "r")
    try {
      const buffer = Buffer.alloc(MAX_PREVIEW_BYTES)
      const read = await handle.read(buffer, 0, MAX_PREVIEW_BYTES, 0)
      return buffer.slice(0, read.bytesRead).toString("utf8")
    } finally {
      await handle.close().catch(() => {})
    }
  }

  async function readDraftMetadata(metadataPath) {
    if (path.extname(metadataPath).toLowerCase() !== ".json") {
      return {}
    }
    const raw = await fs.promises.readFile(metadataPath, "utf8")
    return parseDraftMetadata(raw)
  }

  async function inspectWorkspace({ taskId, ref, cwd, draft } = {}) {
    await ensureStateLoaded()
    if (typeof cwd !== "string" || !cwd.trim()) {
      return null
    }
    const workspacePath = path.resolve(cwd.trim())
    const draftConfig = normalizeDraftConfig(draft)
    const resultDir = path.resolve(workspacePath, draftConfig.path)
    const readyPath = path.resolve(resultDir, draftConfig.ready)
    const postPath = path.resolve(resultDir, draftConfig.content)
    const readyStats = await fs.promises.stat(readyPath).catch(() => null)
    const postStats = await fs.promises.stat(postPath).catch(() => null)
    if (!readyStats || !readyStats.isFile() || !postStats || !postStats.isFile()) {
      resultsByWorkspace.delete(workspacePath)
      return null
    }
    let metadata = {}
    try {
      metadata = await readDraftMetadata(readyPath)
    } catch (_) {
      resultsByWorkspace.delete(workspacePath)
      return null
    }

    const markdown = await readMarkdownPreview(postPath)
    const workspaceName = path.basename(workspacePath)
    const media = await describeMediaRefs(markdown, resultDir)
    const updatedAtMs = Math.max(readyStats.mtimeMs || 0, postStats.mtimeMs || 0)
    const id = createHash(`${workspacePath}|${resultDir}|${postPath}|${readyPath}`)
    const mediaRevision = media
      .map((item) => `${item.ref}:${item.exists ? item.bytes : "missing"}:${item.mtimeMs || 0}`)
      .join("|")
    const revision = createHash(`${postStats.size}|${postStats.mtimeMs}|${readyStats.size}|${readyStats.mtimeMs}|${mediaRevision}`)
    const result = {
      id,
      revision,
      taskId,
      ref,
      cwd: workspacePath,
      workspaceName,
      title: metadata.title || extractTitle(markdown, workspaceName),
      markdown,
      excerpt: buildExcerpt(markdown),
      resultDir,
      postPath,
      contentPath: postPath,
      readyPath,
      metadataPath: readyPath,
      metadata,
      publish: draftConfig.publish,
      description: draftConfig.description,
      postBytes: postStats.size,
      media: media.map((item, index) => ({
        index,
        ref: item.ref,
        path: item.path,
        bytes: item.bytes,
        mtimeMs: item.mtimeMs,
        exists: item.exists,
        ext: path.extname(item.ref || "").toLowerCase()
      })),
      mediaCount: media.length,
      missingMediaCount: media.filter((item) => !item.exists).length,
      mediaBytes: media.reduce((total, item) => total + (Number.isFinite(item.bytes) ? item.bytes : 0), 0),
      updatedAt: new Date(updatedAtMs || Date.now()).toISOString()
    }
    resultsByWorkspace.set(workspacePath, result)
    return result
  }

  async function trackWorkspace({ taskId, ref, cwd } = {}) {
    let resolvedCwd = cwd
    if (!resolvedCwd && ref && taskWorkspaceLinks && typeof taskWorkspaceLinks.resolveWorkspaceRef === "function") {
      resolvedCwd = taskWorkspaceLinks.resolveWorkspaceRef(ref)
    }
    if (!resolvedCwd) {
      return null
    }
    return inspectWorkspace({ taskId, ref, cwd: resolvedCwd })
  }

  async function listPending(options = {}) {
    await ensureStateLoaded()
    const filterCwd = typeof options.cwd === "string" && options.cwd.trim()
      ? path.resolve(options.cwd.trim())
      : ""
    return Array.from(resultsByWorkspace.values())
      .filter((result) => !dismissedIds.has(dismissalKey(result.id, result.revision)) && !dismissedIds.has(result.id))
      .filter((result) => !filterCwd || result.cwd === filterCwd)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async function getPendingById(id) {
    await ensureStateLoaded()
    const normalizedId = typeof id === "string" ? id.trim() : ""
    if (!normalizedId) {
      return null
    }
    const result = Array.from(resultsByWorkspace.values()).find((item) => item.id === normalizedId) || null
    if (!result || dismissedIds.has(dismissalKey(result.id, result.revision)) || dismissedIds.has(result.id)) {
      return null
    }
    return result
  }

  async function dismiss(id, revision) {
    await ensureStateLoaded()
    const normalizedId = typeof id === "string" ? id.trim() : ""
    if (!normalizedId) {
      return false
    }
    dismissedIds.add(dismissalKey(normalizedId, revision))
    await saveState()
    return true
  }

  async function refreshLinkedWorkspaces() {
    await ensureStateLoaded()
  }

  async function start() {
    if (started) return
    started = true
    await ensureStateLoaded()
  }

  async function stop() {
  }

  return {
    RESULT_RELATIVE_DIR,
    dismiss,
    getPendingById,
    inspectWorkspace,
    listPending,
    refreshLinkedWorkspaces,
    start,
    stop,
    trackWorkspace
  }
}

module.exports = {
  createDraftService
}
