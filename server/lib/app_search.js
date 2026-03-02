const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const MiniSearch = require('minisearch')

const APP_SEARCH_CACHE_TTL_MS = 15000
const APP_SEARCH_MAX_FILE_BYTES = 1024 * 1024
const APP_SEARCH_MAX_DOC_CHARS = 60000
const APP_SEARCH_ROOT_FILES = new Set([
  'pinokio.json',
  'pinokio.js',
  'install.js',
  'start.js',
  'update.js',
  'reset.js'
])
const APP_SEARCH_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  'site-packages',
  'logs',
  'dist',
  'build',
  'tmp',
  'temp',
  '.cache'
])

class AppSearchService {
  constructor({ kernel, registry }) {
    if (!kernel || !registry) {
      throw new Error('AppSearchService requires kernel and registry')
    }
    this.kernel = kernel
    this.registry = registry
    this.state = {
      updatedAt: 0,
      index: null,
      docs: [],
      apps: [],
      appsById: new Map(),
      perApp: new Map()
    }
  }

  isReadmeFilename(filename = '') {
    return /^readme(?:\..+)?$/i.test(String(filename || ''))
  }

  normalizeSearchText(value = '') {
    if (typeof value !== 'string') {
      return ''
    }
    const withoutNulls = value.replace(/\0/g, '')
    const compact = withoutNulls.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (!compact) {
      return ''
    }
    if (compact.length <= APP_SEARCH_MAX_DOC_CHARS) {
      return compact
    }
    return compact.slice(0, APP_SEARCH_MAX_DOC_CHARS)
  }

  buildAppSearchDocId(appId, relativePath) {
    const source = `${appId}::${relativePath}`
    return crypto.createHash('sha1').update(source).digest('hex')
  }

  async collectAppSearchCandidates(appRoot) {
    const candidates = []
    const appendCandidate = async (absolutePath, relativePath, source) => {
      if (!this.registry.isPathWithin(appRoot, absolutePath)) {
        return
      }
      let stats
      try {
        stats = await fs.promises.stat(absolutePath)
      } catch (_) {
        return
      }
      if (!stats.isFile()) {
        return
      }
      candidates.push({
        absolutePath,
        relativePath: relativePath.split(path.sep).join('/'),
        source,
        size: Number(stats.size || 0),
        mtimeMs: Number(stats.mtimeMs || 0)
      })
    }

    let rootEntries = []
    try {
      rootEntries = await fs.promises.readdir(appRoot, { withFileTypes: true })
    } catch (_) {
      return candidates
    }

    for (const entry of rootEntries) {
      if (!entry || !entry.name || !entry.isFile()) {
        continue
      }
      const lowerName = entry.name.toLowerCase()
      if (!APP_SEARCH_ROOT_FILES.has(lowerName) && !this.isReadmeFilename(entry.name)) {
        continue
      }
      const absolutePath = path.resolve(appRoot, entry.name)
      await appendCandidate(absolutePath, entry.name, 'root')
    }

    for (const entry of rootEntries) {
      if (!entry || !entry.name || !entry.isDirectory()) {
        continue
      }
      const lowerName = entry.name.toLowerCase()
      if (APP_SEARCH_IGNORED_DIRS.has(lowerName)) {
        continue
      }
      const subdir = path.resolve(appRoot, entry.name)
      if (!this.registry.isPathWithin(appRoot, subdir)) {
        continue
      }
      let subEntries = []
      try {
        subEntries = await fs.promises.readdir(subdir, { withFileTypes: true })
      } catch (_) {
        continue
      }
      for (const subEntry of subEntries) {
        if (!subEntry || !subEntry.name || !subEntry.isFile()) {
          continue
        }
        if (!this.isReadmeFilename(subEntry.name)) {
          continue
        }
        const absolutePath = path.resolve(subdir, subEntry.name)
        const relativePath = path.join(entry.name, subEntry.name)
        await appendCandidate(absolutePath, relativePath, 'subdir-readme')
      }
    }

    candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    return candidates
  }

  computeAppSearchFingerprint(app, candidates = []) {
    const segments = [
      `name:${app && app.name ? app.name : ''}`,
      `title:${app && app.title ? app.title : ''}`,
      `description:${app && app.description ? app.description : ''}`,
      `icon:${app && app.icon ? app.icon : ''}`
    ]
    for (const candidate of candidates) {
      segments.push(`${candidate.relativePath}:${candidate.mtimeMs}:${candidate.size}`)
    }
    return crypto.createHash('sha1').update(segments.join('\n')).digest('hex')
  }

  async buildAppSearchDocs(app, candidates = []) {
    const docs = []
    const appId = app && app.name ? app.name : ''
    if (!appId) {
      return docs
    }

    const metadataText = this.normalizeSearchText([
      appId,
      app.title || '',
      app.description || ''
    ].join('\n'))

    docs.push({
      id: this.buildAppSearchDocId(appId, 'pinokio.meta'),
      app_id: appId,
      file: 'pinokio.meta',
      source: 'metadata',
      title: app.title || appId,
      text: metadataText
    })

    for (const candidate of candidates) {
      if (candidate.size > APP_SEARCH_MAX_FILE_BYTES) {
        continue
      }
      let raw
      try {
        raw = await fs.promises.readFile(candidate.absolutePath, 'utf8')
      } catch (_) {
        continue
      }
      const text = this.normalizeSearchText(raw)
      if (!text) {
        continue
      }
      docs.push({
        id: this.buildAppSearchDocId(appId, candidate.relativePath),
        app_id: appId,
        file: candidate.relativePath,
        source: candidate.source,
        title: `${app.title || appId} ${path.basename(candidate.relativePath)}`,
        text
      })
    }
    return docs
  }

  async ensureSearchState(forceRefresh = false) {
    const now = Date.now()
    if (
      !forceRefresh &&
      this.state &&
      this.state.index &&
      now - this.state.updatedAt < APP_SEARCH_CACHE_TTL_MS
    ) {
      return this.state
    }

    const apps = await this.registry.listInfoApps()
    const previousPerApp = (this.state && this.state.perApp instanceof Map)
      ? this.state.perApp
      : new Map()
    const nextPerApp = new Map()
    const docs = []

    for (const app of apps) {
      const appRoot = this.kernel.path('api', app.name)
      const candidates = await this.collectAppSearchCandidates(appRoot)
      const fingerprint = this.computeAppSearchFingerprint(app, candidates)
      const previous = previousPerApp.get(app.name)
      let appDocs
      if (previous && previous.fingerprint === fingerprint && Array.isArray(previous.docs)) {
        appDocs = previous.docs
      } else {
        appDocs = await this.buildAppSearchDocs(app, candidates)
      }
      nextPerApp.set(app.name, {
        fingerprint,
        docs: appDocs
      })
      docs.push(...appDocs)
    }

    const index = new MiniSearch({
      idField: 'id',
      fields: ['title', 'file', 'text'],
      storeFields: ['id', 'app_id', 'file', 'source', 'text'],
      searchOptions: {
        boost: { title: 6, file: 2, text: 1 },
        prefix: true,
        fuzzy: 0.1
      }
    })
    if (docs.length > 0) {
      index.addAll(docs)
    }

    this.state = {
      updatedAt: now,
      index,
      docs,
      apps,
      appsById: new Map(apps.map((app) => [app.name, app])),
      perApp: nextPerApp
    }
    return this.state
  }

  extractSearchTerms(query = '') {
    const terms = String(query || '')
      .toLowerCase()
      .split(/[\s,;:(){}\[\]<>]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
    return Array.from(new Set(terms))
  }

  buildSearchSnippet(text = '', queryTerms = [], maxLength = 220) {
    const normalized = this.normalizeSearchText(text)
    if (!normalized) {
      return ''
    }
    if (!queryTerms || queryTerms.length === 0) {
      return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
    }
    const lower = normalized.toLowerCase()
    let index = -1
    for (const term of queryTerms) {
      const found = lower.indexOf(term.toLowerCase())
      if (found !== -1 && (index === -1 || found < index)) {
        index = found
      }
    }
    if (index === -1) {
      return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
    }
    const half = Math.floor(maxLength / 2)
    const start = Math.max(0, index - half)
    const end = Math.min(normalized.length, start + maxLength)
    const snippet = normalized.slice(start, end).trim()
    const prefix = start > 0 ? '...' : ''
    const suffix = end < normalized.length ? '...' : ''
    return `${prefix}${snippet}${suffix}`
  }

  decorateAppWithRuntime(app, extras = {}) {
    const appRoot = this.kernel.path('api', app.name)
    const runtime = this.registry.collectAppRuntime(appRoot)
    return {
      app_id: app.name,
      ...app,
      running: runtime.running,
      ready: runtime.ready,
      ready_url: runtime.ready_url,
      state: runtime.state,
      ...extras
    }
  }

  async searchApps(query = '') {
    const q = typeof query === 'string' ? query.trim() : ''
    const normalizedQuery = q.toLowerCase()
    if (!q) {
      const allApps = await this.registry.listInfoApps()
      const apps = allApps.map((app) => this.decorateAppWithRuntime(app))
      return { q: normalizedQuery, count: apps.length, apps }
    }
    try {
      const state = await this.ensureSearchState(false)
      const queryTerms = this.extractSearchTerms(q)
      let hits = state.index.search(q, {
        boost: { title: 6, file: 2, text: 1 },
        prefix: true,
        fuzzy: 0.1
      })
      if ((!hits || hits.length === 0) && queryTerms.length > 1) {
        hits = state.index.search(queryTerms.join(' '), {
          boost: { title: 6, file: 2, text: 1 },
          prefix: true,
          fuzzy: 0.2
        })
      }
      const grouped = new Map()
      for (const hit of (hits || []).slice(0, 300)) {
        const appId = hit && hit.app_id ? hit.app_id : null
        if (!appId) {
          continue
        }
        const app = state.appsById.get(appId)
        if (!app) {
          continue
        }
        let item = grouped.get(appId)
        if (!item) {
          item = {
            app,
            score: 0,
            matches: []
          }
          grouped.set(appId, item)
        }
        item.score += Number(hit.score || 0)
        if (item.matches.length < 3) {
          item.matches.push({
            file: hit.file || null,
            source: hit.source || null,
            snippet: this.buildSearchSnippet(hit.text || '', queryTerms)
          })
        }
      }
      const ranked = Array.from(grouped.values()).sort((a, b) => b.score - a.score)
      const apps = ranked.map((entry) => {
        return this.decorateAppWithRuntime(entry.app, {
          score: Number(entry.score.toFixed(4)),
          matches: entry.matches
        })
      })
      return { q: normalizedQuery, count: apps.length, apps }
    } catch (error) {
      console.warn('Indexed /apps/search failed; falling back to metadata search', error)
      const allApps = await this.registry.listInfoApps()
      const filteredApps = allApps.filter((app) => {
        const haystack = `${app.name || ''}\n${app.title || ''}\n${app.description || ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      })
      const apps = filteredApps.map((app) => this.decorateAppWithRuntime(app))
      return { q: normalizedQuery, count: apps.length, apps }
    }
  }
}

module.exports = AppSearchService
