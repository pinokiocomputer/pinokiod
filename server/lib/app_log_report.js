const fs = require('fs')
const os = require('os')
const path = require('path')

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

  async buildReport({ appId, status, tail = DEFAULT_TAIL_LINES, redact = true }) {
    const appRoot = status && status.path ? status.path : null
    if (!appRoot) {
      return null
    }
    const tailLines = this.registry.parseTailCount(tail, DEFAULT_TAIL_LINES)
    const rawSections = await this.collectSections(appRoot, tailLines)
    const sections = []
    const totals = {}

    for (const section of rawSections) {
      if (redact) {
        const redacted = this.redactText(section.text, { appRoot })
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
      generated_at: new Date().toISOString(),
      pinokiod: this.readPinokioVersion(),
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      tail_count: tailLines,
      system_spec: this.buildSystemSpec(),
      redaction_mode: redact ? 'server_deterministic' : 'none'
    }

    return {
      ...metadata,
      section_count: sections.length,
      sections,
      redactions: totals,
      markdown: this.renderMarkdown(metadata, sections, totals)
    }
  }

  async collectSections(appRoot, tailLines) {
    const sections = []
    const apiLogsRoot = path.resolve(appRoot, 'logs', 'api')

    if (await this.registry.pathIsDirectory(apiLogsRoot)) {
      const latestFiles = await this.findNamedFiles(apiLogsRoot, 'latest')
      for (const file of latestFiles) {
        const relativeDir = path.relative(apiLogsRoot, path.dirname(file))
        const script = this.toPosix(relativeDir)
        sections.push(await this.buildSection({
          appRoot,
          root: apiLogsRoot,
          file,
          source: 'api',
          script,
          tailLines
        }))
      }
    }

    return sections
      .filter(Boolean)
      .sort((a, b) => this.compareSections(a, b))
  }

  async findNamedFiles(root, filename) {
    const out = []
    const walk = async (dir) => {
      let entries = []
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch (_) {
        return
      }
      for (const entry of entries) {
        const entryPath = path.resolve(dir, entry.name)
        if (!this.registry.isPathWithin(root, entryPath)) {
          continue
        }
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else if (entry.name === filename) {
          out.push(entryPath)
        }
      }
    }
    await walk(root)
    return out
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
    const appRoot = context.appRoot ? String(context.appRoot) : ''
    if (appRoot) {
      patterns.push(new RegExp(`(^|[\\s"'(=])${escapeRegExp(appRoot)}`, 'g'))
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
    ]

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
      lines.push('', 'No app log files were found.')
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

  compareSections(a, b) {
    const sourceOrder = { api: 0, shell: 1 }
    const bySource = (sourceOrder[a.source] ?? 99) - (sourceOrder[b.source] ?? 99)
    if (bySource !== 0) return bySource
    return this.scriptRank(a.script) - this.scriptRank(b.script)
      || String(a.script || '').localeCompare(String(b.script || ''))
      || String(a.file || '').localeCompare(String(b.file || ''))
  }

  scriptRank(script) {
    const value = String(script || '').toLowerCase()
    const ordered = ['install', 'update', 'start', 'run', 'launch', 'serve', 'shell']
    const idx = ordered.findIndex((name) => value === name || value.startsWith(`${name}.`) || value.includes(`/${name}.`))
    return idx >= 0 ? idx : ordered.length
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
        arch: kernel.arch || process.arch,
        torch_backend: kernel.torch_backend || info.torch_backend || null
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
