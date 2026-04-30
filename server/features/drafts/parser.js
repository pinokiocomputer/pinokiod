const fs = require("fs")
const path = require("path")

const RESULT_RELATIVE_DIR = path.join(".pinokio", "draft")
const POST_FILENAME = "post.md"
const METADATA_FILENAME = "pinokio.json"
const DEFAULT_READY_FILENAME = METADATA_FILENAME
const PREVIEW_CHARS = 1200
const MEDIA_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".webp"
])

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function extractTitle(markdown, workspaceName) {
  const lines = String(markdown || "").split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/)
    if (match && match[1]) {
      return normalizeWhitespace(match[1]).slice(0, 140) || "Draft"
    }
  }
  return workspaceName ? `Draft for ${workspaceName}` : "Draft"
}

function normalizeTitle(value) {
  return normalizeWhitespace(value).slice(0, 160)
}

function parseDraftMetadata(raw) {
  const parsed = JSON.parse(String(raw || ""))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {}
  }
  const metadata = { ...parsed }
  if (typeof metadata.title === "string") {
    metadata.title = normalizeTitle(metadata.title)
  } else {
    delete metadata.title
  }
  return metadata
}

function extractTitleAndBody(markdown, fallbackTitle) {
  const lines = String(markdown || "").split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^#\s+(.+?)\s*#*\s*$/)
    if (!match || !match[1]) continue
    const title = normalizeWhitespace(match[1]).slice(0, 160)
    const bodyLines = [...lines.slice(0, i), ...lines.slice(i + 1)]
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift()
    return { title: title || fallbackTitle, body: bodyLines.join("\n").trim() }
  }
  return { title: fallbackTitle, body: String(markdown || "").trim() }
}

function buildExcerpt(markdown) {
  const stripped = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, (match) => {
      const label = match.match(/^\[([^\]]+)]/)
      return label && label[1] ? ` ${label[1]} ` : " "
    })
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>#-]/g, " ")
  return normalizeWhitespace(stripped).slice(0, PREVIEW_CHARS)
}

function isExternalRef(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)
}

function normalizeMarkdownRef(value) {
  const raw = String(value || "").trim().replace(/^<|>$/g, "")
  if (!raw || raw.includes("\0") || isExternalRef(raw) || path.isAbsolute(raw)) {
    return ""
  }
  const withoutHash = raw.split("#")[0]
  const withoutQuery = withoutHash.split("?")[0]
  if (!withoutQuery) {
    return ""
  }
  let decoded = withoutQuery
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch (_) {
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"))
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return ""
  }
  return normalized
}

function collectMarkdownRefs(markdown) {
  const refs = []
  const seen = new Set()
  const patterns = [
    /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    /\[(?:video|audio|media|image|screenshot|file|asset)[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gi,
    /\[[^\]]+]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  ]
  for (const pattern of patterns) {
    let match = null
    while ((match = pattern.exec(markdown))) {
      const ref = normalizeMarkdownRef(match[1])
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      refs.push(ref)
    }
  }
  return refs
}

async function describeMediaRefs(markdown, baseDir, options = {}) {
  const refs = collectMarkdownRefs(markdown)
  const media = []
  for (const ref of refs) {
    const ext = path.extname(ref).toLowerCase()
    if (options.mediaOnly !== false && !MEDIA_EXTENSIONS.has(ext)) {
      continue
    }
    const filePath = path.resolve(baseDir, ref)
    const relative = path.relative(baseDir, filePath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      continue
    }
    const stats = await fs.promises.stat(filePath).catch(() => null)
    media.push({
      ref,
      path: filePath,
      bytes: stats && stats.isFile() ? stats.size : 0,
      mtimeMs: stats && stats.isFile() ? stats.mtimeMs : 0,
      exists: Boolean(stats && stats.isFile())
    })
  }
  return media
}

module.exports = {
  METADATA_FILENAME,
  DEFAULT_READY_FILENAME,
  RESULT_RELATIVE_DIR,
  POST_FILENAME,
  buildExcerpt,
  collectMarkdownRefs,
  describeMediaRefs,
  extractTitle,
  extractTitleAndBody,
  normalizeMarkdownRef,
  normalizeTitle,
  parseDraftMetadata
}
