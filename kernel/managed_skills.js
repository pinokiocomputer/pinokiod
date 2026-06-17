const fs = require("fs")
const os = require("os")
const path = require("path")

const INDEX_FILENAME = "index.json"
const INDEX_VERSION = 1
const MARKER_FILENAME = ".pinokio-managed.json"
const MANAGER_ID = "pinokio"
const TEMP_DIRNAME = ".tmp"
const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "never"
}

const BUILTIN_SKILLS = {
  pinokio: {
    id: "pinokio",
    publishName: "pinokio",
    source: "builtin",
    removable: false
  },
  gepeto: {
    id: "gepeto",
    publishName: "gepeto",
    source: "builtin",
    removable: false
  }
}

const normalizeText = (value) => String(value || "").replace(/\r\n/g, "\n")

const skillsRoot = (kernel) => {
  if (!kernel || !kernel.homedir || typeof kernel.path !== "function") {
    throw new Error("Pinokio home is not configured.")
  }
  return path.resolve(kernel.path("skills"))
}

const indexPath = (kernel) => path.resolve(skillsRoot(kernel), INDEX_FILENAME)

const publishRoots = (home = os.homedir()) => [
  path.resolve(home, ".agents", "skills"),
  path.resolve(home, ".claude", "skills"),
  path.resolve(home, ".hermes", "skills")
]

const writeFileIfChanged = async (targetPath, content) => {
  let shouldWrite = true
  try {
    const existing = await fs.promises.readFile(targetPath, "utf8")
    shouldWrite = existing !== content
  } catch (error) {
    if (!(error && error.code === "ENOENT")) {
      throw error
    }
  }
  if (shouldWrite) {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.writeFile(targetPath, content, "utf8")
  }
  return shouldWrite
}

const writeJsonFileAtomic = async (targetPath, value) => {
  const content = JSON.stringify(value, null, 2) + "\n"
  const tempPath = path.resolve(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  )
  await fs.promises.writeFile(tempPath, content, "utf8")
  try {
    await fs.promises.rename(tempPath, targetPath)
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

const normalizeSkillId = (value) => {
  const raw = String(value || "")
    .trim()
    .replace(/\.git$/i, "")
    .toLowerCase()
  const normalized = raw
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/-{2,}/g, "-")
  if (!normalized || normalized === "." || normalized === "..") {
    return ""
  }
  return normalized
}

const normalizePublishName = normalizeSkillId

const deriveSkillIdFromRef = (ref) => {
  const raw = String(ref || "").trim().replace(/[\\/]+$/, "")
  if (!raw) {
    return ""
  }
  let lastSegment = ""
  try {
    const parsed = new URL(raw)
    lastSegment = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || ""
  } catch (_) {
  }
  if (!lastSegment) {
    lastSegment = raw.split(/[/:]/).filter(Boolean).pop() || ""
  }
  return normalizeSkillId(lastSegment)
}

const defaultPublishName = (id) => {
  const normalized = normalizeSkillId(id)
  if (normalized === "pinokio" || normalized === "gepeto") {
    return normalized
  }
  return normalized ? `pinokio-${normalized}` : ""
}

const parseSimpleFrontmatter = (content) => {
  const normalized = normalizeText(content)
  if (!normalized.startsWith("---\n")) {
    return {
      frontmatter: {},
      bodyWithoutFrontmatter: normalized.trim()
    }
  }
  const end = normalized.indexOf("\n---\n", 4)
  if (end === -1) {
    return {
      frontmatter: {},
      bodyWithoutFrontmatter: normalized.trim()
    }
  }
  const rawFrontmatter = normalized.slice(4, end)
  const data = {}
  let currentArrayKey = null
  for (const line of rawFrontmatter.split("\n")) {
    const arrayMatch = /^-\s*(.*)$/.exec(line.trim())
    if (arrayMatch && currentArrayKey) {
      data[currentArrayKey].push(arrayMatch[1].replace(/^["']|["']$/g, ""))
      continue
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) {
      currentArrayKey = null
      continue
    }
    const key = match[1].trim()
    let value = match[2].trim()
    if (!value) {
      data[key] = []
      currentArrayKey = key
      continue
    }
    currentArrayKey = null
    value = value.replace(/^["']|["']$/g, "")
    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    } else {
      data[key] = value
    }
  }
  return {
    frontmatter: data,
    bodyWithoutFrontmatter: normalized.slice(end + 5).trim()
  }
}

const normalizeIndex = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const rawSkills = source.skills && typeof source.skills === "object" ? source.skills : {}
  const skills = {}
  for (const key of Object.keys(rawSkills)) {
    const entry = rawSkills[key]
    if (!entry || typeof entry !== "object") {
      continue
    }
    const id = normalizeSkillId(entry.id || key)
    if (!id) {
      continue
    }
    const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_SKILLS, id)
    const publishName = normalizePublishName(entry.publishName) || defaultPublishName(id)
    skills[id] = {
      id,
      source: builtin ? "builtin" : (typeof entry.source === "string" && entry.source.trim() ? entry.source.trim() : "local"),
      ref: typeof entry.ref === "string" ? entry.ref : "",
      enabled: entry.enabled === true,
      publishName,
      builtin,
      removable: builtin ? false : entry.removable !== false,
      installedAt: typeof entry.installedAt === "string" ? entry.installedAt : "",
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : ""
    }
  }
  return {
    version: INDEX_VERSION,
    skills
  }
}

const readIndex = async (kernel) => {
  await fs.promises.mkdir(skillsRoot(kernel), { recursive: true })
  try {
    const raw = await fs.promises.readFile(indexPath(kernel), "utf8")
    return normalizeIndex(JSON.parse(raw))
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return normalizeIndex({})
    }
    const nextError = new Error(`Failed to read managed skills index: ${error && error.message ? error.message : "unknown error"}`)
    nextError.status = 500
    nextError.cause = error
    throw nextError
  }
}

const writeIndex = async (kernel, index) => {
  const normalized = normalizeIndex(index)
  await fs.promises.mkdir(skillsRoot(kernel), { recursive: true })
  await writeJsonFileAtomic(indexPath(kernel), normalized)
  return normalized
}

const skillDir = (kernel, id) => path.resolve(skillsRoot(kernel), normalizeSkillId(id))
const skillPath = (kernel, id) => path.resolve(skillDir(kernel, id), "SKILL.md")

const readSkillContent = async (sourcePath) => {
  try {
    return await fs.promises.readFile(sourcePath, "utf8")
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return ""
    }
    throw error
  }
}

const validateSkillDir = async (dir, fallbackId = "") => {
  const sourcePath = path.resolve(dir, "SKILL.md")
  let content = ""
  const errors = []
  try {
    content = await fs.promises.readFile(sourcePath, "utf8")
  } catch (error) {
    errors.push("Missing SKILL.md at the skill root.")
  }
  const parsed = parseSimpleFrontmatter(content)
  const meta = parsed.frontmatter || {}
  const label = String(meta.title || meta.name || meta.skill || meta.id || fallbackId || path.basename(dir)).trim()
  const description = String(meta.description || meta.summary || "").trim()
  if (content && !content.trim()) {
    errors.push("SKILL.md is empty.")
  }
  if (content && !String(meta.title || meta.name || meta.skill || meta.id || "").trim()) {
    errors.push("SKILL.md frontmatter must include name or title.")
  }
  return {
    valid: errors.length === 0,
    errors,
    label,
    description,
    content,
    path: sourcePath
  }
}

const ensureBuiltinIndexEntries = (index) => {
  const now = new Date().toISOString()
  let changed = false
  for (const builtin of Object.values(BUILTIN_SKILLS)) {
    if (!index.skills[builtin.id]) {
      index.skills[builtin.id] = {
        id: builtin.id,
        source: "builtin",
        ref: "",
        enabled: true,
        publishName: builtin.publishName,
        builtin: true,
        removable: false,
        installedAt: now,
        updatedAt: now
      }
      changed = true
      continue
    }
    const entry = index.skills[builtin.id]
    const before = JSON.stringify(entry)
    entry.source = "builtin"
    entry.builtin = true
    entry.removable = false
    entry.publishName = builtin.publishName
    if (JSON.stringify(entry) !== before) {
      changed = true
    }
  }
  return changed
}

const composeBuiltinSkillContent = async (kernel, id) => {
  if (id === "pinokio") {
    return readSkillContent(path.resolve(__dirname, "../prototype/system/SKILL_PINOKIO.md"))
  }
  if (id === "gepeto") {
    const agentsContent = await readSkillContent(path.resolve(kernel.homedir, "AGENTS.md"))
    if (!agentsContent.trim()) {
      return ""
    }
    return [
      "---",
      "name: gepeto",
      "description: Guide for building 1-click launchers and building apps with launchers built-in using Pinokio",
      "---",
      "",
      agentsContent.trim(),
      ""
    ].join("\n")
  }
  return ""
}

const syncBuiltinSourceFiles = async (kernel, index) => {
  let changed = false
  for (const builtin of Object.values(BUILTIN_SKILLS)) {
    const content = await composeBuiltinSkillContent(kernel, builtin.id)
    if (!content.trim()) {
      continue
    }
    const target = skillPath(kernel, builtin.id)
    const wrote = await writeFileIfChanged(target, normalizeText(content).trim() + "\n")
    if (wrote && index.skills[builtin.id]) {
      index.skills[builtin.id].updatedAt = new Date().toISOString()
      changed = true
    }
  }
  return changed
}

const scanSkillFolders = async (kernel) => {
  let entries = []
  try {
    entries = await fs.promises.readdir(skillsRoot(kernel), { withFileTypes: true })
  } catch (_) {
    return []
  }
  return entries
    .filter((entry) => entry && entry.isDirectory())
    .filter((entry) => !String(entry.name || "").startsWith("."))
    .map((entry) => normalizeSkillId(entry.name))
    .filter(Boolean)
}

const reconcileIndexWithFolders = async (kernel, index) => {
  const now = new Date().toISOString()
  let changed = false
  const ids = await scanSkillFolders(kernel)
  for (const id of ids) {
    if (index.skills[id]) {
      continue
    }
    index.skills[id] = {
      id,
      source: "local",
      ref: "",
      enabled: false,
      publishName: defaultPublishName(id),
      builtin: false,
      removable: true,
      installedAt: now,
      updatedAt: now
    }
    changed = true
  }
  return changed
}

const ensureManagedSkillState = async (kernel) => {
  let index = await readIndex(kernel)
  let changed = ensureBuiltinIndexEntries(index)
  if (await syncBuiltinSourceFiles(kernel, index)) {
    changed = true
  }
  if (await reconcileIndexWithFolders(kernel, index)) {
    changed = true
  }
  if (changed) {
    index = await writeIndex(kernel, index)
  }
  return index
}

const readManagedMarker = async (dir) => {
  try {
    const raw = await fs.promises.readFile(path.resolve(dir, MARKER_FILENAME), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch (_) {
    return null
  }
}

const isMarkerForSkill = (marker, skillId) => {
  return marker
    && marker.manager === MANAGER_ID
    && normalizeSkillId(marker.skillId) === normalizeSkillId(skillId)
}

const writeManagedMarker = async (dir, entry, sourcePath) => {
  const marker = {
    manager: MANAGER_ID,
    skillId: entry.id,
    publishName: entry.publishName,
    source: sourcePath,
    ref: entry.ref || ""
  }
  await writeFileIfChanged(path.resolve(dir, MARKER_FILENAME), JSON.stringify(marker, null, 2) + "\n")
}

const targetDirFor = (root, publishName) => path.resolve(root, publishName)

const hasOnlyManagedPublishedFiles = async (dir) => {
  let entries = []
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (_) {
    return false
  }
  if (!entries.length) {
    return false
  }
  const allowed = new Set(["skill.md", MARKER_FILENAME.toLowerCase()])
  return entries.every((entry) => entry && entry.isFile() && allowed.has(String(entry.name || "").toLowerCase()))
}

const removePublishedCopy = async (targetDir, entry, desiredContent = "") => {
  let stat = null
  try {
    stat = await fs.promises.stat(targetDir)
  } catch (_) {
    return { removed: false, skipped: true, reason: "missing" }
  }
  if (!stat.isDirectory()) {
    return { removed: false, skipped: true, reason: "not-directory" }
  }
  const marker = await readManagedMarker(targetDir)
  if (isMarkerForSkill(marker, entry.id)) {
    await fs.promises.rm(targetDir, { recursive: true, force: true })
    return { removed: true }
  }
  if (desiredContent) {
    const existingContent = await readSkillContent(path.resolve(targetDir, "SKILL.md"))
    if (
      normalizeText(existingContent).trim() === normalizeText(desiredContent).trim()
      && await hasOnlyManagedPublishedFiles(targetDir)
    ) {
      await fs.promises.rm(targetDir, { recursive: true, force: true })
      return { removed: true, adoptedLegacy: true }
    }
  }
  return { removed: false, skipped: true, reason: "user-owned" }
}

const cleanupOrphanedPublishedCopies = async (index, roots = publishRoots()) => {
  const activeByName = new Map()
  for (const entry of Object.values(index.skills)) {
    if (entry && entry.enabled && entry.publishName) {
      activeByName.set(entry.publishName, entry.id)
    }
  }
  for (const root of roots) {
    let entries = []
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const dirent of entries) {
      if (!dirent || !dirent.isDirectory()) {
        continue
      }
      const childDir = path.resolve(root, dirent.name)
      const marker = await readManagedMarker(childDir)
      if (!marker || marker.manager !== MANAGER_ID) {
        continue
      }
      const expectedSkillId = activeByName.get(dirent.name)
      if (!expectedSkillId || normalizeSkillId(expectedSkillId) !== normalizeSkillId(marker.skillId)) {
        await fs.promises.rm(childDir, { recursive: true, force: true })
      }
    }
  }
}

const publishSkillToRoot = async (root, entry, validation) => {
  const targetDir = targetDirFor(root, entry.publishName)
  const desiredContent = normalizeText(validation.content).trim() + "\n"
  let exists = false
  let isDirectory = false
  try {
    const stat = await fs.promises.stat(targetDir)
    exists = true
    isDirectory = stat.isDirectory()
  } catch (_) {
  }
  if (exists && !isDirectory) {
    return {
      root,
      path: targetDir,
      status: "conflict",
      message: "A file already exists at the publish path."
    }
  }
  if (exists) {
    const marker = await readManagedMarker(targetDir)
    const existingContent = await readSkillContent(path.resolve(targetDir, "SKILL.md"))
    const sameContent = normalizeText(existingContent).trim() === normalizeText(desiredContent).trim()
    const canManage = isMarkerForSkill(marker, entry.id)
      || (sameContent && await hasOnlyManagedPublishedFiles(targetDir))
    if (!canManage) {
      return {
        root,
        path: targetDir,
        status: "conflict",
        message: "A non-Pinokio skill already exists here."
      }
    }
  }
  await fs.promises.mkdir(targetDir, { recursive: true })
  await writeFileIfChanged(path.resolve(targetDir, "SKILL.md"), desiredContent)
  await writeManagedMarker(targetDir, entry, validation.path)
  return {
    root,
    path: targetDir,
    status: "published",
    message: ""
  }
}

const syncManagedSkills = async (kernel, options = {}) => {
  const roots = Array.isArray(options.publishRoots) ? options.publishRoots : publishRoots()
  const index = await ensureManagedSkillState(kernel)
  await cleanupOrphanedPublishedCopies(index, roots)
  const results = []
  for (const entry of Object.values(index.skills)) {
    const validation = await validateSkillDir(skillDir(kernel, entry.id), entry.id)
    const skillResult = {
      id: entry.id,
      publishName: entry.publishName,
      enabled: entry.enabled === true,
      valid: validation.valid,
      targets: []
    }
    if (entry.enabled && validation.valid) {
      for (const root of roots) {
        skillResult.targets.push(await publishSkillToRoot(root, entry, validation))
      }
    } else {
      for (const root of roots) {
        const targetDir = targetDirFor(root, entry.publishName)
        const removal = await removePublishedCopy(targetDir, entry, validation.content)
        skillResult.targets.push({
          root,
          path: targetDir,
          status: removal.removed ? "removed" : (removal.reason === "missing" ? "disabled" : "conflict"),
          message: removal.reason || ""
        })
      }
    }
    results.push(skillResult)
  }
  return {
    index,
    results
  }
}

const publishStatusForSkill = async (entry, validation, roots = publishRoots()) => {
  const targets = []
  for (const root of roots) {
    const target = targetDirFor(root, entry.publishName)
    let exists = false
    let isDirectory = false
    try {
      const stat = await fs.promises.stat(target)
      exists = true
      isDirectory = stat.isDirectory()
    } catch (_) {
    }
    if (!exists) {
      targets.push({
        root,
        path: target,
        status: entry.enabled ? "missing" : "disabled",
        message: ""
      })
      continue
    }
    if (!isDirectory) {
      targets.push({
        root,
        path: target,
        status: "conflict",
        message: "A file exists at this path."
      })
      continue
    }
    const marker = await readManagedMarker(target)
    const existingContent = await readSkillContent(path.resolve(target, "SKILL.md"))
    const sameContent = validation.content
      && normalizeText(existingContent).trim() === normalizeText(validation.content).trim()
    const legacyManageable = sameContent && await hasOnlyManagedPublishedFiles(target)
    if (isMarkerForSkill(marker, entry.id)) {
      targets.push({
        root,
        path: target,
        status: entry.enabled ? "published" : "stale-managed",
        message: ""
      })
    } else if (legacyManageable) {
      targets.push({
        root,
        path: target,
        status: "legacy-managed",
        message: ""
      })
    } else {
      targets.push({
        root,
        path: target,
        status: "conflict",
        message: "A non-Pinokio skill already exists here."
      })
    }
  }
  return targets
}

const listManagedSkills = async (kernel, options = {}) => {
  const shouldSync = options.sync !== false
  if (shouldSync) {
    await syncManagedSkills(kernel, options)
  } else {
    await ensureManagedSkillState(kernel)
  }
  const index = await readIndex(kernel)
  const roots = Array.isArray(options.publishRoots) ? options.publishRoots : publishRoots()
  const items = []
  for (const entry of Object.values(index.skills)) {
    const validation = await validateSkillDir(skillDir(kernel, entry.id), entry.id)
    const targets = await publishStatusForSkill(entry, validation, roots)
    items.push({
      ...entry,
      path: skillPath(kernel, entry.id),
      dir: skillDir(kernel, entry.id),
      valid: validation.valid,
      errors: validation.errors,
      label: validation.label,
      description: validation.description,
      targets,
      hasConflict: targets.some((target) => target.status === "conflict")
    })
  }
  items.sort((a, b) => {
    const ab = a.builtin ? 0 : 1
    const bb = b.builtin ? 0 : 1
    if (ab !== bb) return ab - bb
    return String(a.label || a.id).localeCompare(String(b.label || b.id))
  })
  return items
}

const getManagedSkill = async (kernel, id, options = {}) => {
  const normalizedId = normalizeSkillId(id)
  const items = await listManagedSkills(kernel, options)
  return items.find((item) => item.id === normalizedId) || null
}

const assertUniquePublishName = (index, id, publishName) => {
  for (const entry of Object.values(index.skills)) {
    if (!entry || entry.id === id) {
      continue
    }
    if (entry.publishName === publishName) {
      const error = new Error(`Publish name is already used by ${entry.id}.`)
      error.status = 409
      throw error
    }
  }
}

const setSkillEnabled = async (kernel, id, enabled, options = {}) => {
  const normalizedId = normalizeSkillId(id)
  let index = await ensureManagedSkillState(kernel)
  const entry = index.skills[normalizedId]
  if (!entry) {
    const error = new Error("Skill not found.")
    error.status = 404
    throw error
  }
  if (enabled) {
    const validation = await validateSkillDir(skillDir(kernel, normalizedId), normalizedId)
    if (!validation.valid) {
      const error = new Error(validation.errors[0] || "Skill is invalid.")
      error.status = 400
      throw error
    }
  }
  entry.enabled = enabled === true
  entry.updatedAt = new Date().toISOString()
  index = await writeIndex(kernel, index)
  await syncManagedSkills(kernel, options)
  return getManagedSkill(kernel, normalizedId, { ...options, sync: false })
}

const setSkillPublishName = async (kernel, id, publishName, options = {}) => {
  const normalizedId = normalizeSkillId(id)
  const normalizedPublishName = normalizePublishName(publishName)
  if (!normalizedPublishName) {
    const error = new Error("Publish name is invalid.")
    error.status = 400
    throw error
  }
  let index = await ensureManagedSkillState(kernel)
  const entry = index.skills[normalizedId]
  if (!entry) {
    const error = new Error("Skill not found.")
    error.status = 404
    throw error
  }
  if (entry.builtin) {
    const error = new Error("Built-in skill publish names cannot be changed.")
    error.status = 400
    throw error
  }
  assertUniquePublishName(index, normalizedId, normalizedPublishName)
  entry.publishName = normalizedPublishName
  entry.updatedAt = new Date().toISOString()
  index = await writeIndex(kernel, index)
  await syncManagedSkills(kernel, options)
  return getManagedSkill(kernel, normalizedId, { ...options, sync: false })
}

const removeSkill = async (kernel, id, options = {}) => {
  const normalizedId = normalizeSkillId(id)
  let index = await ensureManagedSkillState(kernel)
  const entry = index.skills[normalizedId]
  if (!entry) {
    const error = new Error("Skill not found.")
    error.status = 404
    throw error
  }
  if (entry.builtin) {
    const error = new Error("Built-in skills can be disabled, not removed.")
    error.status = 400
    throw error
  }
  entry.enabled = false
  index = await writeIndex(kernel, index)
  await syncManagedSkills(kernel, options)
  await fs.promises.rm(skillDir(kernel, normalizedId), { recursive: true, force: true })
  delete index.skills[normalizedId]
  await writeIndex(kernel, index)
  await syncManagedSkills(kernel, options)
  return { id: normalizedId }
}

const tempSkillCloneDir = async (kernel, id) => {
  const tempRoot = path.resolve(skillsRoot(kernel), TEMP_DIRNAME)
  await fs.promises.mkdir(tempRoot, { recursive: true })
  return path.resolve(tempRoot, `${normalizeSkillId(id)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

const installSkillFromGit = async (kernel, options = {}) => {
  const ref = typeof options.ref === "string" ? options.ref.trim() : ""
  if (!ref) {
    const error = new Error("Git URL is required.")
    error.status = 400
    throw error
  }
  const id = deriveSkillIdFromRef(ref)
  if (!id) {
    const error = new Error("Skill folder name is invalid.")
    error.status = 400
    throw error
  }
  let index = await ensureManagedSkillState(kernel)
  if (index.skills[id]) {
    const error = new Error("Skill already exists.")
    error.status = 409
    throw error
  }
  const publishName = defaultPublishName(id)
  assertUniquePublishName(index, id, publishName)
  const targetDir = skillDir(kernel, id)
  try {
    await fs.promises.access(targetDir, fs.constants.F_OK)
    const error = new Error("Skill folder already exists.")
    error.status = 409
    throw error
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error
    }
  }
  await fs.promises.mkdir(skillsRoot(kernel), { recursive: true })
  const tempDir = await tempSkillCloneDir(kernel, id)
  try {
    await kernel.exec({
      message: [{ _: ["git", "clone", "--depth", "1", "--single-branch", ref, tempDir] }],
      path: skillsRoot(kernel),
      env: { ...NON_INTERACTIVE_GIT_ENV }
    }, () => {})
    await fs.promises.rename(tempDir, targetDir)
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    const nextError = new Error(error && error.message ? error.message : "Failed to clone skill repository.")
    nextError.status = error && error.status ? error.status : 500
    throw nextError
  }
  const validation = await validateSkillDir(targetDir, id)
  const now = new Date().toISOString()
  index.skills[id] = {
    id,
    source: "git",
    ref,
    enabled: validation.valid,
    publishName,
    builtin: false,
    removable: true,
    installedAt: now,
    updatedAt: now
  }
  index = await writeIndex(kernel, index)
  await syncManagedSkills(kernel, options)
  return getManagedSkill(kernel, id, { ...options, sync: false })
}

const readEnabledManagedSkillBody = async (kernel, id) => {
  const skill = await getManagedSkill(kernel, id, { sync: false })
  if (!skill || !skill.enabled || !skill.valid) {
    return ""
  }
  const content = await readSkillContent(skill.path)
  return parseSimpleFrontmatter(content).bodyWithoutFrontmatter
}

module.exports = {
  INDEX_FILENAME,
  MARKER_FILENAME,
  defaultPublishName,
  deriveSkillIdFromRef,
  getManagedSkill,
  indexPath,
  installSkillFromGit,
  listManagedSkills,
  normalizePublishName,
  normalizeSkillId,
  publishRoots,
  readEnabledManagedSkillBody,
  removeSkill,
  setSkillEnabled,
  setSkillPublishName,
  skillPath,
  skillsRoot,
  syncManagedSkills,
  validateSkillDir
}
