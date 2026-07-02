const fs = require('fs')
const os = require('os')
const path = require('path')
const Environment = require('../../kernel/environment')

const DEFAULT_TAIL_LINES = 800
const MAX_SECTION_CHARS = 120000
const SENSITIVE_ENV_KEY = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API[_-]?KEY|APIKEY|CREDENTIAL|COOKIE|SESSION|AUTH|PRIVATE[_-]?KEY)/i

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

class AppLogReportService {
  constructor({ registry, kernel = null }) {
    if (!registry) {
      throw new Error('AppLogReportService requires registry')
    }
    this.registry = registry
    this.kernel = kernel
  }

  async buildReport({ appId, status, tail = DEFAULT_TAIL_LINES, redact = true, session = '' }) {
    const workspaceRoot = status && status.path ? status.path : null
    if (!workspaceRoot) {
      return null
    }
    const appRoot = await this.resolveAppRoot(workspaceRoot)
    const tailLines = this.registry.parseTailCount(tail, DEFAULT_TAIL_LINES)
    const sessionIndex = await this.readSessionIndex(appRoot)
    const requestedSession = typeof session === 'string' && session.trim()
      ? session.trim()
      : sessionIndex.latest_session
    const manifest = requestedSession ? await this.readSessionManifest(appRoot, requestedSession) : null
    const selectedSession = manifest ? manifest.id : null
    const rawSections = await this.collectSections(appRoot, tailLines, manifest)
    const sections = []
    const totals = {}

    for (const section of rawSections) {
      if (redact) {
        const redacted = this.redactText(section.text, { appRoot, workspaceRoot })
        this.mergeCounts(totals, redacted.counts)
        sections.push({
          ...section,
          text: redacted.text,
          redactions: redacted.counts
        })
      } else {
        sections.push({
          ...section,
          redactions: {}
        })
      }
    }

    const metadata = {
      app_id: appId,
      title: status.title || appId,
      repo_url: this.sanitizeRemoteUrl(status.repo_url || this.readGitRemote(workspaceRoot)),
      generated_at: new Date().toISOString(),
      pinokiod: this.readPinokioVersion(),
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      tail_count: tailLines,
      system_spec: this.buildSystemSpec(),
      redaction_mode: redact ? 'server_deterministic' : 'none',
      latest_session: sessionIndex.latest_session,
      session: selectedSession,
      sessions: sessionIndex.sessions,
      no_session: !manifest
    }

    return {
      ...metadata,
      section_count: sections.length,
      sections,
      redactions: totals,
      markdown: this.renderMarkdown(metadata, sections, totals)
    }
  }

  async collectSections(appRoot, tailLines, manifest = null) {
    const sections = []
    if (!manifest || !Array.isArray(manifest.runs)) {
      return sections
    }
    const logsRoot = path.resolve(appRoot, 'logs')
    for (const run of manifest.runs) {
      const logs = Array.isArray(run && run.logs) ? run.logs : []
      for (const log of logs) {
        const file = this.resolveManifestLog(appRoot, log)
        if (!file) {
          continue
        }
        const relativeLog = this.toPosix(path.relative(appRoot, file))
        sections.push(await this.buildSection({
          appRoot,
          root: logsRoot,
          file,
          source: this.sourceFromRelativeFile(relativeLog),
          script: run.script || this.scriptFromRelativeFile(relativeLog),
          tailLines
        }))
      }
    }

    return sections.filter(Boolean)
  }

  async resolveAppRoot(workspaceRoot) {
    const fallback = path.resolve(workspaceRoot)
    if (!this.kernel || typeof this.kernel.exists !== 'function') {
      return fallback
    }
    try {
      const root = await Environment.get_root({ path: fallback }, this.kernel)
      return root && root.root ? path.resolve(root.root) : fallback
    } catch (_) {
      return fallback
    }
  }

  safeSessionId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value) ? value : ''
  }

  async readSessionIndex(appRoot) {
    try {
      const indexPath = path.resolve(appRoot, 'logs', 'sessions', 'index.json')
      const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
        return { latest_session: null, sessions: [] }
      }
      return {
        latest_session: this.safeSessionId(parsed.latest_session) || null,
        sessions: parsed.sessions
          .filter((entry) => entry && typeof entry === 'object' && this.safeSessionId(entry.id))
          .map((entry) => ({
            id: entry.id,
            created_at: typeof entry.created_at === 'string' ? entry.created_at : null,
            updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : null,
            runs: Array.isArray(entry.runs) ? entry.runs.filter((run) => typeof run === 'string') : []
          }))
      }
    } catch (_) {
      return { latest_session: null, sessions: [] }
    }
  }

  async readSessionManifest(appRoot, sessionId) {
    const safeId = this.safeSessionId(sessionId)
    if (!safeId) {
      return null
    }
    try {
      const manifestPath = path.resolve(appRoot, 'logs', 'sessions', `${safeId}.json`)
      const parsed = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || parsed.id !== safeId || !Array.isArray(parsed.runs)) {
        return null
      }
      return parsed
    } catch (_) {
      return null
    }
  }

  resolveManifestLog(appRoot, log) {
    if (!log || typeof log.path !== 'string' || !log.path.trim()) {
      return null
    }
    const logsRoot = path.resolve(appRoot, 'logs')
    const sessionsRoot = path.resolve(logsRoot, 'sessions')
    const file = path.resolve(appRoot, log.path)
    if (!this.registry.isPathWithin(logsRoot, file)) {
      return null
    }
    if (this.registry.isPathWithin(sessionsRoot, file)) {
      return null
    }
    if (path.basename(file) === 'latest') {
      return null
    }
    return file
  }

  sourceFromRelativeFile(relativeFile) {
    const parts = String(relativeFile || '').split('/').filter(Boolean)
    return parts[0] === 'logs' && parts[1] ? parts[1] : 'api'
  }

  scriptFromRelativeFile(relativeFile) {
    const parts = String(relativeFile || '').split('/').filter(Boolean)
    if (parts[0] === 'logs' && parts[1] === 'api' && parts.length > 3) {
      return parts.slice(2, -1).join('/')
    }
    return ''
  }

  async buildSection({ appRoot, root, file, source, script, tailLines }) {
    if (!this.registry.isPathWithin(root, file)) {
      return null
    }
    let text = ''
    let stats = null
    try {
      text = await fs.promises.readFile(file, 'utf8')
      stats = await fs.promises.stat(file)
    } catch (_) {
      return null
    }
    const allLines = text.split(/\r?\n/)
    if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
      allLines.pop()
    }
    let tail = allLines.slice(-tailLines).join('\n')
    let truncatedByChars = false
    if (tail.length > MAX_SECTION_CHARS) {
      tail = tail.slice(-MAX_SECTION_CHARS)
      truncatedByChars = true
    }
    return {
      source,
      script,
      file: this.toPosix(path.relative(appRoot, file)),
      line_count: allLines.length,
      tail_count: tailLines,
      size: stats ? stats.size : Buffer.byteLength(text),
      modified: stats ? stats.mtime : null,
      truncated: allLines.length > tailLines || truncatedByChars,
      text: tail
    }
  }

  redactText(input, context = {}) {
    let text = typeof input === 'string' ? input : ''
    const counts = {}
    const replace = (name, pattern, replacement) => {
      text = text.replace(pattern, (...args) => {
        counts[name] = (counts[name] || 0) + 1
        if (typeof replacement === 'function') {
          return replacement(...args)
        }
        return String(replacement).replace(/\$(\d+)/g, (_, index) => {
          const value = args[Number.parseInt(index, 10)]
          return value === undefined ? '' : String(value)
        })
      })
    }

    replace('private_keys', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    text = text.replace(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*).*$/gm, (match, prefix, key, separator) => {
      if (!SENSITIVE_ENV_KEY.test(key)) {
        return match
      }
      counts.env_secrets = (counts.env_secrets || 0) + 1
      return `${prefix}${key}${separator}[REDACTED_SECRET]`
    })
    replace('auth_headers', /\b(Authorization|Proxy-Authorization)\s*:\s*([^\r\n]+)/gi, '$1: [REDACTED_AUTH]')
    replace('url_credentials', /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, '$1[REDACTED_CREDENTIALS]@')
    replace('sensitive_query_params', /([?&](?:access_token|refresh_token|token|secret|password|passwd|api[_-]?key|apikey|auth|session|cookie|key)=)([^&\s"'<>]+)/gi, '$1[REDACTED_SECRET]')
    replace('secret_flags', /((?:--?|\/)(?:token|secret|password|passwd|passphrase|api[-_]?key|apikey|credential|cookie|session|auth)(?:=|\s+))("[^"]*"|'[^']*'|[^\s]+)/gi, '$1[REDACTED_SECRET]')
    replace('openai_keys', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]')
    replace('huggingface_tokens', /\bhf_[A-Za-z0-9]{20,}\b/g, '[REDACTED_HF_TOKEN]')
    replace('github_tokens', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    replace('github_pat_tokens', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    replace('aws_access_keys', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    replace('stripe_secret_keys', /\bsk_live_[A-Za-z0-9]{20,}\b/g, '[REDACTED_STRIPE_KEY]')
    replace('jwt_tokens', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    replace('emails', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')

    const pathPatterns = this.buildPathPatterns(context)
    for (const pattern of pathPatterns) {
      replace('local_paths', pattern, (match, prefix) => `${prefix || ''}[REDACTED_LOCAL_PATH]`)
    }

    text = text.replace(/(^|\s)([A-Za-z0-9_./+=-]{48,})(?=\s|$)/g, (match, prefix, value) => {
      if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
        return match
      }
      counts.likely_secret_values = (counts.likely_secret_values || 0) + 1
      return `${prefix}[REDACTED_SECRET]`
    })

    return { text, counts }
  }

  buildPathPatterns(context = {}) {
    const patterns = [
      /(^|[\s"'(=])\/Users\/[^/\s"')]+/g,
      /(^|[\s"'(=])\/home\/[^/\s"')]+/g,
      /(^|[\s"'(=])[A-Za-z]:\\Users\\[^\\\s"')]+/g
    ]
    const roots = [context.workspaceRoot, context.appRoot]
      .map((root) => root ? String(root) : '')
      .filter((root, index, values) => root && values.indexOf(root) === index)
    for (const root of roots) {
      patterns.push(new RegExp(`(^|[\\s"'(=])${escapeRegExp(root)}`, 'g'))
    }
    return patterns
  }

  mergeCounts(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
      target[key] = (target[key] || 0) + value
    }
  }

  renderMarkdown(metadata, sections, redactions) {
    const lines = [
      '# Issue Report',
      '',
      `App: ${metadata.title} (${metadata.app_id})`,
      metadata.repo_url ? `Repo: ${metadata.repo_url}` : null,
      `Generated: ${metadata.generated_at}`,
      `Pinokio: ${metadata.pinokiod || 'unknown'}`,
      `Platform: ${metadata.platform} ${metadata.arch}`,
      `Node: ${metadata.node}`,
      '',
      '## Summary',
      '',
      '',
      '## System',
      '',
      '```json',
      JSON.stringify(metadata.system_spec || {}, null, 2),
      '```'
    ].filter((line) => line !== null)

    if (metadata.redaction_mode !== 'none') {
      lines.push(
        '',
        '## Sanitization',
        '',
        this.renderRedactionSummary(redactions, metadata.redaction_mode)
      )
    }

    lines.push('', '## Logs')

    if (sections.length === 0) {
      lines.push('', metadata.no_session ? 'No session log bundle found.' : 'No app log files were found.')
    }

    for (const section of sections) {
      lines.push(
        '',
        `### ${section.file}`,
        '',
        `Source: ${section.source}${section.script ? ` / ${section.script}` : ''}`,
        `Lines: ${section.line_count} total, last ${Math.min(section.line_count, section.tail_count)} included${section.truncated ? ' (truncated)' : ''}`,
        '',
        '```text',
        section.text || '',
        '```'
      )
    }

    return lines.join('\n')
  }

  renderRedactionSummary(redactions, redactionMode = 'server_deterministic') {
    if (redactionMode === 'none') {
      return ''
    }
    const entries = Object.entries(redactions || {}).filter(([, count]) => count > 0)
    if (entries.length === 0) {
      return 'Basic redaction did not find structured secrets.'
    }
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `- ${name.replace(/_/g, ' ')}: ${count}`)
      .join('\n')
  }

  readGitRemote(appRoot) {
    if (!appRoot) {
      return null
    }
    try {
      const configPath = path.resolve(appRoot, '.git', 'config')
      if (!this.registry.isPathWithin(appRoot, configPath)) {
        return null
      }
      const raw = fs.readFileSync(configPath, 'utf8')
      const originMatch = raw.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/)
      if (originMatch && originMatch[1]) {
        return this.sanitizeRemoteUrl(originMatch[1])
      }
      const firstRemote = raw.match(/\[remote "[^"]+"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/)
      return firstRemote && firstRemote[1] ? this.sanitizeRemoteUrl(firstRemote[1]) : null
    } catch (_) {
      return null
    }
  }

  sanitizeRemoteUrl(value) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      return null
    }
    try {
      const parsed = new URL(text)
      if (parsed.username || parsed.password) {
        parsed.username = ''
        parsed.password = ''
        return parsed.toString()
      }
    } catch (_) {
      return text
    }
    return text
  }

  toPosix(value) {
    return String(value || '').split(path.sep).filter(Boolean).join('/')
  }

  buildSystemSpec() {
    const kernel = this.kernel || {}
    const info = kernel.sysinfo && typeof kernel.sysinfo === 'object' ? kernel.sysinfo : {}
    return this.compactObject({
      pinokio: {
        version: this.readPinokioVersion(),
        node: process.version,
        platform: kernel.platform || process.platform,
        arch: kernel.arch || process.arch
      },
      hardware: this.compactObject({
        gpu: kernel.gpu || info.gpu || null,
        gpu_model: kernel.gpu_model || info.gpu_model || null,
        ram_gb: typeof kernel.ram === 'number' ? kernel.ram : info.ram,
        vram_gb: typeof kernel.vram === 'number' ? kernel.vram : info.vram
      }),
      os: this.sanitizeOsInfo(info.osInfo),
      system: this.sanitizeSystem(info.system),
      cpu: this.sanitizeCpu(info.cpu),
      memory: this.sanitizeMemory(info.mem),
      gpus: this.sanitizeGpus(info.gpus),
      graphics: this.sanitizeGraphics(info.graphics)
    })
  }

  sanitizeOsInfo(value) {
    return this.pickObject(value, [
      'platform',
      'distro',
      'release',
      'codename',
      'kernel',
      'arch',
      'build',
      'servicepack',
      'uefi'
    ])
  }

  sanitizeSystem(value) {
    return this.pickObject(value, [
      'manufacturer',
      'model',
      'version',
      'virtual'
    ])
  }

  sanitizeCpu(value) {
    return this.pickObject(value, [
      'manufacturer',
      'brand',
      'vendor',
      'family',
      'model',
      'stepping',
      'revision',
      'speed',
      'speedMin',
      'speedMax',
      'cores',
      'physicalCores',
      'processors',
      'performanceCores',
      'efficiencyCores',
      'virtualization',
      'cache'
    ])
  }

  sanitizeMemory(value) {
    return this.pickObject(value, [
      'total',
      'free',
      'used',
      'active',
      'available',
      'buffers',
      'cached',
      'slab',
      'buffcache',
      'swaptotal',
      'swapused',
      'swapfree'
    ])
  }

  sanitizeGpus(value) {
    if (!Array.isArray(value)) {
      return []
    }
    return value.map((gpu) => this.pickObject(gpu, [
      'vendor',
      'model',
      'bus',
      'vram',
      'vramDynamic',
      'cores',
      'metalVersion',
      'cudaVersion',
      'driverVersion'
    ])).filter((gpu) => Object.keys(gpu).length > 0)
  }

  sanitizeGraphics(value) {
    if (!value || typeof value !== 'object') {
      return null
    }
    return this.compactObject({
      controllers: Array.isArray(value.controllers)
        ? value.controllers.map((controller) => this.pickObject(controller, [
          'vendor',
          'model',
          'bus',
          'vram',
          'vramDynamic',
          'cores',
          'metalVersion',
          'cudaVersion',
          'driverVersion'
        ])).filter((controller) => Object.keys(controller).length > 0)
        : [],
      displays: Array.isArray(value.displays)
        ? value.displays.map((display) => this.pickObject(display, [
          'model',
          'main',
          'builtin',
          'connection',
          'currentResX',
          'currentResY',
          'resolutionX',
          'resolutionY',
          'pixelDepth',
          'currentRefreshRate'
        ])).filter((display) => Object.keys(display).length > 0)
        : []
    })
  }

  pickObject(value, keys) {
    if (!value || typeof value !== 'object') {
      return null
    }
    const out = {}
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null && value[key] !== '') {
        out[key] = value[key]
      }
    }
    return this.compactObject(out)
  }

  compactObject(value) {
    if (!value || typeof value !== 'object') {
      return value
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => this.compactObject(entry))
        .filter((entry) => {
          if (entry === null || entry === undefined || entry === '') return false
          if (Array.isArray(entry)) return entry.length > 0
          if (typeof entry === 'object') return Object.keys(entry).length > 0
          return true
        })
    }
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      const compacted = this.compactObject(entry)
      if (compacted === null || compacted === undefined || compacted === '') continue
      if (Array.isArray(compacted) && compacted.length === 0) continue
      if (typeof compacted === 'object' && !Array.isArray(compacted) && Object.keys(compacted).length === 0) continue
      out[key] = compacted
    }
    return out
  }

  readPinokioVersion() {
    try {
      const pkg = require('../../package.json')
      return pkg && pkg.version ? String(pkg.version) : null
    } catch (_) {
      return null
    }
  }
}

AppLogReportService.DEFAULT_TAIL_LINES = DEFAULT_TAIL_LINES

module.exports = AppLogReportService
