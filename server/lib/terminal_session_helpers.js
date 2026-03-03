"use strict"

const { createTerminalSessionRegistry } = require("./terminal_session_registry")

const createTerminalSessionHelpers = ({ kernel, fs, path, os, crypto }) => {
  const TERMINAL_LAUNCH_MODE_GUARDED = "guarded"
  const TERMINAL_LAUNCH_MODE_YOLO = "yolo"
  const normalizeTerminalLaunchMode = (value, fallback = TERMINAL_LAUNCH_MODE_GUARDED) => {
    const normalizedFallback = typeof fallback === "string" && fallback.trim().toLowerCase() === TERMINAL_LAUNCH_MODE_YOLO
      ? TERMINAL_LAUNCH_MODE_YOLO
      : TERMINAL_LAUNCH_MODE_GUARDED
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
    if (!normalized) {
      return normalizedFallback
    }
    if (
      normalized === TERMINAL_LAUNCH_MODE_YOLO
      || normalized === "danger"
      || normalized === "dangerous"
      || normalized === "true-yolo"
    ) {
      return TERMINAL_LAUNCH_MODE_YOLO
    }
    if (
      normalized === TERMINAL_LAUNCH_MODE_GUARDED
      || normalized === "default"
      || normalized === "safe"
      || normalized === "standard"
    ) {
      return TERMINAL_LAUNCH_MODE_GUARDED
    }
    return normalizedFallback
  }
  const buildTerminalStartCommand = (provider, launchMode = TERMINAL_LAUNCH_MODE_GUARDED) => {
    if (!provider || typeof provider !== "object") {
      return ""
    }
    const mode = normalizeTerminalLaunchMode(launchMode, provider.defaultLaunchMode || TERMINAL_LAUNCH_MODE_GUARDED)
    const startCommands = provider.startCommands && typeof provider.startCommands === "object"
      ? provider.startCommands
      : null
    if (startCommands && typeof startCommands[mode] === "string" && startCommands[mode].trim().length > 0) {
      return startCommands[mode].trim()
    }
    if (typeof provider.startCommand === "string" && provider.startCommand.trim().length > 0) {
      return provider.startCommand.trim()
    }
    if (typeof provider.command === "string" && provider.command.trim().length > 0) {
      return provider.command.trim()
    }
    return ""
  }
  const getTerminalStarterProviders = () => {
    return [{
      key: "codex",
      label: "Codex",
      command: "npx -y @openai/codex@latest",
      defaultLaunchMode: TERMINAL_LAUNCH_MODE_GUARDED,
      startCommands: {
        [TERMINAL_LAUNCH_MODE_GUARDED]: 'npx -y @openai/codex@latest -c shell_environment_policy.inherit="all" --sandbox workspace-write --full-auto --ask-for-approval never',
        [TERMINAL_LAUNCH_MODE_YOLO]: "npx -y @openai/codex@latest --dangerously-bypass-approvals-and-sandbox"
      },
      startCommand: 'npx -y @openai/codex@latest -c shell_environment_policy.inherit="all" --sandbox workspace-write --full-auto --ask-for-approval never'
    }, {
      key: "claude",
      label: "Claude",
      command: "npx -y @anthropic-ai/claude-code@latest",
      defaultLaunchMode: TERMINAL_LAUNCH_MODE_GUARDED,
      startCommands: {
        [TERMINAL_LAUNCH_MODE_GUARDED]: "npx -y @anthropic-ai/claude-code@latest",
        [TERMINAL_LAUNCH_MODE_YOLO]: "npx -y @anthropic-ai/claude-code@latest --dangerously-skip-permissions"
      },
      startCommand: "npx -y @anthropic-ai/claude-code@latest"
    }, {
      key: "gemini",
      label: "Gemini",
      command: "npx -y @google/gemini-cli@latest",
      defaultLaunchMode: TERMINAL_LAUNCH_MODE_GUARDED,
      startCommands: {
        [TERMINAL_LAUNCH_MODE_GUARDED]: "npx -y @google/gemini-cli@latest",
        [TERMINAL_LAUNCH_MODE_YOLO]: "npx -y @google/gemini-cli@latest --approval-mode yolo --no-sandbox"
      },
      startCommand: "npx -y @google/gemini-cli@latest"
    }]
  }
  const getTerminalWorkspacesRoot = () => {
    if (kernel && typeof kernel.path === "function") {
      return kernel.path("workspaces")
    }
    return path.resolve(os.homedir(), "pinokio", "workspaces")
  }
  const isValidTerminalWorkspaceName = (value) => {
    if (typeof value !== "string") {
      return false
    }
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 80) {
      return false
    }
    if (trimmed === "." || trimmed === "..") {
      return false
    }
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
      return false
    }
    return /^[A-Za-z0-9._-]+$/.test(trimmed)
  }
  const listTerminalWorkspaceFolders = async () => {
    const root = path.resolve(getTerminalWorkspacesRoot())
    await fs.promises.mkdir(root, { recursive: true })
    let entries = []
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true })
    } catch (error) {
      return []
    }
    const folders = entries
      .filter((entry) => entry && entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => isValidTerminalWorkspaceName(name))
    folders.sort((a, b) => a.localeCompare(b))
    return folders
  }
  const generateTerminalWorkspaceFolderName = async () => {
    const existing = new Set(await listTerminalWorkspaceFolders())
    const now = new Date()
    const pad = (value) => String(value).padStart(2, "0")
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    for (let i = 0; i < 256; i++) {
      const suffix = Math.random().toString(36).slice(2, 8)
      const candidate = `${stamp}-${suffix}`
      if (!existing.has(candidate)) {
        return candidate
      }
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  const TERMINAL_WORKSPACE_GITIGNORE_ENTRIES = [
    "/.pinokio-terminal.json",
    "/.pinokio/skills/active.md",
    "/.agents/skills/pinokio-selected/"
  ]
  const normalizeGitignorePatternForComparison = (value) => {
    if (typeof value !== "string") {
      return ""
    }
    let line = value.trim()
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      return ""
    }
    line = line.replace(/^\/+/, "")
    if (line.endsWith("/")) {
      return `${line.replace(/\/+$/, "")}/`
    }
    return line
  }
  const ensureTerminalWorkspaceGitignoreEntries = async (workspacePath) => {
    if (typeof workspacePath !== "string" || workspacePath.trim().length === 0) {
      return
    }
    const workspaceRoot = path.resolve(workspacePath)
    const gitignorePath = path.resolve(workspaceRoot, ".gitignore")
    let existing = ""
    try {
      existing = await fs.promises.readFile(gitignorePath, "utf8")
    } catch (error) {
      if (!(error && error.code === "ENOENT")) {
        throw error
      }
    }
    const existingPatterns = new Set(
      String(existing || "")
        .split(/\r?\n/)
        .map((line) => normalizeGitignorePatternForComparison(line))
        .filter((line) => line.length > 0)
    )
    const missing = TERMINAL_WORKSPACE_GITIGNORE_ENTRIES.filter((pattern) => {
      const normalized = normalizeGitignorePatternForComparison(pattern)
      return normalized.length > 0 && !existingPatterns.has(normalized)
    })
    if (missing.length === 0) {
      return
    }
    let next = ""
    if (existing.length > 0 && !existing.endsWith("\n")) {
      next += "\n"
    }
    if (!/\n?# Pinokio terminal-generated files(\r?\n|$)/.test(existing)) {
      next += "# Pinokio terminal-generated files\n"
    }
    next += `${missing.join("\n")}\n`
    await fs.promises.appendFile(gitignorePath, next, "utf8")
  }
  const TERMINAL_WORKSPACE_STAT_CACHE_TTL_MS = 8000
  const terminalWorkspaceStatCache = new Map()
  const normalizeWorkspaceStatCacheKey = (workspacePath) => {
    if (typeof workspacePath !== "string") {
      return ""
    }
    const trimmed = workspacePath.trim()
    if (!trimmed) {
      return ""
    }
    const resolved = path.resolve(trimmed)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  const readTerminalWorkspaceUpdatedAt = async (workspacePath) => {
    const cacheKey = normalizeWorkspaceStatCacheKey(workspacePath)
    if (!cacheKey) {
      return null
    }
    const now = Date.now()
    const cached = terminalWorkspaceStatCache.get(cacheKey)
    if (cached && cached.expires > now) {
      return cached.value
    }
    let value = null
    try {
      const stat = await fs.promises.stat(cacheKey)
      if (stat && stat.isDirectory()) {
        const mtime = Number(stat.mtimeMs)
        if (Number.isFinite(mtime) && mtime > 0) {
          value = mtime
        } else if (stat.mtime && typeof stat.mtime.getTime === "function") {
          const parsed = stat.mtime.getTime()
          if (Number.isFinite(parsed) && parsed > 0) {
            value = parsed
          }
        }
      }
    } catch (error) {
    }
    terminalWorkspaceStatCache.set(cacheKey, {
      value,
      expires: now + TERMINAL_WORKSPACE_STAT_CACHE_TTL_MS
    })
    if (terminalWorkspaceStatCache.size > 4000) {
      for (const [key, entry] of terminalWorkspaceStatCache.entries()) {
        if (!entry || entry.expires <= now) {
          terminalWorkspaceStatCache.delete(key)
        }
        if (terminalWorkspaceStatCache.size <= 2000) {
          break
        }
      }
    }
    return value
  }
  function parseSessionTimestamp(raw) {
    if (typeof raw === "number") {
      if (raw > 1e13) {
        return raw
      }
      if (raw > 0 && raw < 1e12) {
        return raw * 1000
      }
      return raw
    }
    if (!raw || typeof raw !== "string") {
      return 0
    }
    let ts = Number(raw)
    if (!Number.isNaN(ts)) {
      if (ts > 0 && ts < 1e12) {
        return ts * 1000
      }
      return ts
    }
    let parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const TERMINAL_SKILL_CACHE_TTL_MS = 15000
  const TERMINAL_SESSION_DISCOVERY_CACHE_TTL_MS = 30000
  let terminalSkillCache = {
    expires: 0,
    items: [],
    refreshPromise: null
  }
  let terminalSessionDiscoveryCache = {
    expires: 0,
    entries: null,
    refreshPromise: null,
    updated_at: 0
  }
  const terminalSessionRegistry = createTerminalSessionRegistry({
    kernel: kernel,
    fs,
    path,
    os,
    parseSessionTimestamp
  })
  const {
    coerceTerminalRegistryItems,
    readTerminalSessionRegistry,
    writeTerminalSessionRegistry,
    updateTerminalSessionRegistrySummary,
    upsertTerminalSessionRegistryEntry
  } = terminalSessionRegistry
  const getTerminalSessionDiscoverySnapshotVersion = () => {
    const value = Number(terminalSessionDiscoveryCache.updated_at || 0)
    if (!Number.isFinite(value) || value <= 0) {
      return 0
    }
    return Math.floor(value)
  }

  const getTerminalSkillRoots = () => {
    const roots = []
    const seen = new Set()
    const addRoot = (target) => {
      if (typeof target !== "string" || target.trim().length === 0) {
        return
      }
      const resolved = path.resolve(target)
      if (seen.has(resolved)) {
        return
      }
      seen.add(resolved)
      roots.push(resolved)
    }
    const home = os.homedir()
    addRoot(path.join(home, ".agents", "skills"))
    addRoot(path.join(home, ".agent", "skills"))
    addRoot(path.join(home, ".codex", "skills"))
    addRoot(path.join(home, ".claude", "skills"))
    addRoot(path.join(home, ".gemini", "skills"))
    addRoot(path.join(home, ".config", "gemini", "skills"))
    addRoot(path.join(home, ".openclaw", "skills"))
    if (kernel && kernel.homedir) {
      addRoot(kernel.path("skills"))
    }
    return roots
  }

  const collectSkillFiles = async (root, maxDepth = 6) => {
    const files = []
    const walk = async (dir, depth) => {
      if (depth > maxDepth) {
        return
      }
      let entries = []
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch (error) {
        return
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const entryPath = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath, depth + 1)
          continue
        }
        if (!entry.isFile()) {
          continue
        }
        if (entry.name.toLowerCase() === "skill.md") {
          files.push(entryPath)
        }
      }
    }
    await walk(root, 0)
    return files
  }

  const parseSimpleFrontMatter = (text) => {
    if (typeof text !== "string") {
      return { meta: {}, body: "" }
    }
    const normalized = text.replace(/\r\n/g, "\n")
    if (!normalized.startsWith("---\n")) {
      return { meta: {}, body: normalized }
    }
    const lines = normalized.split("\n")
    let closingIndex = -1
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed === "---" || trimmed === "...") {
        closingIndex = i
        break
      }
    }
    if (closingIndex === -1) {
      return { meta: {}, body: normalized }
    }

    const frontMatterLines = lines.slice(1, closingIndex)
    const body = lines.slice(closingIndex + 1).join("\n")
    const meta = {}
    let currentKey = null
    for (let i = 0; i < frontMatterLines.length; i++) {
      const rawLine = frontMatterLines[i]
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) {
        continue
      }
      const keyMatch = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine)
      if (keyMatch) {
        const key = String(keyMatch[1]).trim().toLowerCase()
        let value = String(keyMatch[2] || "").trim()
        currentKey = key
        if (!value) {
          meta[key] = []
          continue
        }
        if (value.startsWith("[") && value.endsWith("]")) {
          const inside = value.slice(1, -1).trim()
          if (!inside) {
            meta[key] = []
          } else {
            meta[key] = inside.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
          }
          continue
        }
        value = value.replace(/^['"]|['"]$/g, "")
        meta[key] = value
        continue
      }
      const listMatch = /^\s*-\s+(.+)$/.exec(rawLine)
      if (listMatch && currentKey) {
        const value = String(listMatch[1] || "").trim().replace(/^['"]|['"]$/g, "")
        if (!Array.isArray(meta[currentKey])) {
          if (meta[currentKey] && String(meta[currentKey]).trim()) {
            meta[currentKey] = [String(meta[currentKey])]
          } else {
            meta[currentKey] = []
          }
        }
        if (value) {
          meta[currentKey].push(value)
        }
        continue
      }
      if (currentKey && typeof meta[currentKey] === "string") {
        const continuation = line.replace(/^['"]|['"]$/g, "")
        if (continuation) {
          meta[currentKey] = `${meta[currentKey]} ${continuation}`.trim()
        }
      }
    }
    return { meta, body }
  }

  const normalizeMetaList = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || "").trim()).filter(Boolean)
    }
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed) {
        return []
      }
      if (trimmed.includes(",")) {
        return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean)
      }
      return [trimmed]
    }
    return []
  }

  const parseSkillMeta = (contents, fallbackLabel) => {
    const text = typeof contents === "string" ? contents : ""
    const { meta, body } = parseSimpleFrontMatter(text)

    const stringOrEmpty = (value) => {
      return typeof value === "string" ? value.trim() : ""
    }

    const firstFromKeys = (obj, keys) => {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const value = stringOrEmpty(obj[key])
        if (value) {
          return value
        }
      }
      return ""
    }

    let label = firstFromKeys(meta, ["title", "name", "skill", "id"])
    const bodyLines = String(body || "").split(/\r?\n/)
    if (!label) {
      for (let i = 0; i < bodyLines.length; i++) {
        const trimmed = bodyLines[i].trim()
        if (!trimmed) {
          continue
        }
        if (trimmed.startsWith("#")) {
          label = trimmed.replace(/^#+\s*/, "").trim()
          break
        }
      }
    }
    if (!label) {
      label = fallbackLabel || "Skill"
    }

    let description = firstFromKeys(meta, ["description", "summary", "subtitle", "excerpt"])
    if (!description) {
      for (let i = 0; i < bodyLines.length; i++) {
        const trimmed = bodyLines[i].trim()
        if (!trimmed) {
          continue
        }
        if (trimmed === "---" || trimmed === "...") {
          continue
        }
        if (trimmed.startsWith("#")) {
          continue
        }
        if (trimmed.startsWith("```")) {
          continue
        }
        description = trimmed
        break
      }
    }
    if (description.length > 200) {
      description = `${description.slice(0, 197)}...`
    }

    const tags = normalizeMetaList(meta.tags || meta.keywords || meta.tag)
    const providerList = normalizeMetaList(meta.provider || meta.providers)
    const provider = providerList.length > 0 ? providerList[0] : ""
    const author = firstFromKeys(meta, ["author", "owner", "maintainer"])
    const version = firstFromKeys(meta, ["version"])
    const source = firstFromKeys(meta, ["source", "url", "repo", "repository"])

    return {
      label,
      description,
      tags,
      provider,
      author,
      version,
      source
    }
  }

  const normalizeTerminalSkillDedupValue = (value) => {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase()
  }

  const mergeTerminalSkillEntries = (existing, incoming) => {
    const current = existing && typeof existing === "object" ? { ...existing } : {}
    const next = incoming && typeof incoming === "object" ? incoming : {}
    const pickLonger = (left, right) => {
      const a = String(left || "").trim()
      const b = String(right || "").trim()
      if (!a) {
        return b
      }
      if (!b) {
        return a
      }
      return b.length > a.length ? b : a
    }
    const mergeTags = (left, right) => {
      const merged = new Set()
      if (Array.isArray(left)) {
        for (let i = 0; i < left.length; i++) {
          const tag = String(left[i] || "").trim()
          if (tag) {
            merged.add(tag)
          }
        }
      }
      if (Array.isArray(right)) {
        for (let i = 0; i < right.length; i++) {
          const tag = String(right[i] || "").trim()
          if (tag) {
            merged.add(tag)
          }
        }
      }
      return Array.from(merged)
    }

    return {
      ...next,
      ...current,
      label: pickLonger(current.label, next.label),
      description: pickLonger(current.description, next.description),
      source: pickLonger(current.source, next.source),
      provider: pickLonger(current.provider, next.provider),
      author: pickLonger(current.author, next.author),
      version: pickLonger(current.version, next.version),
      tags: mergeTags(current.tags, next.tags)
    }
  }

  const dedupeTerminalSkills = (items) => {
    const byKey = new Map()
    if (!Array.isArray(items)) {
      return []
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || typeof item !== "object") {
        continue
      }
      const labelKey = normalizeTerminalSkillDedupValue(item.label)
      const sourceKey = normalizeTerminalSkillDedupValue(item.source)
      const providerKey = normalizeTerminalSkillDedupValue(item.provider)
      const fallbackKey = normalizeTerminalSkillDedupValue(item.id) || normalizeTerminalSkillDedupValue(item.file)
      const dedupeKey = `${labelKey || fallbackKey}::${sourceKey}::${providerKey}`
      if (!dedupeKey) {
        continue
      }
      if (!byKey.has(dedupeKey)) {
        byKey.set(dedupeKey, item)
        continue
      }
      byKey.set(dedupeKey, mergeTerminalSkillEntries(byKey.get(dedupeKey), item))
    }
    return Array.from(byKey.values())
  }

  const listTerminalSkills = async (force = false) => {
    const now = Date.now()
    const hasCachedItems = Array.isArray(terminalSkillCache.items)
    if (!force && hasCachedItems && terminalSkillCache.expires > now) {
      return terminalSkillCache.items
    }

    if (!terminalSkillCache.refreshPromise) {
      terminalSkillCache.refreshPromise = (async () => {
        const roots = getTerminalSkillRoots()
        const items = []

        for (let i = 0; i < roots.length; i++) {
          const root = roots[i]
          let stat = null
          try {
            stat = await fs.promises.stat(root)
          } catch (error) {
            stat = null
          }
          if (!stat || !stat.isDirectory()) {
            continue
          }

          const files = await collectSkillFiles(root)
          for (let j = 0; j < files.length; j++) {
            const file = files[j]
            const skillDir = path.dirname(file)
            const relDir = path.relative(root, skillDir).split(path.sep).join("/")
            const skillId = crypto.createHash("sha1").update(file).digest("hex").slice(0, 16)

            let contents = ""
            try {
              contents = await fs.promises.readFile(file, "utf8")
            } catch (error) {
              contents = ""
            }
            const fallbackLabel = path.basename(skillDir).replace(/[-_]+/g, " ").trim() || (relDir && relDir !== "." ? relDir : skillId)
            const meta = parseSkillMeta(contents, fallbackLabel)
            items.push({
              id: skillId,
              label: meta.label,
              description: meta.description || "",
              tags: Array.isArray(meta.tags) ? meta.tags : [],
              provider: meta.provider || "",
              author: meta.author || "",
              version: meta.version || "",
              source: meta.source || "",
              file,
              root
            })
          }
        }

        const dedupedItems = dedupeTerminalSkills(items)
        dedupedItems.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)))
        terminalSkillCache.items = dedupedItems
        terminalSkillCache.expires = Date.now() + TERMINAL_SKILL_CACHE_TTL_MS
        return dedupedItems
      })().finally(() => {
        terminalSkillCache.refreshPromise = null
      })
    }

    const refreshedItems = await terminalSkillCache.refreshPromise
    if (Array.isArray(refreshedItems)) {
      return refreshedItems
    }
    return Array.isArray(terminalSkillCache.items) ? terminalSkillCache.items : []
  }

  const buildMergedSkillMarkdown = (skillsWithBody) => {
    const lines = [
      "# Pinokio selected skills",
      "",
      "This file is generated for this terminal session.",
      ""
    ]
    for (let i = 0; i < skillsWithBody.length; i++) {
      const skill = skillsWithBody[i]
      const heading = skill.label || skill.id || `Skill ${i + 1}`
      lines.push(`## ${heading}`)
      lines.push(`Source: ${skill.id}`)
      lines.push("")
      lines.push((skill.body || "").trim())
      lines.push("")
    }
    return `${lines.join("\n").trim()}\n`
  }

  const buildCodexSelectedSkillMarkdown = (mergedBody) => {
    const body = String(mergedBody || "").trim()
    const lines = [
      "---",
      "name: Pinokio Selected Skills",
      "description: Session-specific skill bundle generated from the skills selected in Pinokio.",
      "tags:",
      "- pinokio",
      "- session",
      "- selected-skills",
      "---",
      "",
      body
    ]
    return `${lines.join("\n").trim()}\n`
  }

  const ensureCodexSelectedSkillFrontmatter = async (sessionCwd) => {
    if (typeof sessionCwd !== "string" || sessionCwd.trim().length === 0) {
      return
    }
    const codexSkillPath = path.resolve(sessionCwd, ".agents", "skills", "pinokio-selected", "SKILL.md")
    let existing = ""
    try {
      existing = await fs.promises.readFile(codexSkillPath, "utf8")
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return
      }
      throw error
    }
    const normalized = String(existing || "").replace(/\r\n/g, "\n")
    if (normalized.startsWith("---\n")) {
      return
    }
    const wrapped = buildCodexSelectedSkillMarkdown(normalized)
    await fs.promises.writeFile(codexSkillPath, wrapped, "utf8")
  }

  const materializeTerminalSkillContext = async (sessionCwd, providerKey, selectedSkills) => {
    if (!Array.isArray(selectedSkills) || selectedSkills.length === 0) {
      return {
        activePath: null,
        selected: []
      }
    }

    const skillsWithBody = []
    for (let i = 0; i < selectedSkills.length; i++) {
      const skill = selectedSkills[i]
      if (!skill || !skill.file) {
        continue
      }
      let body = ""
      try {
        body = await fs.promises.readFile(skill.file, "utf8")
      } catch (error) {
        body = ""
      }
      if (!body || body.trim().length === 0) {
        continue
      }
      skillsWithBody.push({
        id: skill.id,
        label: skill.label,
        file: skill.file,
        body
      })
    }

    if (skillsWithBody.length === 0) {
      return {
        activePath: null,
        selected: []
      }
    }

    const pinokioSkillDir = path.resolve(sessionCwd, ".pinokio", "skills")
    await fs.promises.mkdir(pinokioSkillDir, { recursive: true })
    const merged = buildMergedSkillMarkdown(skillsWithBody)
    const activePath = path.resolve(pinokioSkillDir, "active.md")
    await fs.promises.writeFile(activePath, merged, "utf8")

    if (providerKey === "codex") {
      const codexSkillDir = path.resolve(sessionCwd, ".agents", "skills", "pinokio-selected")
      await fs.promises.mkdir(codexSkillDir, { recursive: true })
      const codexSkillPath = path.resolve(codexSkillDir, "SKILL.md")
      const codexSkillBody = buildCodexSelectedSkillMarkdown(merged)
      await fs.promises.writeFile(codexSkillPath, codexSkillBody, "utf8")
      const agentsPath = path.resolve(sessionCwd, "AGENTS.md")
      await fs.promises.writeFile(agentsPath, "# Pinokio session instructions\n\nUse the `pinokio-selected` skill from `.agents/skills/pinokio-selected/SKILL.md` for this workspace.\n", "utf8")
    } else if (providerKey === "claude") {
      const claudePath = path.resolve(sessionCwd, "CLAUDE.md")
      await fs.promises.writeFile(claudePath, merged, "utf8")
    } else if (providerKey === "gemini") {
      const geminiPath = path.resolve(sessionCwd, "GEMINI.md")
      await fs.promises.writeFile(geminiPath, "This file is generated by Pinokio for this session.\n\n" + merged, "utf8")
    }

    return {
      activePath,
      selected: skillsWithBody.map((skill) => ({
        id: skill.id,
        label: skill.label,
        file: skill.file
      }))
    }
  }

  const forkGeminiSessionFile = async (sourcePath, expectedSessionId) => {
    const source = typeof sourcePath === "string" ? sourcePath.trim() : ""
    if (!source) {
      throw new Error("Gemini fork failed: missing source path.")
    }
    const resolvedSourcePath = path.resolve(source)
    let payload
    try {
      const raw = await fs.promises.readFile(resolvedSourcePath, "utf8")
      payload = JSON.parse(raw)
    } catch (_) {
      throw new Error("Gemini fork failed: unable to read source session.")
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Gemini fork failed: invalid session payload.")
    }
    const sourceSessionId = typeof payload.sessionId === "string"
      ? payload.sessionId
      : (typeof payload.session_id === "string" ? payload.session_id : "")
    if (!sourceSessionId) {
      throw new Error("Gemini fork failed: missing source session ID.")
    }
    if (typeof expectedSessionId === "string" && expectedSessionId.trim().length > 0 && sourceSessionId !== expectedSessionId.trim()) {
      throw new Error("Gemini fork failed: source session mismatch.")
    }
    if (!Array.isArray(payload.messages)) {
      throw new Error("Gemini fork failed: unsupported session format.")
    }
    const newSessionId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : [
          Date.now().toString(16),
          Math.random().toString(16).slice(2),
          Math.random().toString(16).slice(2)
        ].join("-")
    const nowIso = new Date().toISOString()
    payload.sessionId = newSessionId
    if (typeof payload.session_id === "string") {
      payload.session_id = newSessionId
    }
    if (typeof payload.startTime === "string") {
      payload.startTime = nowIso
    }
    if (typeof payload.lastUpdated === "string") {
      payload.lastUpdated = nowIso
    }
    const stamp = nowIso.replace(/[:.]/g, "-")
    const filename = `session-${stamp}-${newSessionId.slice(0, 8)}.json`
    const targetPath = path.join(path.dirname(resolvedSourcePath), filename)
    await fs.promises.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8")
    return newSessionId
  }

  const parseSessionRecords = (contents) => {
    let entries = []
    if (!contents) {
      return entries
    }
    const raw = contents.trim()
    if (!raw) {
      return entries
    }
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        entries = parsed
      } else {
        entries = [parsed]
      }
      return entries
    } catch (e) {
      // fall through to jsonl parsing
    }
    const lines = contents.split(/\r?\n/)
    for (let m = 0; m < lines.length; m++) {
      const line = lines[m].trim()
      if (!line) {
        continue
      }
      try {
        entries.push(JSON.parse(line))
      } catch (e) {
        continue
      }
    }
    return entries
  }

  const extractTextContent = (value) => {
    if (!value) {
      return null
    }
    if (typeof value === "string") {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const itemText = extractTextContent(value[i])
        if (itemText) {
          return itemText
        }
      }
      return null
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") {
        const trimmed = value.text.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
      if (Array.isArray(value.content)) {
        for (let i = value.content.length - 1; i >= 0; i--) {
          const contentText = extractTextContent(value.content[i])
          if (contentText) {
            return contentText
          }
        }
      }
      if (Array.isArray(value.parts)) {
        for (let i = value.parts.length - 1; i >= 0; i--) {
          const partText = extractTextContent(value.parts[i])
          if (partText) {
            return partText
          }
        }
      }
      if (value.content && typeof value.content === "string") {
        const trimmed = value.content.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
      if (value.message && typeof value.message === "object") {
        const messageText = extractTextContent(value.message)
        if (messageText) {
          return messageText
        }
      }
      if (value.message && typeof value.message === "string") {
        const trimmed = value.message.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
    }
    return null
  }

  const trimSummary = (raw, maxLength = 140) => {
    if (!raw || typeof raw !== "string") {
      return null
    }
    const text = raw.trim().replace(/\s+/g, " ")
    if (text.length === 0) {
      return null
    }
    if (text.length <= maxLength) {
      return text
    }
    return `${text.slice(0, maxLength - 1)}…`
  }

  const extractWorkingDirectory = (record) => {
    const payload = record && typeof record === "object" ? record : null
    if (!payload) {
      return null
    }
    const keys = [
      "cwd",
      "working_directory",
      "workingDirectory",
      "workingdir",
      "workdir",
      "path",
      "pwd",
      "dir",
      "directory",
      "root",
      "root_path",
      "repo_path",
      "project_path",
      "session_path"
    ]
    for (let i = 0; i < keys.length; i++) {
      const value = payload[keys[i]]
      if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.length > 0) {
          return trimmed
        }
      }
    }
    const nestedObjects = [payload.project, payload.repo, payload.workspace, payload.context]
    for (let i = 0; i < nestedObjects.length; i++) {
      const nested = nestedObjects[i]
      if (!nested || typeof nested !== "object") {
        continue
      }
      for (let j = 0; j < keys.length; j++) {
        const value = nested[keys[j]]
        if (typeof value === "string") {
          const trimmed = value.trim()
          if (trimmed.length > 0) {
            return trimmed
          }
        }
      }
    }
    return null
  }

  const buildSessionSummary = (record) => {
    const candidate = record && record.payload && typeof record.payload === "object" ? record.payload : (record || {})
    const candidateKeys = ["summary", "title", "name", "label", "subject", "goal", "task", "prompt", "description", "first_message", "last_message", "text", "content", "message"]
    for (let i = 0; i < candidateKeys.length; i++) {
      const key = candidateKeys[i]
      const text = trimSummary(extractTextContent(candidate[key]), 160)
      if (text) {
        return text
      }
    }
    if (Array.isArray(candidate.messages)) {
      for (let i = candidate.messages.length - 1; i >= 0; i--) {
        const msg = candidate.messages[i]
        if (msg && typeof msg === "object") {
          const role = typeof msg.role === "string" ? msg.role.toLowerCase() : ""
          const type = typeof msg.type === "string" ? msg.type.toLowerCase() : ""
          const author = typeof msg.author === "string" ? msg.author.toLowerCase() : ""
          const isUserMessage = role === "user" || type === "user" || author === "user" || author === "human"
          if (isUserMessage) {
            const text = trimSummary(extractTextContent(msg), 160)
            if (text) {
              return text
            }
          }
        }
      }
    }
    if (Array.isArray(candidate.turns)) {
      for (let i = candidate.turns.length - 1; i >= 0; i--) {
        const turn = candidate.turns[i]
        const text = trimSummary(extractTextContent(turn), 160)
        if (text) {
          return text
        }
      }
    }
    return null
  }

  const normalizeDiscoveredSessionSummary = (value) => {
    const summary = trimSummary(value, 160)
    if (!summary) {
      return null
    }
    if (/^(resume|continue|start)\.?$/i.test(summary)) {
      return "Resumed session"
    }
    const normalized = summary.toLowerCase()
    const bootstrapPrefixes = [
      "# agents.md instructions",
      "<environment_context>",
      "<permissions instructions>",
      "<app-context>",
      "<collaboration_mode>",
      "<instructions>"
    ]
    for (let i = 0; i < bootstrapPrefixes.length; i++) {
      if (normalized.startsWith(bootstrapPrefixes[i])) {
        return null
      }
    }
    return summary
  }

  const buildClaudeUserPromptSummary = (record) => {
    const candidate = record && typeof record === "object" ? record : null
    if (!candidate) {
      return null
    }
    const normalizeClaudeSummary = (value) => {
      const summary = trimSummary(value, 160)
      if (!summary) {
        return null
      }
      if (/^(resume|continue|start)\.?$/i.test(summary)) {
        return "Resumed session"
      }
      return summary
    }
    const message = candidate.message && typeof candidate.message === "object" ? candidate.message : null
    if (message) {
      const role = typeof message.role === "string" ? message.role.toLowerCase() : ""
      if (role && role !== "user") {
        return null
      }
      if (typeof message.content === "string") {
        return normalizeClaudeSummary(message.content)
      }
      if (Array.isArray(message.content)) {
        for (let i = message.content.length - 1; i >= 0; i--) {
          const part = message.content[i]
          if (!part || typeof part !== "object") {
            continue
          }
          const partType = typeof part.type === "string" ? part.type.toLowerCase() : ""
          if (partType === "tool_result") {
            continue
          }
          const text = normalizeClaudeSummary(extractTextContent(part))
          if (text) {
            return text
          }
        }
      }
      return null
    }
    const fallback = extractTextContent(candidate.prompt || candidate.content || candidate.text)
    return normalizeClaudeSummary(fallback)
  }

  const buildTerminalSessions = async (forceDiscovery = false, options = {}) => {
    const cacheOnly = Boolean(options && options.cacheOnly)
      const buildCodexResumeBaseCommand = (entry) => {
        const defaultCommand = entry && entry.command ? entry.command : "npx -y @openai/codex@latest"
        return {
          command: defaultCommand,
          fallback: null
        }
      }

    const normalizeDiscoveryRoots = (roots) => {
      const unique = []
      const seen = new Set()
      for (let i = 0; i < roots.length; i++) {
        const target = roots[i]
        if (typeof target !== "string" || target.trim().length === 0) {
          continue
        }
        const resolved = path.resolve(target)
        if (seen.has(resolved)) {
          continue
        }
        seen.add(resolved)
        unique.push(resolved)
      }
      return unique
    }

    const buildClaudeDiscoveryRoots = (homeDir) => {
      const roots = [
        path.join(homeDir, ".claude", "projects"),
        path.join(homeDir, ".claude", "history.jsonl")
      ]
      if (process.platform === "darwin") {
        roots.push(
          path.join(homeDir, "Library", "Application Support", "Claude", "projects"),
          path.join(homeDir, "Library", "Application Support", "Claude", "history.jsonl"),
          path.join(homeDir, "Library", "Application Support", "Claude Desktop", "projects"),
          path.join(homeDir, "Library", "Application Support", "Claude Desktop", "history.jsonl")
        )
      } else if (process.platform === "win32") {
        roots.push(
          path.join(homeDir, "AppData", "Roaming", "Claude", "projects"),
          path.join(homeDir, "AppData", "Roaming", "Claude", "history.jsonl"),
          path.join(homeDir, "AppData", "Roaming", "Claude Desktop", "projects"),
          path.join(homeDir, "AppData", "Roaming", "Claude Desktop", "history.jsonl")
        )
      } else {
        roots.push(
          path.join(homeDir, ".config", "Claude", "projects"),
          path.join(homeDir, ".config", "Claude", "history.jsonl"),
          path.join(homeDir, ".config", "Claude Desktop", "projects"),
          path.join(homeDir, ".config", "Claude Desktop", "history.jsonl")
        )
      }
      return normalizeDiscoveryRoots(roots)
    }

    const normalizeSessionIdentifier = (value) => {
      if (value === null || typeof value === "undefined") {
        return null
      }
      const text = String(value).trim()
      if (!text) {
        return null
      }
      return text
    }

    const isLikelyCodexThreadId = (value) => {
      return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    }

    const isOpenClawDiscoveryPath = (filePath) => {
      if (typeof filePath !== "string" || filePath.length === 0) {
        return false
      }
      const resolved = path.resolve(filePath)
      if (resolved.includes(`${path.sep}.openclaw${path.sep}`)) {
        return true
      }
      return resolved.includes(`${path.sep}.openclaw-`)
    }

    const codexSessionIdKeys = [
      "session_id",
      "sessionId",
      "id",
      "thread_id",
      "threadId",
      "conversation_id",
      "conversationId",
      "chat_id",
      "chatId",
      "backend_session_id",
      "backendSessionId",
      "codex_session_id",
      "codexSessionId"
    ]
    const claudeSessionIdKeys = [
      "sessionId",
      "session_id",
      "conversationId",
      "conversation_id"
    ]
    const geminiSessionIdKeys = [
      "conversation_id",
      "conversationId",
      "session_id",
      "sessionId",
      "chat_id",
      "chatId",
      "id"
    ]

    const findSessionField = (candidate, keys = codexSessionIdKeys) => {
      if (!candidate || typeof candidate !== "object") {
        return null
      }
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const value = candidate[key]
        if (typeof value !== "string") {
          continue
        }
        const normalized = normalizeSessionIdentifier(value)
        if (!normalized) {
          continue
        }
        return { key, value: normalized }
      }
      return null
    }

    const providerHintTerms = {
      codex: ["codex", "@openai/codex", "openai/codex"],
      claude: ["claude", "claude-code", "@anthropic-ai/claude-code", "anthropic"],
      gemini: ["gemini", "gemini-cli", "@google/gemini-cli"]
    }
    const providerHintKeys = Object.keys(providerHintTerms)
    const providerHintTermsFlat = providerHintKeys.reduce((all, key) => all.concat(providerHintTerms[key]), [])
    const stringHasHintTerm = (value, terms) => {
      if (typeof value !== "string") {
        return false
      }
      const lower = value.toLowerCase()
      for (let i = 0; i < terms.length; i++) {
        if (lower.includes(terms[i])) {
          return true
        }
      }
      return false
    }
    const getProviderHintTerms = (providerKey) => {
      if (!providerKey || typeof providerKey !== "string") {
        return []
      }
      const normalized = providerKey.toLowerCase()
      return Array.isArray(providerHintTerms[normalized]) ? providerHintTerms[normalized] : []
    }
    const recordHasHintTerms = (value, terms = providerHintTermsFlat, maxDepth = 3, maxNodes = 120) => {
      if (!Array.isArray(terms) || terms.length === 0) {
        return false
      }
      const seen = new Set()
      let nodesVisited = 0
      const inspect = (candidate, depth) => {
        if (!candidate || depth > maxDepth || nodesVisited > maxNodes) {
          return false
        }
        if (typeof candidate === "string") {
          return stringHasHintTerm(candidate, terms)
        }
        if (typeof candidate !== "object") {
          return false
        }
        if (seen.has(candidate)) {
          return false
        }
        seen.add(candidate)
        nodesVisited += 1
        if (Array.isArray(candidate)) {
          for (let i = 0; i < candidate.length; i++) {
            if (inspect(candidate[i], depth + 1)) {
              return true
            }
          }
          return false
        }
        const keys = Object.keys(candidate)
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]
          if (stringHasHintTerm(key, terms)) {
            return true
          }
          if (inspect(candidate[key], depth + 1)) {
            return true
          }
        }
        return false
      }
      return inspect(value, 0)
    }
    const recordHasCodexHint = (value, maxDepth = 3, maxNodes = 120) => {
      return recordHasHintTerms(value, getProviderHintTerms("codex"), maxDepth, maxNodes)
    }
    const buildOpenClawProviderPathHints = (filePath) => {
      const hints = {}
      const normalizedPath = typeof filePath === "string" ? path.resolve(filePath).toLowerCase() : ""
      for (let i = 0; i < providerHintKeys.length; i++) {
        const key = providerHintKeys[i]
        hints[key] = stringHasHintTerm(normalizedPath, getProviderHintTerms(key))
      }
      return hints
    }

    const isCodexFieldAllowed = (field, candidate, filePath, codexHint = false) => {
      if (!field || !field.key || !field.value) {
        return false
      }
      const keyLower = String(field.key).toLowerCase()
      const openClawPath = isOpenClawDiscoveryPath(filePath)
      const isThreadField = keyLower === "thread_id" || keyLower === "threadid"
      const isCodexSpecificField = keyLower.includes("codex") || keyLower.includes("backend_session")
      if (isThreadField && !isLikelyCodexThreadId(field.value)) {
        return false
      }
      if (!openClawPath) {
        return true
      }
      if (isThreadField || isCodexSpecificField) {
        return true
      }
      return codexHint || recordHasCodexHint(candidate)
    }
    const isClaudeFieldAllowed = (field, _candidate, filePath, claudeHint = false, otherProviderHint = false, pathHints = null) => {
      if (!field || !field.key || !field.value) {
        return false
      }
      if (!isOpenClawDiscoveryPath(filePath)) {
        return true
      }
      const keyLower = String(field.key).toLowerCase()
      const explicitClaudeField = keyLower === "sessionid"
        || keyLower === "session_id"
        || keyLower === "conversationid"
        || keyLower === "conversation_id"
      if (!explicitClaudeField) {
        return false
      }
      const pathClaudeHint = Boolean(pathHints && pathHints.claude)
      const ownHint = claudeHint || pathClaudeHint
      if (explicitClaudeField && !otherProviderHint) {
        return true
      }
      return ownHint && !otherProviderHint
    }
    const isGeminiFieldAllowed = (field, _candidate, filePath, geminiHint = false, otherProviderHint = false, pathHints = null) => {
      if (!field || !field.key || !field.value) {
        return false
      }
      if (!isOpenClawDiscoveryPath(filePath)) {
        return true
      }
      const keyLower = String(field.key).toLowerCase()
      const isGeminiKey = keyLower === "sessionid"
        || keyLower === "session_id"
        || keyLower === "id"
        || keyLower.includes("conversation")
        || keyLower.includes("chat")
      if (!isGeminiKey) {
        return false
      }
      const pathGeminiHint = Boolean(pathHints && pathHints.gemini)
      const ownHint = geminiHint || pathGeminiHint
      return ownHint && !otherProviderHint
    }

    const buildOpenClawStateRoots = async (homeDir) => {
      const roots = [path.join(homeDir, ".openclaw")]
      if (typeof process.env.OPENCLAW_HOME === "string" && process.env.OPENCLAW_HOME.trim().length > 0) {
        roots.push(process.env.OPENCLAW_HOME.trim())
      }
      if (typeof process.env.OPENCLAW_STATE_DIR === "string" && process.env.OPENCLAW_STATE_DIR.trim().length > 0) {
        roots.push(process.env.OPENCLAW_STATE_DIR.trim())
      }
      if (typeof process.env.OPENCLAW_PROFILE === "string" && process.env.OPENCLAW_PROFILE.trim().length > 0 && process.env.OPENCLAW_PROFILE.trim() !== "default") {
        roots.push(path.join(homeDir, `.openclaw-${process.env.OPENCLAW_PROFILE.trim()}`))
      }
      let entries = []
      try {
        entries = await fs.promises.readdir(homeDir, { withFileTypes: true })
      } catch (error) {
        return normalizeDiscoveryRoots(roots)
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry || !entry.isDirectory()) {
          continue
        }
        if (typeof entry.name !== "string" || !entry.name.startsWith(".openclaw-")) {
          continue
        }
        roots.push(path.join(homeDir, entry.name))
      }
      return normalizeDiscoveryRoots(roots)
    }
    const buildOpenClawAgentSessionRoots = async (homeDir) => {
      const roots = []
      const addRoot = (target) => {
        if (typeof target !== "string" || target.trim().length === 0) {
          return
        }
        roots.push(path.resolve(target))
      }
      const openClawStateRoots = await buildOpenClawStateRoots(homeDir)
      for (let i = 0; i < openClawStateRoots.length; i++) {
        const stateRoot = openClawStateRoots[i]
        const agentsRoot = path.join(stateRoot, "agents")
        let agentEntries = []
        try {
          agentEntries = await fs.promises.readdir(agentsRoot, { withFileTypes: true })
        } catch (error) {
          addRoot(agentsRoot)
          continue
        }
        for (let j = 0; j < agentEntries.length; j++) {
          const agentEntry = agentEntries[j]
          if (!agentEntry || !agentEntry.isDirectory()) {
            continue
          }
          addRoot(path.join(agentsRoot, agentEntry.name, "sessions"))
        }
      }
      return normalizeDiscoveryRoots(roots)
    }

    const buildCodexDiscovery = async (homeDir, openClawAgentSessionRoots = []) => {
      const codexHomes = []
      const addCodexHome = (target) => {
        if (typeof target !== "string" || target.trim().length === 0) {
          return
        }
        codexHomes.push(path.resolve(target))
      }
      addCodexHome(path.join(homeDir, ".codex"))
      addCodexHome(path.join(homeDir, ".config", "codex"))
      addCodexHome(process.env.CODEX_HOME)

      const roots = []
      const transcriptRoots = []
      const addRoot = (target) => {
        if (typeof target !== "string" || target.trim().length === 0) {
          return
        }
        roots.push(path.resolve(target))
      }
      const addTranscriptRoot = (target) => {
        if (typeof target !== "string" || target.trim().length === 0) {
          return
        }
        transcriptRoots.push(path.resolve(target))
      }

      for (let i = 0; i < codexHomes.length; i++) {
        const codexHome = codexHomes[i]
        const sessionsRoot = path.join(codexHome, "sessions")
        const archivedSessionsRoot = path.join(codexHome, "archived_sessions")
        addTranscriptRoot(sessionsRoot)
        addTranscriptRoot(archivedSessionsRoot)
        addRoot(sessionsRoot)
        addRoot(archivedSessionsRoot)
        addRoot(path.join(codexHome, "history.jsonl"))
      }

      for (let i = 0; i < openClawAgentSessionRoots.length; i++) {
        addRoot(openClawAgentSessionRoots[i])
      }

      return {
        roots: normalizeDiscoveryRoots(roots),
        transcriptRoots: normalizeDiscoveryRoots(transcriptRoots)
      }
    }

    const collectCodexOpenClawSessions = (record, filePath) => {
      const results = []
      const seenIds = new Set()
      const seenNodes = new Set()
      const maxDepth = 6
      const maxEntries = 128
      const walk = (candidate, depth, inheritedHint = false) => {
        if (!candidate || typeof candidate !== "object" || depth > maxDepth || results.length >= maxEntries) {
          return
        }
        if (seenNodes.has(candidate)) {
          return
        }
        seenNodes.add(candidate)
        const localCodexHint = inheritedHint || recordHasCodexHint(candidate, 2, 50)
        const candidateType = typeof candidate.type === "string" ? candidate.type.toLowerCase() : ""
        // OpenClaw session logs include many message/tool-call ids. Only treat top-level
        // session envelopes as resumable session sources.
        const isOpenClawSessionEnvelope = candidateType === "session" || candidateType === "session_meta"
        const sessionField = isOpenClawSessionEnvelope ? findSessionField(candidate) : null
        if (sessionField && isCodexFieldAllowed(sessionField, candidate, filePath, localCodexHint)) {
          const sessionId = sessionField.value
          if (!seenIds.has(sessionId)) {
            const cwdValue = extractWorkingDirectory(candidate) || extractWorkingDirectory(record)
            const cwd = typeof cwdValue === "string" ? cwdValue.trim() : ""
            if (cwd) {
              seenIds.add(sessionId)
              const summary = normalizeDiscoveredSessionSummary(buildSessionSummary(candidate) || buildSessionSummary(record))
              const timestamp = parseSessionTimestamp(
                candidate.timestamp
                || candidate.ts
                || candidate.updated_at
                || candidate.created_at
                || record.timestamp
                || record.ts
                || record.updated_at
                || record.created_at
              )
              results.push({
                id: sessionId,
                cwd,
                summary,
                timestamp,
                source: filePath,
                metadata: candidate
              })
            }
          }
        }
        if (depth >= maxDepth) {
          return
        }
        if (Array.isArray(candidate)) {
          for (let i = 0; i < candidate.length; i++) {
            walk(candidate[i], depth + 1, localCodexHint)
          }
          return
        }
        const keys = Object.keys(candidate)
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]
          const value = candidate[key]
          if (!value || typeof value !== "object") {
            continue
          }
          const inheritedFromKey = localCodexHint || key.toLowerCase().includes("codex")
          walk(value, depth + 1, inheritedFromKey)
        }
      }
      walk(record, 0, false)
      return results
    }
    const collectOpenClawSessionsForProvider = (record, filePath, options = {}) => {
      const results = []
      const seenIds = new Set()
      const seenNodes = new Set()
      const providerKey = typeof options.providerKey === "string" ? options.providerKey.toLowerCase() : ""
      const sessionIdKeys = Array.isArray(options.sessionIdKeys) && options.sessionIdKeys.length > 0
        ? options.sessionIdKeys
        : codexSessionIdKeys
      const allowField = typeof options.allowField === "function" ? options.allowField : (() => true)
      const providerTerms = getProviderHintTerms(providerKey)
      const otherProviderTerms = providerHintKeys
        .filter((key) => key !== providerKey)
        .reduce((all, key) => all.concat(getProviderHintTerms(key)), [])
      const pathHints = buildOpenClawProviderPathHints(filePath)
      const maxDepth = 6
      const maxEntries = 128
      const walk = (candidate, depth, inheritedProviderHint = false, inheritedOtherHint = false) => {
        if (!candidate || typeof candidate !== "object" || depth > maxDepth || results.length >= maxEntries) {
          return
        }
        if (seenNodes.has(candidate)) {
          return
        }
        seenNodes.add(candidate)
        const localProviderHint = inheritedProviderHint
          || Boolean(pathHints[providerKey])
          || recordHasHintTerms(candidate, providerTerms, 2, 50)
        const localOtherHint = inheritedOtherHint || recordHasHintTerms(candidate, otherProviderTerms, 2, 50)
        const sessionField = findSessionField(candidate, sessionIdKeys)
        if (sessionField && allowField(sessionField, candidate, filePath, localProviderHint, localOtherHint, pathHints)) {
          const sessionId = sessionField.value
          if (!seenIds.has(sessionId)) {
            seenIds.add(sessionId)
            const summary = normalizeDiscoveredSessionSummary(buildSessionSummary(candidate) || buildSessionSummary(record))
            const cwd = extractWorkingDirectory(candidate) || extractWorkingDirectory(record)
            const timestamp = parseSessionTimestamp(
              candidate.timestamp
              || candidate.ts
              || candidate.updated_at
              || candidate.updatedAt
              || candidate.created_at
              || candidate.createdAt
              || record.timestamp
              || record.ts
              || record.updated_at
              || record.updatedAt
              || record.created_at
              || record.createdAt
            )
            results.push({
              id: sessionId,
              cwd,
              summary,
              timestamp,
              source: filePath,
              metadata: candidate
            })
          }
        }
        if (depth >= maxDepth) {
          return
        }
        if (Array.isArray(candidate)) {
          for (let i = 0; i < candidate.length; i++) {
            walk(candidate[i], depth + 1, localProviderHint, localOtherHint)
          }
          return
        }
        const keys = Object.keys(candidate)
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]
          const value = candidate[key]
          if (!value || typeof value !== "object") {
            continue
          }
          const inheritedFromKey = localProviderHint || stringHasHintTerm(key, providerTerms)
          const inheritedOtherFromKey = localOtherHint || stringHasHintTerm(key, otherProviderTerms)
          walk(value, depth + 1, inheritedFromKey, inheritedOtherFromKey)
        }
      }
      walk(record, 0, false, false)
      return results
    }

    const home = os.homedir()
    const configuredHome = kernel && kernel.homedir ? path.resolve(kernel.homedir) : null
    const openClawAgentSessionRoots = await buildOpenClawAgentSessionRoots(home)
    const codexDiscovery = await buildCodexDiscovery(home, openClawAgentSessionRoots)
    const codexDiscoveryRoots = codexDiscovery.roots
    const codexTranscriptRoots = codexDiscovery.transcriptRoots
    const isPathWithinRoots = (filePath, roots = []) => {
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return false
      }
      const resolved = path.resolve(filePath)
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i]
        if (typeof root !== "string" || root.trim().length === 0) {
          continue
        }
        const resolvedRoot = path.resolve(root)
        if (resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
          return true
        }
      }
      return false
    }
    const claudeDiscoveryRoots = normalizeDiscoveryRoots([
      ...buildClaudeDiscoveryRoots(home),
      ...openClawAgentSessionRoots
    ])
    const geminiHomeRoots = normalizeDiscoveryRoots([
      home,
      configuredHome
    ])
    const geminiRootCandidates = []
    for (let i = 0; i < geminiHomeRoots.length; i++) {
      const rootHome = geminiHomeRoots[i]
      geminiRootCandidates.push(path.join(rootHome, ".gemini", "tmp"))
      geminiRootCandidates.push(path.join(rootHome, ".config", "gemini", "tmp"))
    }
    const geminiCanonicalRoots = normalizeDiscoveryRoots(geminiRootCandidates)
    const geminiProjectRootCache = new Map()
    const getGeminiCanonicalTokenFromFile = (filePath) => {
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return null
      }
      const resolved = path.resolve(filePath)
      for (let i = 0; i < geminiCanonicalRoots.length; i++) {
        const root = geminiCanonicalRoots[i]
        if (!root) {
          continue
        }
        const resolvedRoot = path.resolve(root)
        if (!(resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`))) {
          continue
        }
        const relative = path.relative(resolvedRoot, resolved)
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          continue
        }
        const token = normalizeSessionToken(relative.split(path.sep)[0])
        if (token) {
          return token
        }
      }
      return null
    }
    const resolveGeminiProjectRoot = (filePath) => {
      const token = getGeminiCanonicalTokenFromFile(filePath)
      if (!token) {
        return null
      }
      if (geminiProjectRootCache.has(token)) {
        const cached = geminiProjectRootCache.get(token)
        return cached || null
      }
      let projectRoot = null
      for (let i = 0; i < geminiCanonicalRoots.length; i++) {
        const root = geminiCanonicalRoots[i]
        if (!root) {
          continue
        }
        const markerPath = path.resolve(root, token, ".project_root")
        try {
          const marker = fs.readFileSync(markerPath, "utf8")
          const normalized = typeof marker === "string" ? marker.trim() : ""
          if (normalized.length > 0) {
            projectRoot = normalized
            break
          }
        } catch (error) {
        }
      }
      geminiProjectRootCache.set(token, projectRoot || "")
      return projectRoot
    }
    const isGeminiCanonicalSessionFile = (filePath) => {
      if (typeof filePath !== "string" || filePath.length === 0) {
        return false
      }
      if (isOpenClawDiscoveryPath(filePath)) {
        return false
      }
      if (!isPathWithinRoots(filePath, geminiCanonicalRoots)) {
        return false
      }
      return /[\\/]chats[\\/]session-[^\\/]+\.json$/i.test(path.resolve(filePath))
    }
    const isGeminiCanonicalLogFile = (filePath) => {
      if (typeof filePath !== "string" || filePath.length === 0) {
        return false
      }
      if (isOpenClawDiscoveryPath(filePath)) {
        return false
      }
      if (!isPathWithinRoots(filePath, geminiCanonicalRoots)) {
        return false
      }
      return /[\\/]logs\.json$/i.test(path.resolve(filePath))
    }
    const isGeminiForkCapableRecord = (candidate, filePath) => {
      if (!candidate || typeof candidate !== "object") {
        return false
      }
      if (!isGeminiCanonicalSessionFile(filePath)) {
        return false
      }
      const sessionId = normalizeSessionIdentifier(candidate.sessionId || candidate.session_id)
      if (!sessionId) {
        return false
      }
      return Array.isArray(candidate.messages)
    }
    const geminiDiscoveryRoots = normalizeDiscoveryRoots([
      ...geminiCanonicalRoots,
      ...openClawAgentSessionRoots
    ])
    const starterProviders = new Map(getTerminalStarterProviders().map((provider) => [provider.key, provider]))
    const providers = [{
      key: "codex",
      label: "Codex",
      command: starterProviders.get("codex") ? starterProviders.get("codex").command : "npx -y @openai/codex@latest",
      resumeTemplate: "%COMMAND% resume %SESSION_ID_JSON%",
      forkTemplate: "%COMMAND% fork %SESSION_ID_JSON%",
      roots: codexDiscoveryRoots,
      fileFilters: [],
      extract: (record, filePath) => {
        if (!record || typeof record !== "object") {
          return null
        }

        if (isOpenClawDiscoveryPath(filePath)) {
          const openClawSessions = collectCodexOpenClawSessions(record, filePath)
          if (openClawSessions.length > 0) {
            return openClawSessions
          }
        }

        let payload = null
        if (record.type === "session_meta" && record.payload && typeof record.payload === "object") {
          payload = record.payload
        }

        // .codex/history.jsonl has flat session_id rows
        const flatSessionField = !payload ? findSessionField(record) : null
        if (flatSessionField && isCodexFieldAllowed(flatSessionField, record, filePath)) {
          const summary = normalizeDiscoveredSessionSummary(buildSessionSummary(record))
          return {
            id: flatSessionField.value,
            cwd: null,
            summary,
            timestamp: parseSessionTimestamp(record.ts || record.timestamp),
            source: filePath,
          }
        }

        const payloadSessionField = payload ? findSessionField(payload) : null
        if (!payloadSessionField || !isCodexFieldAllowed(payloadSessionField, payload, filePath)) {
          return null
        }
        const summary = normalizeDiscoveredSessionSummary(buildSessionSummary(payload) || buildSessionSummary(record))
        const cwd = extractWorkingDirectory(payload) || extractWorkingDirectory(record)
        return {
          id: payloadSessionField.value,
          cwd,
          summary,
          timestamp: parseSessionTimestamp(payload.timestamp || record.timestamp),
          source: filePath,
          metadata: payload
        }
      }
    }, {
      key: "claude",
      label: "Claude",
      command: starterProviders.get("claude") ? starterProviders.get("claude").command : "npx -y @anthropic-ai/claude-code@latest",
      resumeTemplate: "%COMMAND% --resume %SESSION_ID_JSON%",
      forkTemplate: "%COMMAND% --resume %SESSION_ID_JSON% --fork-session",
      roots: claudeDiscoveryRoots,
      fileFilters: [".jsonl"],
      extract: (record, filePath) => {
        if (!record || typeof record !== "object") {
          return null
        }
        if (isOpenClawDiscoveryPath(filePath)) {
          const openClawSessions = collectOpenClawSessionsForProvider(record, filePath, {
            providerKey: "claude",
            sessionIdKeys: claudeSessionIdKeys,
            allowField: isClaudeFieldAllowed
          })
          if (openClawSessions.length > 0) {
            return openClawSessions
          }
        }
        if (typeof filePath === "string" && filePath.includes(`${path.sep}subagents${path.sep}`)) {
          return null
        }
        const candidate = record.payload && typeof record.payload === "object" ? record.payload : record
        const strictSessionField = findSessionField(candidate, ["sessionId", "session_id"])
        const fallbackSessionField = strictSessionField ? null : findSessionField(candidate, claudeSessionIdKeys)
        const sessionField = strictSessionField || fallbackSessionField
        const sessionId = sessionField ? sessionField.value : null
        if (!sessionId) {
          return null
        }
        const recordType = typeof candidate.type === "string" ? candidate.type.toLowerCase() : ""
        const messageRole = candidate.message && typeof candidate.message === "object" && typeof candidate.message.role === "string"
          ? candidate.message.role.toLowerCase()
          : ""
        const isUserRecord = recordType === "user" || messageRole === "user"
        const summary = isUserRecord ? buildClaudeUserPromptSummary(candidate) : null
        return {
          id: sessionId,
          cwd: extractWorkingDirectory(candidate) || extractWorkingDirectory(record),
          summary,
          timestamp: parseSessionTimestamp(candidate.timestamp || candidate.ts || candidate.updated_at || candidate.created_at || candidate.started_at || record.timestamp || record.ts || record.updated_at || record.created_at),
          source: candidate.source || null
        }
      }
    }, {
      key: "gemini",
      label: "Gemini",
      command: starterProviders.get("gemini") ? starterProviders.get("gemini").command : "npx -y @google/gemini-cli@latest",
      resumeTemplate: "%COMMAND% --resume %SESSION_ID_JSON%",
      forkTemplate: "%COMMAND% --resume %SESSION_ID_JSON%",
      roots: geminiDiscoveryRoots,
      fileFilters: [],
      shouldIncludeFile: (filePath) => {
        if (isOpenClawDiscoveryPath(filePath)) {
          return true
        }
        return isGeminiCanonicalSessionFile(filePath) || isGeminiCanonicalLogFile(filePath)
      },
      extract: (record, filePath) => {
        if (!record || typeof record !== "object") {
          return null
        }
        if (isOpenClawDiscoveryPath(filePath)) {
          const openClawSessions = collectOpenClawSessionsForProvider(record, filePath, {
            providerKey: "gemini",
            sessionIdKeys: geminiSessionIdKeys,
            allowField: isGeminiFieldAllowed
          })
          if (openClawSessions.length > 0) {
            return openClawSessions.map((entry) => ({
              ...entry,
              fork_capable: false
            }))
          }
        }
        const candidate = record.payload && typeof record.payload === "object" ? record.payload : record
        if (isGeminiCanonicalLogFile(filePath)) {
          const sessionField = findSessionField(candidate, geminiSessionIdKeys)
          const sessionId = sessionField ? sessionField.value : null
          if (!sessionId) {
            return null
          }
          const recordType = typeof candidate.type === "string" ? candidate.type.toLowerCase() : ""
          const isUserRecord = recordType === "user"
          const summary = normalizeDiscoveredSessionSummary(
            isUserRecord
              ? extractTextContent(candidate.message || candidate.content || candidate.prompt || candidate.text)
              : buildSessionSummary(candidate)
          )
          return {
            id: sessionId,
            cwd: extractWorkingDirectory(candidate) || resolveGeminiProjectRoot(filePath),
            summary,
            timestamp: parseSessionTimestamp(candidate.timestamp || candidate.ts || candidate.lastUpdated || candidate.startTime || record.timestamp || record.ts),
            source: filePath,
            source_kind: "gemini_log",
            resume_capable: false,
            resume_disabled_reason: "Gemini log-only session cannot be resumed directly.",
            fork_capable: false
          }
        }
        if (!isGeminiCanonicalSessionFile(filePath)) {
          return null
        }
        const sessionField = findSessionField(candidate, geminiSessionIdKeys)
        const sessionId = sessionField ? sessionField.value : null
        if (!sessionId) {
          return null
        }
        const rootSessionId = normalizeSessionIdentifier(candidate.sessionId || candidate.session_id)
        const forkCapable = isGeminiForkCapableRecord(candidate, filePath) && rootSessionId === sessionId
        const summary = normalizeDiscoveredSessionSummary(buildSessionSummary(candidate))
        return {
          id: sessionId,
          cwd: extractWorkingDirectory(candidate) || resolveGeminiProjectRoot(filePath),
          summary,
          timestamp: parseSessionTimestamp(candidate.timestamp || candidate.ts || candidate.lastUpdated || candidate.startTime || record.timestamp || record.ts),
          source: filePath,
          source_kind: "gemini_session",
          resume_capable: true,
          fork_capable: forkCapable
        }
      }
    }]
    const normalizeSessionToken = (value) => {
      if (value === null || typeof value === "undefined") {
        return null
      }
      let normalized = String(value).trim()
      if (!normalized) {
        return null
      }
      try {
        normalized = decodeURIComponent(normalized)
      } catch (error) {
      }
      normalized = normalized.trim()
      if (!normalized) {
        return null
      }
      if ((normalized.startsWith("\"") && normalized.endsWith("\"")) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
        normalized = normalized.slice(1, -1).trim()
      }
      return normalized || null
    }
    const runningShellIdByTerminalSession = new Map()
    if (kernel && kernel.shell && Array.isArray(kernel.shell.shells)) {
      for (const shellEntry of kernel.shell.shells) {
        const shellIdText = shellEntry && shellEntry.id ? String(shellEntry.id) : ""
        if (!shellIdText) {
          continue
        }
        const querySeparatorIndex = shellIdText.indexOf("?")
        if (querySeparatorIndex < 0) {
          continue
        }
        const normalizedQuery = shellIdText.slice(querySeparatorIndex + 1).replace(/&amp;/g, "&")
        const shellParams = new URLSearchParams(normalizedQuery)
        const shellTerminalId = normalizeSessionToken(shellParams.get("terminal_id"))
        if (!shellTerminalId) {
          continue
        }
        const shellSessionId = normalizeSessionToken(shellParams.get("session"))
        if (shellSessionId) {
          runningShellIdByTerminalSession.set(`${shellTerminalId}|${shellSessionId}`, shellIdText)
        }
      }
    }

    const readCodexTranscriptPreview = async (filePath, maxBytes = 1048576, maxLines = 320) => {
      let handle = null
      try {
        handle = await fs.promises.open(filePath, "r")
        const stat = await handle.stat()
        if (!stat || !stat.isFile() || stat.size <= 0) {
          return null
        }

        const parseRecordsFromChunk = (chunk, options = {}) => {
          if (!chunk || chunk.length === 0) {
            return []
          }
          let text = chunk
          if (options.dropFirstPartialLine) {
            const firstNewline = text.indexOf("\n")
            if (firstNewline < 0) {
              return []
            }
            text = text.slice(firstNewline + 1)
          }
          if (options.dropLastPartialLine) {
            const lastNewline = text.lastIndexOf("\n")
            if (lastNewline < 0) {
              return []
            }
            text = text.slice(0, lastNewline)
          }
          if (!text || text.trim().length === 0) {
            return []
          }
          const lines = text.split(/\r?\n/)
          const records = []
          for (let i = 0; i < lines.length; i++) {
            const line = String(lines[i] || "").trim()
            if (!line) {
              continue
            }
            try {
              const parsed = JSON.parse(line)
              if (options.keepLatest) {
                if (records.length >= maxLines) {
                  records.shift()
                }
                records.push(parsed)
              } else if (records.length < maxLines) {
                records.push(parsed)
              } else {
                break
              }
            } catch (error) {
            }
          }
          return records
        }

        const inferSessionIdFromPath = () => {
          const filename = path.basename(filePath)
          const match = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
          if (match && typeof match[0] === "string") {
            return match[0]
          }
          return null
        }

        const readChunk = async (position, length) => {
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await handle.read(buffer, 0, length, position)
          if (!bytesRead || bytesRead <= 0) {
            return ""
          }
          return buffer.toString("utf8", 0, bytesRead)
        }

        const buildUserSummaryFromRecords = (records, reverse = false) => {
          if (!Array.isArray(records) || records.length === 0) {
            return null
          }
          const start = reverse ? records.length - 1 : 0
          const end = reverse ? -1 : records.length
          const step = reverse ? -1 : 1
          for (let i = start; i !== end; i += step) {
            const record = records[i]
            if (!record || typeof record !== "object") {
              continue
            }
            const payload = record.payload && typeof record.payload === "object" ? record.payload : record
            if (!payload || typeof payload !== "object") {
              continue
            }
            const payloadType = typeof payload.type === "string" ? payload.type.toLowerCase() : ""
            const payloadRole = typeof payload.role === "string" ? payload.role.toLowerCase() : ""
            const messageRole = payload.message && typeof payload.message === "object" && typeof payload.message.role === "string"
              ? payload.message.role.toLowerCase()
              : ""
            const isUserRecord = (record.type === "response_item" && payloadType === "message" && payloadRole === "user")
              || payloadType === "user"
              || messageRole === "user"
            if (!isUserRecord) {
              continue
            }
            const candidateSummary = normalizeDiscoveredSessionSummary(buildSessionSummary(payload) || buildSessionSummary(record))
            if (candidateSummary) {
              return candidateSummary
            }
          }
          return null
        }

        const headBytes = Math.min(stat.size, Math.max(262144, Math.floor(maxBytes / 2)))
        const tailBytes = Math.min(stat.size, maxBytes)
        const tailPosition = Math.max(0, stat.size - tailBytes)

        const headChunk = await readChunk(0, headBytes)
        const tailChunk = await readChunk(tailPosition, tailBytes)
        const headRecords = parseRecordsFromChunk(headChunk, { dropLastPartialLine: headBytes < stat.size })
        const tailRecords = parseRecordsFromChunk(tailChunk, { dropFirstPartialLine: tailPosition > 0, keepLatest: true })

        let firstRecord = null
        let metaRecord = null
        for (let i = 0; i < headRecords.length; i++) {
          const record = headRecords[i]
          if (!firstRecord) {
            firstRecord = record
          }
          if (!metaRecord && record && record.type === "session_meta" && record.payload && typeof record.payload === "object") {
            metaRecord = record
          }
          if (firstRecord && metaRecord) {
            break
          }
        }

        let userSummary = buildUserSummaryFromRecords(tailRecords, true)
        if (!userSummary) {
          userSummary = buildUserSummaryFromRecords(headRecords, false)
        }

        const baseRecord = metaRecord || firstRecord
        if (!baseRecord || typeof baseRecord !== "object") {
          const fallbackSessionId = inferSessionIdFromPath()
          if (!fallbackSessionId) {
            return null
          }
          return {
            session_id: fallbackSessionId,
            summary: userSummary || null,
            timestamp: new Date(stat.mtimeMs).toISOString()
          }
        }
        if (!userSummary) {
          return baseRecord
        }
        if (baseRecord.payload && typeof baseRecord.payload === "object") {
          return {
            ...baseRecord,
            payload: {
              ...baseRecord.payload,
              summary: userSummary
            }
          }
        }
        return {
          ...baseRecord,
          summary: userSummary
        }
      } catch (error) {
        return null
      } finally {
        if (handle) {
          try {
            await handle.close()
          } catch (error) {
          }
        }
      }
    }

    const collectFiles = async (target, allowedExts = [".jsonl", ".json"]) => {
      const result = []
      if (!target) {
        return result
      }

      let stats
      try {
        stats = await fs.promises.stat(target)
      } catch (e) {
        return result
      }

      if (stats.isFile()) {
        const ext = path.extname(target).toLowerCase()
        if (allowedExts.includes(ext)) {
          result.push(target)
        }
        return result
      }

      if (!stats.isDirectory()) {
        return result
      }

      const walk = async (dir) => {
        let entries
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch (e) {
          return
        }
        for (let entry of entries) {
          const resolved = path.resolve(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(resolved)
            continue
          }
          const ext = path.extname(entry.name).toLowerCase()
          if (allowedExts.includes(ext)) {
            result.push(resolved)
          }
        }
      }

      await walk(target)
      return result
    }

    const refreshDiscoveryEntries = async () => {
      const byProvider = new Map()
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i]
        for (let j = 0; j < provider.roots.length; j++) {
          const root = provider.roots[j]
          const files = await collectFiles(root)
          for (let k = 0; k < files.length; k++) {
            const file = files[k]
            const lower = file.toLowerCase()
            if (typeof provider.shouldIncludeFile === "function") {
              let includeFile = false
              try {
                includeFile = Boolean(provider.shouldIncludeFile(file))
              } catch (error) {
                includeFile = false
              }
              if (!includeFile) {
                continue
              }
            }
            if (provider.fileFilters.length > 0 && provider.fileFilters.every((x) => !lower.includes(x))) {
              continue
            }
            let records = null
            const resolvedFilePath = path.resolve(file)
            const isCodexSessionTranscript = provider.key === "codex"
              && codexTranscriptRoots.some((root) => resolvedFilePath.startsWith(`${root}${path.sep}`))
            if (isCodexSessionTranscript) {
              const previewRecord = await readCodexTranscriptPreview(file)
              if (previewRecord) {
                records = [previewRecord]
              } else {
                records = []
              }
            } else {
              let contents
              try {
                contents = await fs.promises.readFile(file, "utf8")
              } catch (e) {
                continue
              }
              records = parseSessionRecords(contents)
            }
            for (let m = 0; m < records.length; m++) {
              const record = records[m]
              const extracted = provider.extract(record, file)
              const extractedEntries = Array.isArray(extracted) ? extracted : [extracted]
              for (let n = 0; n < extractedEntries.length; n++) {
                const extractedEntry = extractedEntries[n]
                if (!extractedEntry || !extractedEntry.id) {
                  continue
                }
                const extractedTerminalId = typeof extractedEntry.terminal_id === "string"
                  ? extractedEntry.terminal_id.trim()
                  : ""
                const key = `${provider.key}:${extractedEntry.id}`
                const ts = parseSessionTimestamp(extractedEntry.timestamp)
                const existing = byProvider.get(key)
                const existingSourceKind = existing && typeof existing.source_kind === "string" ? existing.source_kind : ""
                const extractedSourceKind = typeof extractedEntry.source_kind === "string" ? extractedEntry.source_kind : ""
                const existingResumeCapable = existing && typeof existing.resume_capable === "boolean" ? existing.resume_capable : null
                const extractedResumeCapable = typeof extractedEntry.resume_capable === "boolean" ? extractedEntry.resume_capable : null
                const existingResumeDisabledReason = existing && typeof existing.resume_disabled_reason === "string"
                  ? existing.resume_disabled_reason
                  : ""
                const extractedResumeDisabledReason = typeof extractedEntry.resume_disabled_reason === "string"
                  ? extractedEntry.resume_disabled_reason
                  : ""
                const existingForkCapable = existing && typeof existing.fork_capable === "boolean" ? existing.fork_capable : null
                const extractedForkCapable = typeof extractedEntry.fork_capable === "boolean" ? extractedEntry.fork_capable : null
                const mergedForkCapable = provider.key === "gemini"
                  ? Boolean(existingForkCapable || extractedForkCapable)
                  : true
                let mergedResumeCapable = null
                if (existingResumeCapable === true || extractedResumeCapable === true) {
                  mergedResumeCapable = true
                } else if (existingResumeCapable === false || extractedResumeCapable === false) {
                  mergedResumeCapable = false
                }
                const mergedResumeDisabledReason = mergedResumeCapable === false
                  ? (extractedResumeDisabledReason || existingResumeDisabledReason || "")
                  : ""
                const merged = {
                  ...existing,
                  id: extractedEntry.id,
                  provider: provider.key,
                  providerLabel: provider.label,
                  command: provider.command,
                  resumeTemplate: provider.resumeTemplate || "%COMMAND% resume %SESSION_ID_JSON%",
                  forkTemplate: provider.forkTemplate || provider.resumeTemplate || "%COMMAND% resume %SESSION_ID_JSON%",
                  cwd: existing && existing.cwd ? existing.cwd : extractedEntry.cwd,
                  summary: extractedEntry.summary || (existing && existing.summary),
                  timestamp: existing ? Math.max(existing.timestamp || 0, ts) : ts,
                  source: existing ? existing.source : file,
                  source_kind: existingSourceKind || extractedSourceKind || null,
                  metadata: existing ? (existing.metadata || extractedEntry.metadata || null) : (extractedEntry.metadata || null),
                  terminal_id: extractedTerminalId || (existing && typeof existing.terminal_id === "string" ? existing.terminal_id : null),
                  fork_capable: mergedForkCapable
                }
                if (mergedResumeCapable !== null) {
                  merged.resume_capable = mergedResumeCapable
                }
                if (mergedResumeDisabledReason) {
                  merged.resume_disabled_reason = mergedResumeDisabledReason
                } else if (mergedResumeCapable === true && Object.prototype.hasOwnProperty.call(merged, "resume_disabled_reason")) {
                  delete merged.resume_disabled_reason
                }
                if (extractedSourceKind === "gemini_session") {
                  merged.source = file
                  merged.source_kind = extractedSourceKind
                }
                if (!merged.cwd && extractedEntry.cwd) {
                  merged.cwd = extractedEntry.cwd
                }
                if (!merged.summary && extractedEntry.summary) {
                  merged.summary = extractedEntry.summary
                }
                if (!existing || ts > existing.timestamp) {
                  merged.timestamp = ts
                  const preserveGeminiSessionSource = provider.key === "gemini"
                    && existingSourceKind === "gemini_session"
                    && extractedSourceKind === "gemini_log"
                  if (!preserveGeminiSessionSource) {
                    merged.source = file
                    if (extractedSourceKind) {
                      merged.source_kind = extractedSourceKind
                    }
                  }
                  if (extractedEntry.summary) {
                    merged.summary = extractedEntry.summary
                  }
                }
                byProvider.set(key, merged)
              }
            }
          }
        }
      }
      const entries = Array.from(byProvider.values())
        .filter((entry) => {
          if (!entry || entry.provider !== "gemini") {
            return true
          }
          return entry.source_kind !== "gemini_log"
        })
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      const refreshedAt = Date.now()
      terminalSessionDiscoveryCache.entries = entries
      terminalSessionDiscoveryCache.expires = refreshedAt + TERMINAL_SESSION_DISCOVERY_CACHE_TTL_MS
      terminalSessionDiscoveryCache.updated_at = refreshedAt
      return entries
    }

    const startDiscoveryRefresh = (force = false) => {
      const now = Date.now()
      const hasCachedEntries = Array.isArray(terminalSessionDiscoveryCache.entries)
      const cacheFresh = hasCachedEntries && terminalSessionDiscoveryCache.expires > now
      if (!force && cacheFresh) {
        return terminalSessionDiscoveryCache.refreshPromise || null
      }
      if (!terminalSessionDiscoveryCache.refreshPromise) {
        terminalSessionDiscoveryCache.refreshPromise = (async () => {
          try {
            return await refreshDiscoveryEntries()
          } finally {
            terminalSessionDiscoveryCache.refreshPromise = null
          }
        })()
      }
      return terminalSessionDiscoveryCache.refreshPromise
    }
    const now = Date.now()
    const hasCachedEntries = Array.isArray(terminalSessionDiscoveryCache.entries)
    const cacheExpired = !hasCachedEntries || terminalSessionDiscoveryCache.expires <= now
    let discoveredEntries = hasCachedEntries ? terminalSessionDiscoveryCache.entries : []
    if (forceDiscovery) {
      let refreshed = null
      try {
        refreshed = await startDiscoveryRefresh(true)
      } catch (error) {
        refreshed = null
      }
      if (Array.isArray(refreshed)) {
        discoveredEntries = refreshed
      } else {
        discoveredEntries = Array.isArray(terminalSessionDiscoveryCache.entries) ? terminalSessionDiscoveryCache.entries : []
      }
    } else if (!hasCachedEntries) {
      const pendingRefresh = startDiscoveryRefresh(false)
      if (pendingRefresh && typeof pendingRefresh.catch === "function") {
        pendingRefresh.catch(() => {})
      }
      if (!cacheOnly) {
        let refreshed = null
        try {
          refreshed = await startDiscoveryRefresh(true)
        } catch (error) {
          refreshed = null
        }
        if (Array.isArray(refreshed)) {
          discoveredEntries = refreshed
        } else {
          discoveredEntries = Array.isArray(terminalSessionDiscoveryCache.entries) ? terminalSessionDiscoveryCache.entries : []
        }
      }
    } else if (cacheExpired) {
      const pendingRefresh = startDiscoveryRefresh(false)
      if (pendingRefresh && typeof pendingRefresh.catch === "function") {
        pendingRefresh.catch(() => {})
      }
    }
    const discoveredEntriesWithWorkspace = Array.from(discoveredEntries || [])
      .filter((entry) => {
        const workingDirectory = entry && typeof entry.cwd === "string" ? entry.cwd.trim() : ""
        return workingDirectory.length > 0
      })
    const discoveredItems = Array.from(discoveredEntriesWithWorkspace || [])
      .sort((a, b) => {
        const ta = a.timestamp || 0
        const tb = b.timestamp || 0
        return tb - ta
      })
      .map((entry, index) => {
        const workingDirectory = typeof entry.cwd === "string" ? entry.cwd.trim() : ""
        const terminalId = typeof entry.terminal_id === "string" ? entry.terminal_id.trim() : ""
        const entryResumeCapable = typeof entry.resume_capable === "boolean" ? entry.resume_capable : null
        const resumeCapable = workingDirectory.length > 0 && entryResumeCapable !== false
        const codexResumeCommand = buildCodexResumeBaseCommand(entry)
        const resumeBaseCommand = codexResumeCommand.command
        const routeId = `terminals-${entry.provider}-${entry.id}`
        const route = `/shell/${routeId}`
        const buildTemplatedSessionCommand = (template, sessionId) => {
          const resolvedTemplate = typeof template === "string" && template.length > 0 ? template : "%COMMAND% resume %SESSION_ID_JSON%"
          const primaryCommand = resolvedTemplate
            .replace(/%COMMAND%/g, resumeBaseCommand)
            .replace(/%SESSION_ID_JSON%/g, JSON.stringify(sessionId))
            .replace(/%SESSION_ID%/g, sessionId)
          if (!codexResumeCommand.fallback) {
            return primaryCommand
          }
          const fallbackCommand = resolvedTemplate
            .replace(/%COMMAND%/g, codexResumeCommand.fallback)
            .replace(/%SESSION_ID_JSON%/g, JSON.stringify(sessionId))
            .replace(/%SESSION_ID%/g, sessionId)
          return `(${primaryCommand}) || (${fallbackCommand})`
        }
        const resumeTemplate = typeof entry.resumeTemplate === "string" && entry.resumeTemplate.length > 0
          ? entry.resumeTemplate
          : "%COMMAND% resume %SESSION_ID_JSON%"
        const resumeCommand = buildTemplatedSessionCommand(resumeTemplate, entry.id)
        let resumeDisabledReason = ""
        if (!resumeCapable) {
          const explicitResumeReason = typeof entry.resume_disabled_reason === "string"
            ? entry.resume_disabled_reason.trim()
            : ""
          if (explicitResumeReason) {
            resumeDisabledReason = explicitResumeReason
          } else if (workingDirectory.length === 0) {
            resumeDisabledReason = `${entry.providerLabel || "Session"} resume unavailable: missing working directory metadata.`
          } else {
            resumeDisabledReason = `${entry.providerLabel || "Session"} resume unavailable for this session.`
          }
        }
        const forkCapable = false
        const forkDisabledReason = "Fork disabled in workspace mode."
        const shortId = entry.id.slice(0, 12)
        const title = trimSummary(entry.summary, 96) || `${entry.providerLabel}: ${shortId}`
        const buildShellRoute = (command, sessionValue) => {
          const params = new URLSearchParams()
          params.set("path", workingDirectory)
          params.set("cwd", workingDirectory)
          params.set("session", sessionValue)
          if (terminalId) {
            params.set("terminal_id", terminalId)
          }
          params.set("message", command)
          params.set("input", "1")
          return `${route}?${params.toString()}`
        }
        let resumeUrl = resumeCapable ? buildShellRoute(resumeCommand, entry.id) : "#"
        const forkUrl = ""
        const normalizedTerminalId = normalizeSessionToken(terminalId) || terminalId
        if (resumeCapable && normalizedTerminalId) {
          const normalizedEntrySessionId = normalizeSessionToken(entry.id)
          const exactShellId = normalizedEntrySessionId
            ? runningShellIdByTerminalSession.get(`${normalizedTerminalId}|${normalizedEntrySessionId}`)
            : null
          if (exactShellId) {
            resumeUrl = exactShellId.startsWith("/") ? exactShellId : `/${exactShellId}`
          }
        }
        return {
          name: title,
          description: `${entry.providerLabel} · ${entry.cwd || "cwd unavailable"}`,
          provider: entry.provider || "",
          uri: `${entry.provider}:${entry.id}`,
          index,
          url: resumeUrl,
          browser_url: resumeUrl,
          resume_capable: resumeCapable,
          resume_disabled_reason: resumeDisabledReason || null,
          fork_url: forkUrl,
          fork_capable: forkCapable,
          fork_disabled_reason: forkDisabledReason || null,
          filepath: entry.cwd || "",
          provider_label: entry.providerLabel || entry.provider || "Session",
          cwd: entry.cwd || "",
          workspace_name: path.basename(entry.cwd || ""),
          workspace_path: entry.cwd || "",
          summary: entry.summary || null,
          timestamp: entry.timestamp || null,
          terminal_id: terminalId || null
        }
      })
    return discoveredItems
  }

    return {
      getTerminalStarterProviders,
      normalizeTerminalLaunchMode,
      buildTerminalStartCommand,
      getTerminalWorkspacesRoot,
      isValidTerminalWorkspaceName,
      listTerminalWorkspaceFolders,
      generateTerminalWorkspaceFolderName,
      ensureTerminalWorkspaceGitignoreEntries,
      readTerminalWorkspaceUpdatedAt,
      parseSessionTimestamp,
      listTerminalSkills,
      materializeTerminalSkillContext,
      ensureCodexSelectedSkillFrontmatter,
      forkGeminiSessionFile,
      buildTerminalSessions,
      getTerminalSessionDiscoverySnapshotVersion,
      coerceTerminalRegistryItems,
      readTerminalSessionRegistry,
      writeTerminalSessionRegistry,
      updateTerminalSessionRegistrySummary,
      upsertTerminalSessionRegistryEntry
    }
}

module.exports = {
  createTerminalSessionHelpers
}
