const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const {
  RESULT_RELATIVE_DIR,
  NOTE_FILENAME,
  METADATA_FILENAME,
  buildExcerpt,
  describeMediaRefs,
  extractTitle,
  parseNoteMetadata
} = require("./parser")

const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024

function createHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)
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

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function normalizeNoteConfig(config = {}) {
  const params = config && typeof config === "object" ? config : {}
  return {
    path: normalizeRelativePath(params.path, RESULT_RELATIVE_DIR),
    content: normalizeRelativePath(params.content, ""),
    ready: normalizeRelativePath(params.ready, METADATA_FILENAME),
    description: typeof params.description === "string" ? params.description.trim() : "",
    publish: clonePlainObject(params.publish)
  }
}

async function findMetadataFiles(rootDir, filename) {
  const root = path.resolve(rootDir)
  const stats = await fs.promises.stat(root).catch(() => null)
  if (!stats || !stats.isDirectory()) {
    return []
  }
  const target = String(filename || METADATA_FILENAME)
  const results = []
  const visit = async (dir) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (entry.isFile() && entry.name === target) {
        results.push(fullPath)
      }
    }
  }
  await visit(root)
  return results
}

function createNoteService({ kernel, taskWorkspaceLinks } = {}) {
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const resultsByBundle = new Map()

  async function readMarkdown(notePath, stats) {
    const noteStats = stats || await fs.promises.stat(notePath)
    if (noteStats.size > MAX_MARKDOWN_BYTES) {
      throw new Error(`note markdown is too large (${noteStats.size} bytes)`)
    }
    return fs.promises.readFile(notePath, "utf8")
  }

  async function readNoteMetadata(metadataPath) {
    if (path.extname(metadataPath).toLowerCase() !== ".json") {
      return {}
    }
    const raw = await fs.promises.readFile(metadataPath, "utf8")
    return parseNoteMetadata(raw)
  }

  async function inspectNoteBundle({ taskId, ref, cwd, note, bundlePath, metadataPath } = {}) {
    if (typeof cwd !== "string" || !cwd.trim()) {
      return null
    }
    const workspacePath = path.resolve(cwd.trim())
    const noteConfig = normalizeNoteConfig(note)
    const rootDir = path.resolve(workspacePath, noteConfig.path)
    const resultDir = path.resolve(bundlePath || rootDir)
    const readyPath = path.resolve(metadataPath || path.resolve(resultDir, noteConfig.ready))
    const readyStats = await fs.promises.stat(readyPath).catch(() => null)
    if (!readyStats || !readyStats.isFile()) {
      resultsByBundle.delete(resultDir)
      return null
    }
    let metadata = {}
    try {
      metadata = await readNoteMetadata(readyPath)
    } catch (_) {
      resultsByBundle.delete(resultDir)
      return null
    }

    const contentPath = normalizeRelativePath(metadata.content || noteConfig.content, NOTE_FILENAME)
    const notePath = path.resolve(resultDir, contentPath)
    const noteStats = await fs.promises.stat(notePath).catch(() => null)
    if (!noteStats || !noteStats.isFile()) {
      resultsByBundle.delete(resultDir)
      return null
    }

    const markdown = await readMarkdown(notePath, noteStats)
    const workspaceName = path.basename(workspacePath)
    const bundleName = path.basename(resultDir)
    const media = await describeMediaRefs(markdown, resultDir)
    const updatedAtMs = Math.max(readyStats.mtimeMs || 0, noteStats.mtimeMs || 0)
    const id = createHash(`${workspacePath}|${resultDir}|${notePath}|${readyPath}`)
    const previous = resultsByBundle.get(resultDir) || null
    const publish = noteConfig.publish || (previous && previous.publish) || null
    const description = noteConfig.description || (previous && previous.description) || ""
    const mediaRevision = media
      .map((item) => `${item.ref}:${item.exists ? item.bytes : "missing"}:${item.mtimeMs || 0}`)
      .join("|")
    const revision = createHash(`${noteStats.size}|${noteStats.mtimeMs}|${readyStats.size}|${readyStats.mtimeMs}|${mediaRevision}`)
    const result = {
      id,
      revision,
      taskId,
      ref,
      cwd: workspacePath,
      workspaceName,
      bundleName,
      title: metadata.title || extractTitle(markdown, bundleName || workspaceName),
      markdown,
      excerpt: buildExcerpt(markdown),
      resultDir,
      watchRoot: rootDir,
      notePath,
      contentPath: notePath,
      readyPath,
      metadataPath: readyPath,
      metadata,
      publish,
      description,
      noteBytes: noteStats.size,
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
    resultsByBundle.set(resultDir, result)
    return result
  }

  async function inspectWorkspace({ taskId, ref, cwd, note } = {}) {
    if (typeof cwd !== "string" || !cwd.trim()) {
      return null
    }
    const workspacePath = path.resolve(cwd.trim())
    const noteConfig = normalizeNoteConfig(note)
    const rootDir = path.resolve(workspacePath, noteConfig.path)
    const metadataFiles = await findMetadataFiles(rootDir, noteConfig.ready)
    const seen = new Set()
    const results = []
    for (const metadataPath of metadataFiles) {
      const bundlePath = path.dirname(metadataPath)
      const result = await inspectNoteBundle({
        taskId,
        ref,
        cwd: workspacePath,
        note: noteConfig,
        bundlePath,
        metadataPath
      })
      if (result) {
        seen.add(result.resultDir)
        results.push(result)
      }
    }
    for (const [bundlePath, result] of Array.from(resultsByBundle.entries())) {
      if (result && result.cwd === workspacePath && result.watchRoot === rootDir && !seen.has(bundlePath)) {
        resultsByBundle.delete(bundlePath)
      }
    }
    return results[0] || null
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
    const filterCwd = typeof options.cwd === "string" && options.cwd.trim()
      ? path.resolve(options.cwd.trim())
      : ""
    return Array.from(resultsByBundle.values())
      .filter((result) => !filterCwd || result.cwd === filterCwd)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  async function getPendingById(id) {
    const normalizedId = typeof id === "string" ? id.trim() : ""
    if (!normalizedId) {
      return null
    }
    return Array.from(resultsByBundle.values()).find((item) => item.id === normalizedId) || null
  }

  async function refreshPendingItem(item) {
    if (!item || !item.cwd || !item.resultDir || !item.metadataPath) {
      return null
    }
    return inspectNoteBundle({
      taskId: item.taskId,
      ref: item.ref,
      cwd: item.cwd,
      note: {
        description: item.description,
        publish: item.publish
      },
      bundlePath: item.resultDir,
      metadataPath: item.metadataPath
    })
  }

  async function savePendingById(id, options = {}) {
    const item = await getPendingById(id)
    if (!item) {
      return null
    }
    const markdown = typeof options.markdown === "string" ? options.markdown : null
    if (markdown === null) {
      throw new Error("markdown is required")
    }
    if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
      const error = new Error(`note markdown is too large; limit is ${MAX_MARKDOWN_BYTES} bytes`)
      error.code = "NOTE_TOO_LARGE"
      throw error
    }

    const current = await refreshPendingItem(item)
    if (!current) {
      return null
    }
    const expectedRevision = typeof options.revision === "string" ? options.revision.trim() : ""
    if (expectedRevision && current.revision !== expectedRevision) {
      const error = new Error("Note changed on disk. Reload it before saving.")
      error.code = "NOTE_CONFLICT"
      error.item = current
      throw error
    }

    const notePath = path.resolve(current.notePath)
    const resultDir = path.resolve(current.resultDir)
    if (!isInside(notePath, resultDir)) {
      const error = new Error("Note path is outside the note folder")
      error.code = "NOTE_INVALID_PATH"
      throw error
    }

    await fs.promises.writeFile(notePath, markdown, "utf8")
    return refreshPendingItem(current)
  }

  async function start() {
  }

  async function stop() {
  }

  return {
    RESULT_RELATIVE_DIR,
    getPendingById,
    inspectNoteBundle,
    inspectWorkspace,
    listPending,
    savePendingById,
    start,
    stop,
    trackWorkspace
  }
}

module.exports = {
  createNoteService
}
