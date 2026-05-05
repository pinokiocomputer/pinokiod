const fs = require("fs")
const path = require("path")
const PluginSources = require("./plugin_sources")

const NOTES_BEGIN = "<!-- PINOKIO:NOTES:BEGIN -->"
const NOTES_END = "<!-- PINOKIO:NOTES:END -->"
const LEGACY_DRAFTS_BEGIN = "<!-- PINOKIO:DRAFTS:BEGIN -->"
const LEGACY_DRAFTS_END = "<!-- PINOKIO:DRAFTS:END -->"

const AGENT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "QWEN.md",
  ".windsurfrules",
  ".cursorrules",
  ".clinerules",
]

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const normalizeBlock = (block) => `${String(block || "").trim()}\n`

const extractManagedBlock = (content, begin = NOTES_BEGIN, end = NOTES_END) => {
  const text = String(content || "")
  const start = text.indexOf(begin)
  const finish = text.indexOf(end, start + begin.length)
  if (start < 0 || finish < 0) {
    return ""
  }
  return text.slice(start, finish + end.length)
}

const insertionIndex = (content) => {
  const text = String(content || "")
  let offset = 0

  if (text.startsWith("---\n")) {
    const frontmatterEnd = text.indexOf("\n---\n", 4)
    if (frontmatterEnd >= 0) {
      offset = frontmatterEnd + "\n---\n".length
      while (text[offset] === "\n") {
        offset += 1
      }
    }
  }

  const rest = text.slice(offset)
  const h1 = rest.match(/^# .*(?:\n|$)/)
  if (h1) {
    return offset + h1[0].length
  }

  return offset
}

const insertManagedBlock = (content, block) => {
  const text = String(content || "").replace(/\r\n/g, "\n")
  const noteBlock = normalizeBlock(block)
  if (!text.trim()) {
    return noteBlock
  }

  const index = insertionIndex(text)
  const before = text.slice(0, index)
  const after = text.slice(index).replace(/^\n+/, "")
  const beforeGap = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
  const afterGap = after ? "\n" : ""

  return `${before}${beforeGap}${noteBlock}${afterGap}${after}`
}

const upsertManagedBlock = (content, block, begin = NOTES_BEGIN, end = NOTES_END) => {
  let text = String(content || "").replace(/\r\n/g, "\n")
  const noteBlock = normalizeBlock(block)
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`)
  const legacyPattern = new RegExp(`${escapeRegExp(LEGACY_DRAFTS_BEGIN)}[\\s\\S]*?${escapeRegExp(LEGACY_DRAFTS_END)}\\n?`)

  if (pattern.test(text)) {
    return text.replace(pattern, `${noteBlock}\n`)
  }

  text = text.replace(legacyPattern, "")
  return insertManagedBlock(text, noteBlock)
}

const containedBy = (child, parent) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

const isPluginScriptPath = (kernel, scriptPath) => {
  if (!kernel || !scriptPath) {
    return false
  }

  const absolutePath = path.resolve(scriptPath)
  if (containedBy(absolutePath, kernel.path("plugin", "code"))) {
    return false
  }

  const roots = [
    PluginSources.systemPluginRoot(kernel),
    kernel.path("plugin"),
  ].filter(Boolean)

  return roots.some((root) => containedBy(absolutePath, root))
}

const ensureManagedBlockInFile = async (filePath, block) => {
  let content = ""
  try {
    content = await fs.promises.readFile(filePath, "utf8")
  } catch (e) {
    if (!e || e.code !== "ENOENT") {
      throw e
    }
  }

  const nextContent = upsertManagedBlock(content, block)
  if (nextContent !== content) {
    await fs.promises.writeFile(filePath, nextContent, "utf8")
    return true
  }

  return false
}

const ensureNoteInstructionsForCwd = async ({ kernel, cwd }) => {
  if (!kernel || !cwd) {
    return { updated: [], skipped: "missing-cwd" }
  }

  const targetDir = path.resolve(cwd)
  const stat = await fs.promises.stat(targetDir).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    return { updated: [], skipped: "invalid-cwd" }
  }

  const sourcePath = kernel.path("prototype", "system", "AGENTS.md")
  const source = await fs.promises.readFile(sourcePath, "utf8").catch(() => "")
  const block = extractManagedBlock(source)
  if (!block) {
    return { updated: [], skipped: "missing-block" }
  }

  const updated = []
  for (const filename of AGENT_INSTRUCTION_FILES) {
    const filePath = path.join(targetDir, filename)
    if (await ensureManagedBlockInFile(filePath, block)) {
      updated.push(filePath)
    }
  }

  return { updated, skipped: null }
}

module.exports = {
  NOTES_BEGIN,
  NOTES_END,
  AGENT_INSTRUCTION_FILES,
  extractManagedBlock,
  upsertManagedBlock,
  isPluginScriptPath,
  ensureNoteInstructionsForCwd,
}
