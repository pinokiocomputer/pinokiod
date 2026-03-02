const fs = require('fs')
const path = require('path')
const axios = require('axios')
const Util = require('../../kernel/util')

class AppRegistryService {
  constructor({ kernel }) {
    if (!kernel) {
      throw new Error('AppRegistryService requires kernel')
    }
    this.kernel = kernel
  }

  isPathWithin(parentPath, childPath) {
    if (!parentPath || !childPath) {
      return false
    }
    const relative = path.relative(parentPath, childPath)
    if (!relative) {
      return true
    }
    return !relative.startsWith('..') && !path.isAbsolute(relative)
  }

  normalizeAppId(appId = '') {
    if (typeof appId !== 'string') {
      return ''
    }
    const trimmed = appId.trim()
    if (!trimmed) {
      return ''
    }
    const normalized = trimmed.replace(/\\/g, '/')
    if (normalized.includes('/') || normalized === '.' || normalized === '..') {
      return ''
    }
    return normalized
  }

  normalizeRelativeScriptPath(scriptPath = '') {
    if (typeof scriptPath !== 'string') {
      return ''
    }
    const trimmed = scriptPath.trim()
    if (!trimmed) {
      return ''
    }
    const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'))
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/')) {
      return ''
    }
    return normalized
  }

  async pathIsDirectory(targetPath) {
    try {
      const stats = await fs.promises.stat(targetPath)
      return stats.isDirectory()
    } catch (_) {
      return false
    }
  }

  async pathIsFile(targetPath) {
    try {
      const stats = await fs.promises.stat(targetPath)
      return stats.isFile()
    } catch (_) {
      return false
    }
  }

  async firstExistingScript(appRoot, candidates = []) {
    for (const candidate of candidates) {
      const scriptName = this.normalizeRelativeScriptPath(candidate)
      if (!scriptName) {
        continue
      }
      const fullPath = path.resolve(appRoot, ...scriptName.split('/'))
      if (!this.isPathWithin(appRoot, fullPath)) {
        continue
      }
      if (await this.pathIsFile(fullPath)) {
        return scriptName
      }
    }
    return null
  }

  toPosixRelative(fromPath, toPath) {
    const relative = path.relative(fromPath, toPath)
    return relative.split(path.sep).join('/')
  }

  collectAppRuntime(appRoot) {
    const runtime = {
      running: false,
      ready: false,
      state: 'offline',
      ready_url: null,
      ready_script: null,
      running_scripts: [],
      local_entries: []
    }
    const runningMap = (this.kernel && this.kernel.api && this.kernel.api.running) ? this.kernel.api.running : {}
    const localMap = (this.kernel && this.kernel.memory && this.kernel.memory.local) ? this.kernel.memory.local : {}
    const runningScripts = []
    for (const key of Object.keys(runningMap || {})) {
      const scriptPath = String(key || '').split('?')[0]
      if (!scriptPath || !path.isAbsolute(scriptPath)) {
        continue
      }
      if (!this.isPathWithin(appRoot, scriptPath)) {
        continue
      }
      runningScripts.push(scriptPath)
    }
    const localEntries = []
    for (const [key, local] of Object.entries(localMap || {})) {
      const scriptPath = String(key || '').split('?')[0]
      if (!scriptPath || !path.isAbsolute(scriptPath)) {
        continue
      }
      if (!this.isPathWithin(appRoot, scriptPath)) {
        continue
      }
      localEntries.push({
        script: scriptPath,
        local: local || {}
      })
    }
    let readyEntry = null
    for (const scriptPath of runningScripts) {
      const entry = localEntries.find((item) => item.script === scriptPath && item.local && typeof item.local.url === 'string' && item.local.url.trim())
      if (entry) {
        readyEntry = entry
        break
      }
    }
    if (!readyEntry) {
      readyEntry = localEntries.find((item) => item.local && typeof item.local.url === 'string' && item.local.url.trim())
    }
    runtime.running = runningScripts.length > 0
    runtime.running_scripts = runningScripts.map((fullPath) => this.toPosixRelative(appRoot, fullPath))
    runtime.local_entries = localEntries.map((entry) => {
      return {
        script: this.toPosixRelative(appRoot, entry.script),
        local: entry.local || {}
      }
    })
    if (readyEntry) {
      runtime.ready_url = readyEntry.local.url
      runtime.ready_script = this.toPosixRelative(appRoot, readyEntry.script)
    }
    runtime.ready = Boolean(runtime.ready_url)
    if (runtime.running) {
      runtime.state = runtime.ready ? 'online' : 'starting'
    }
    return runtime
  }

  async probeUrlReady(url, timeoutMs = 1500) {
    if (!url || typeof url !== 'string') {
      return false
    }
    try {
      await axios.get(url, {
        timeout: timeoutMs,
        maxRedirects: 0,
        validateStatus: () => true
      })
      return true
    } catch (_) {
      return false
    }
  }

  parseBooleanQuery(input, fallback = false) {
    if (typeof input === 'boolean') {
      return input
    }
    if (typeof input === 'number') {
      return input !== 0
    }
    if (typeof input === 'string') {
      const normalized = input.trim().toLowerCase()
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false
      }
    }
    return fallback
  }

  parseTailCount(input, fallback = 200) {
    const parsed = Number.parseInt(String(input || ''), 10)
    if (!Number.isFinite(parsed)) {
      return fallback
    }
    return Math.min(Math.max(parsed, 1), 5000)
  }

  async listInfoApps() {
    const apps = []
    try {
      const apipath = this.kernel.path('api')
      const entries = await fs.promises.readdir(apipath, { withFileTypes: true })
      for (const entry of entries) {
        let type
        try {
          type = await Util.file_type(apipath, entry)
        } catch (typeErr) {
          console.warn('Failed to inspect api entry', entry.name, typeErr)
          continue
        }
        if (!type || !type.directory) {
          continue
        }
        try {
          const meta = await this.kernel.api.meta(entry.name)
          apps.push({
            name: entry.name,
            title: meta && meta.title ? meta.title : entry.name,
            description: meta && meta.description ? meta.description : '',
            icon: meta && meta.icon ? meta.icon : '/pinokio-black.png'
          })
        } catch (metaError) {
          console.warn('Failed to load app metadata', entry.name, metaError)
          apps.push({
            name: entry.name,
            title: entry.name,
            description: '',
            icon: '/pinokio-black.png'
          })
        }
      }
    } catch (enumerationError) {
      console.warn('Failed to enumerate api apps for url dropdown', enumerationError)
    }
    apps.sort((a, b) => {
      const at = (a.title || a.name || '').toLowerCase()
      const bt = (b.title || b.name || '').toLowerCase()
      if (at < bt) return -1
      if (at > bt) return 1
      return (a.name || '').localeCompare(b.name || '')
    })
    return apps
  }

  async buildAppStatus(appId, options = {}) {
    const normalizedAppId = this.normalizeAppId(appId)
    if (!normalizedAppId) {
      return null
    }
    const apiRoot = this.kernel.path('api')
    const appRoot = path.resolve(apiRoot, normalizedAppId)
    if (!this.isPathWithin(apiRoot, appRoot)) {
      return null
    }
    const relativeToApi = path.relative(apiRoot, appRoot)
    if (!relativeToApi || relativeToApi.includes(path.sep)) {
      return null
    }
    if (!(await this.pathIsDirectory(appRoot))) {
      return null
    }

    let meta
    try {
      meta = await this.kernel.api.meta(normalizedAppId)
    } catch (_) {
      meta = null
    }

    const runtime = this.collectAppRuntime(appRoot)
    const installScript = await this.firstExistingScript(appRoot, ['install.js', 'install.json'])
    const startScript = await this.firstExistingScript(appRoot, ['start.js', 'start.json'])
    let defaultTarget = null
    try {
      defaultTarget = await this.kernel.api.get_default(appRoot)
    } catch (_) {
      defaultTarget = null
    }
    let defaultScript = null
    if (defaultTarget && typeof defaultTarget === 'string' && path.isAbsolute(defaultTarget) && this.isPathWithin(appRoot, defaultTarget)) {
      defaultScript = this.toPosixRelative(appRoot, defaultTarget)
    }
    let ready = runtime.ready
    let state = runtime.state
    let probe = null
    const shouldProbe = this.parseBooleanQuery(options.probe, false)
    if (shouldProbe && runtime.ready_url) {
      probe = await this.probeUrlReady(runtime.ready_url, Number.isFinite(options.timeout) ? options.timeout : 1500)
      ready = probe
      if (runtime.running) {
        state = probe ? 'online' : 'starting'
      }
    }
    return {
      app_id: normalizedAppId,
      name: normalizedAppId,
      title: meta && meta.title ? meta.title : normalizedAppId,
      description: meta && meta.description ? meta.description : '',
      icon: meta && meta.icon ? meta.icon : '/pinokio-black.png',
      path: appRoot,
      install_script: installScript,
      start_script: startScript,
      default_target: defaultTarget || null,
      default_script: defaultScript,
      running: runtime.running,
      ready,
      ready_url: runtime.ready_url,
      state,
      running_scripts: runtime.running_scripts,
      ready_script: runtime.ready_script,
      local_entries: runtime.local_entries,
      probe,
      last_error: null
    }
  }
}

module.exports = AppRegistryService
