const fs = require('fs')
const path = require('path')
const { isBinaryFile } = require('isbinaryfile')

const LOG_REDACTION_FILE_MAX_BYTES = 2 * 1024 * 1024
const LOG_REDACTION_OVERRIDE_MAX_BYTES = 8 * 1024 * 1024
const LOG_REDACTION_TEXT_EXTENSIONS = new Set(['.json', '.log', '.txt'])
const LOG_REDACTION_TAIL_LINE_COUNTS = new Set([500, 1000, 2000])
const CADDY_LOG_PATTERN = /^caddy(?:-.+)?\.log$/i

function isTopLevelRedactableLogPath(relativePath = '') {
  const value = typeof relativePath === 'string' ? relativePath.trim() : ''
  if (!value || value.includes('/') || value.includes('\\')) {
    return false
  }
  if (value !== path.basename(value) || value.startsWith('.')) {
    return false
  }
  if (CADDY_LOG_PATTERN.test(value)) {
    return false
  }
  return LOG_REDACTION_TEXT_EXTENSIONS.has(path.extname(value).toLowerCase())
}

function normalizeTailLineCount(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return LOG_REDACTION_TAIL_LINE_COUNTS.has(parsed) ? parsed : 0
}

async function readTailTextFile(filePath, stats, tailLines) {
  const readBytes = Math.min(stats.size, LOG_REDACTION_FILE_MAX_BYTES - 2048)
  const start = Math.max(0, stats.size - readBytes)
  const buffer = Buffer.alloc(readBytes)
  const handle = await fs.promises.open(filePath, 'r')
  let bytesRead = 0
  try {
    const result = await handle.read(buffer, 0, readBytes, start)
    bytesRead = result.bytesRead
  } finally {
    await handle.close()
  }
  let text = buffer.slice(0, bytesRead).toString('utf8')
  if (start > 0) {
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) {
      text = text.slice(firstNewline + 1)
    }
  }
  const lines = text.split(/\r?\n/)
  const selected = lines.length > tailLines ? lines.slice(-tailLines) : lines
  const omittedLines = Math.max(0, lines.length - selected.length)
  const prefix = start > 0 || omittedLines > 0
    ? `[Older log content omitted by user. Showing the last ${tailLines.toLocaleString()} lines.]\n`
    : ''
  return {
    text: `${prefix}${selected.join('\n')}`,
    truncated: start > 0 || omittedLines > 0,
    included_lines: selected.length
  }
}

function clonePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {}
}

function createRuntimeEnvSnapshot(kernel) {
  const baseEnv = {
    ...clonePlainObject(process.env),
    ...clonePlainObject(kernel && kernel.envs)
  }
  if (kernel && kernel.bin && typeof kernel.bin.envs === 'function') {
    try {
      return clonePlainObject(kernel.bin.envs(baseEnv))
    } catch (_) {}
  }
  return baseEnv
}

function createFallbackStateSnapshot(kernel) {
  const env = createRuntimeEnvSnapshot(kernel)
  if (Object.keys(env).length === 0) {
    return null
  }
  return {
    state: 'snapshot',
    id: 'runtime-environment',
    group: 'system',
    env,
    path: kernel && kernel.homedir,
    cmd: 'pinokio environment snapshot',
    done: true,
    ready: true
  }
}

function createCurrentLogSnapshot(kernel, version) {
  const liveShells = kernel && kernel.shell && Array.isArray(kernel.shell.shells)
    ? kernel.shell.shells
    : []
  const states = liveShells.map((s) => {
    return {
      state: s.state,
      id: s.id,
      group: s.group,
      env: s.env,
      path: s.path,
      cmd: s.cmd,
      done: s.done,
      ready: s.ready,
    }
  })
  if (states.length === 0) {
    const fallbackState = createFallbackStateSnapshot(kernel)
    if (fallbackState) {
      states.push(fallbackState)
    }
  }

  const info = {
    platform: kernel.platform,
    arch: kernel.arch,
    running: kernel.api.running,
    home: kernel.homedir,
    vars: kernel.vars,
    memory: kernel.memory,
    procs: kernel.procs,
    gpu: kernel.gpu,
    gpus: kernel.gpus,
    version,
    ...kernel.sysinfo
  }

  return { info, states }
}

async function writeCurrentLogSnapshot(kernel, version) {
  const snapshot = createCurrentLogSnapshot(kernel, version)
  await fs.promises.mkdir(kernel.path('logs'), { recursive: true })
  await fs.promises.writeFile(kernel.path('logs/system.json'), JSON.stringify(snapshot.info, null, 2))
  await fs.promises.writeFile(kernel.path('logs/state.json'), JSON.stringify(snapshot.states, null, 2))
  return snapshot
}

function normalizeLogRedactionOverrides(body = {}) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'redacted_overrides')) {
    return []
  }
  const source = body.redacted_overrides
  if (!Array.isArray(source)) {
    throw new Error('redacted_overrides must be an array')
  }
  const overrides = []
  const seen = new Set()
  let totalBytes = 0
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid redaction override')
    }
    const relativePath = typeof candidate.path === 'string' ? candidate.path.trim() : ''
    if (!isTopLevelRedactableLogPath(relativePath)) {
      throw new Error(`Invalid redaction override path: ${relativePath || '(empty)'}`)
    }
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate redaction override path: ${relativePath}`)
    }
    seen.add(relativePath)
    if (typeof candidate.text !== 'string') {
      throw new Error(`Invalid redaction override text: ${relativePath}`)
    }
    const text = candidate.text
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > LOG_REDACTION_FILE_MAX_BYTES) {
      throw new Error(`Redaction override is too large: ${relativePath}`)
    }
    totalBytes += bytes
    if (totalBytes > LOG_REDACTION_OVERRIDE_MAX_BYTES) {
      throw new Error('Redaction overrides are too large')
    }
    overrides.push({
      path: relativePath,
      text,
      bytes
    })
  }
  return overrides
}

function normalizeLogRedactionExclusions(body = {}) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'excluded_paths')) {
    return []
  }
  const source = body.excluded_paths
  if (!Array.isArray(source)) {
    throw new Error('excluded_paths must be an array')
  }
  const exclusions = []
  const seen = new Set()
  for (const candidate of source) {
    const relativePath = typeof candidate === 'string' ? candidate.trim() : ''
    if (!isTopLevelRedactableLogPath(relativePath)) {
      throw new Error(`Invalid excluded path: ${relativePath || '(empty)'}`)
    }
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate excluded path: ${relativePath}`)
    }
    seen.add(relativePath)
    exclusions.push(relativePath)
  }
  return exclusions
}

async function assertCompleteLogRedactionOverrides(exportRoot, overrides = [], exclusions = [], options = {}) {
  const overridePaths = new Set((Array.isArray(overrides) ? overrides : []).map((override) => override && override.path).filter(Boolean))
  const excludedPaths = new Set(Array.isArray(exclusions) ? exclusions.filter(Boolean) : [])
  for (const excludedPath of excludedPaths) {
    if (overridePaths.has(excludedPath)) {
      throw new Error(`File cannot be both redacted and excluded: ${excludedPath}`)
    }
  }
  if (options && options.requireComplete === false) {
    return
  }
  const missing = []
  const entries = await fs.promises.readdir(exportRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && isTopLevelRedactableLogPath(entry.name) && !overridePaths.has(entry.name) && !excludedPaths.has(entry.name)) {
      missing.push(entry.name)
    }
  }
  if (missing.length > 0) {
    missing.sort((a, b) => a.localeCompare(b))
    throw new Error(`Missing redaction override for top-level file${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`)
  }
}

async function applyLogRedactionExclusions(exportRoot, exclusions = []) {
  if (!Array.isArray(exclusions) || exclusions.length === 0) {
    return 0
  }
  let removed = 0
  for (const relativePath of exclusions) {
    if (!isTopLevelRedactableLogPath(relativePath)) {
      throw new Error(`Invalid excluded path: ${relativePath || '(empty)'}`)
    }
    const target = path.resolve(exportRoot, relativePath)
    const relative = path.relative(exportRoot, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
      throw new Error(`Invalid excluded path: ${relativePath}`)
    }
    let stats
    try {
      stats = await fs.promises.stat(target)
    } catch (_) {
      throw new Error(`Excluded path target not found: ${relativePath}`)
    }
    if (!stats.isFile()) {
      throw new Error(`Excluded path target is not a file: ${relativePath}`)
    }
    await fs.promises.rm(target, { force: true })
    removed += 1
  }
  return removed
}

async function applyLogRedactionOverrides(exportRoot, overrides = []) {
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return 0
  }
  let applied = 0
  for (const override of overrides) {
    if (!override || !isTopLevelRedactableLogPath(override.path)) {
      throw new Error('Invalid redaction override')
    }
    const target = path.resolve(exportRoot, override.path)
    const relative = path.relative(exportRoot, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
      throw new Error(`Invalid redaction override path: ${override.path}`)
    }
    let stats
    try {
      stats = await fs.promises.stat(target)
    } catch (_) {
      throw new Error(`Redaction override target not found: ${override.path}`)
    }
    if (!stats.isFile()) {
      throw new Error(`Redaction override target is not a file: ${override.path}`)
    }
    await fs.promises.writeFile(target, override.text, 'utf8')
    applied += 1
  }
  return applied
}

function createLogRedactionBodyParser(express) {
  const jsonParser = express.json({ limit: '10mb' })
  const urlencodedParser = express.urlencoded({ extended: true })
  return (req, res, next) => {
    jsonParser(req, res, (error) => {
      if (error) {
        next(error)
        return
      }
      urlencodedParser(req, res, next)
    })
  }
}

function createLogRedactionBodyParsers(express) {
  const logRedactionBodyParser = createLogRedactionBodyParser(express)
  const defaultJsonParser = express.json()
  const defaultUrlencodedParser = express.urlencoded({ extended: true })
  const isLogArchiveRequest = (req) => req.method === 'POST' && req.path === '/pinokio/log'
  return [
    (req, res, next) => {
      if (isLogArchiveRequest(req)) {
        logRedactionBodyParser(req, res, next)
        return
      }
      next()
    },
    (req, res, next) => {
      if (isLogArchiveRequest(req)) {
        next()
        return
      }
      defaultJsonParser(req, res, next)
    },
    (req, res, next) => {
      if (isLogArchiveRequest(req)) {
        next()
        return
      }
      defaultUrlencodedParser(req, res, next)
    }
  ]
}

function createTopLevelLogFileHandler(server) {
  return async (req, res) => {
    const workspace = typeof req.query.workspace === 'string' ? req.query.workspace.trim() : ''
    let context
    try {
      context = await server.resolveLogsRoot({ workspace })
    } catch (error) {
      res.status(404).json({ error: error && error.message ? error.message : 'Workspace not found' })
      return
    }
    const logsRoot = context.logsRoot
    let descriptor
    try {
      descriptor = server.resolveLogsAbsolutePath(logsRoot, req.query.path || '')
    } catch (_) {
      res.status(400).json({ error: 'Invalid path' })
      return
    }
    const relativePath = server.formatLogsRelativePath(descriptor.relativePath)
    if (!isTopLevelRedactableLogPath(relativePath)) {
      res.status(400).json({ error: 'Only top-level text log files can be read for redaction' })
      return
    }
    const tailLines = normalizeTailLineCount(req.query.tail_lines || req.query.lines)
    let stats
    try {
      stats = await fs.promises.stat(descriptor.absolutePath)
    } catch (_) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    if (!stats.isFile()) {
      res.status(400).json({ error: 'Path is not a file' })
      return
    }
    if (stats.size > LOG_REDACTION_FILE_MAX_BYTES && !tailLines) {
      res.status(413).json({
        error: 'File is too large to redact in the browser',
        size: stats.size,
        max_size: LOG_REDACTION_FILE_MAX_BYTES
      })
      return
    }
    try {
      const binary = await isBinaryFile(descriptor.absolutePath)
      if (binary) {
        res.status(415).json({ error: 'Binary files cannot be redacted in the browser' })
        return
      }
    } catch (_) {}
    let text
    let tail = null
    try {
      if (tailLines) {
        tail = await readTailTextFile(descriptor.absolutePath, stats, tailLines)
        text = tail.text
      } else {
        text = await fs.promises.readFile(descriptor.absolutePath, 'utf8')
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to read file', detail: error.message })
      return
    }
    res.set('Cache-Control', 'no-store')
    res.json({
      path: relativePath,
      name: path.basename(relativePath),
      size: stats.size,
      modified: stats.mtime,
      tail_lines: tailLines || null,
      truncated: tail ? tail.truncated : false,
      included_lines: tail ? tail.included_lines : null,
      text
    })
  }
}

module.exports = {
  LOG_REDACTION_FILE_MAX_BYTES,
  isTopLevelRedactableLogPath,
  normalizeTailLineCount,
  createCurrentLogSnapshot,
  writeCurrentLogSnapshot,
  normalizeLogRedactionOverrides,
  normalizeLogRedactionExclusions,
  assertCompleteLogRedactionOverrides,
  applyLogRedactionExclusions,
  applyLogRedactionOverrides,
  createLogRedactionBodyParser,
  createLogRedactionBodyParsers,
  createTopLevelLogFileHandler
}
