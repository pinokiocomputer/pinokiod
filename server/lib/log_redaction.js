const fs = require('fs')
const path = require('path')
const { isBinaryFile } = require('isbinaryfile')

const LOG_REDACTION_FILE_MAX_BYTES = 2 * 1024 * 1024
const LOG_REDACTION_OVERRIDE_MAX_BYTES = 8 * 1024 * 1024
const LOG_REDACTION_TEXT_EXTENSIONS = new Set(['.json', '.log', '.txt'])
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

function createCurrentLogSnapshot(kernel, version) {
  const states = kernel.shell.shells.map((s) => {
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

async function assertCompleteLogRedactionOverrides(exportRoot, overrides = []) {
  const overridePaths = new Set((Array.isArray(overrides) ? overrides : []).map((override) => override && override.path).filter(Boolean))
  const missing = []
  const entries = await fs.promises.readdir(exportRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && isTopLevelRedactableLogPath(entry.name) && !overridePaths.has(entry.name)) {
      missing.push(entry.name)
    }
  }
  if (missing.length > 0) {
    missing.sort((a, b) => a.localeCompare(b))
    throw new Error(`Missing redaction override for top-level file${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`)
  }
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
    if (stats.size > LOG_REDACTION_FILE_MAX_BYTES) {
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
    try {
      text = await fs.promises.readFile(descriptor.absolutePath, 'utf8')
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
      text
    })
  }
}

module.exports = {
  LOG_REDACTION_FILE_MAX_BYTES,
  isTopLevelRedactableLogPath,
  createCurrentLogSnapshot,
  writeCurrentLogSnapshot,
  normalizeLogRedactionOverrides,
  assertCompleteLogRedactionOverrides,
  applyLogRedactionOverrides,
  createLogRedactionBodyParser,
  createLogRedactionBodyParsers,
  createTopLevelLogFileHandler
}
