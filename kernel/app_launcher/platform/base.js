const { spawn } = require('child_process')
const os = require('os')

class BasePlatformAdapter {
  constructor(kernel) {
    this.kernel = kernel
    this.platform = os.platform()
    this.entries = new Map()
    this.indexTimestamp = 0
    this.indexTTL = 1000 * 60 * 5
    this.indexPromise = null
  }

  async ensureIndex(options = {}) {
    const force = Boolean(options.force)
    const now = Date.now()
    const expired = !this.indexTimestamp || (now - this.indexTimestamp > this.indexTTL)
    if (!force && this.entries.size > 0 && !expired) {
      return
    }
    if (this.indexPromise) {
      return this.indexPromise
    }
    this.indexPromise = (async () => {
      try {
        await this.buildIndex()
        this.indexTimestamp = Date.now()
      } finally {
        this.indexPromise = null
      }
    })()
    return this.indexPromise
  }

  // subclasses must override
  async buildIndex() {
    throw new Error('buildIndex() not implemented')
  }

  listEntries() {
    return Array.from(this.entries.values())
  }

  getEntry(id) {
    if (!id) {
      return null
    }
    return this.entries.get(id)
  }

  addEntry(entry) {
    if (!entry || !entry.id) {
      return
    }
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : []
    const uniqueAliases = Array.from(new Set([entry.name, ...aliases].filter(Boolean)))
    entry.aliases = uniqueAliases
    entry.platform = entry.platform || this.platform
    this.entries.set(entry.id, entry)
  }

  normalize(text) {
    return (text || '').trim().toLowerCase()
  }

  scoreEntry(query, entry) {
    if (!query) {
      return 0
    }
    const candidates = new Set()
    if (entry.name) {
      candidates.add(entry.name)
    }
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        candidates.add(alias)
      }
    }
    if (entry.id) {
      candidates.add(entry.id)
    }
    if (entry.detail) {
      candidates.add(entry.detail)
    }
    if (entry.bundleId) {
      candidates.add(entry.bundleId)
    }
    if (entry.desktopId) {
      candidates.add(entry.desktopId)
    }
    let best = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const normalized = this.normalize(candidate)
      if (!normalized) {
        continue
      }
      if (normalized === query) {
        return 0
      }
      if (normalized.startsWith(query)) {
        best = Math.min(best, 1)
      } else if (normalized.includes(query)) {
        best = Math.min(best, 2)
      }
    }
    if (best < Number.POSITIVE_INFINITY) {
      return best
    }
    return best
  }

  formatEntry(entry) {
    if (!entry) {
      return null
    }
    const payload = {
      id: entry.id,
      name: entry.name,
      platform: entry.platform || this.platform,
      kind: entry.kind || 'app'
    }
    if (entry.aliases && entry.aliases.length > 0) {
      payload.aliases = entry.aliases
    }
    if (entry.detail) {
      payload.detail = entry.detail
    }
    const meta = {}
    if (entry.bundleId) {
      meta.bundleId = entry.bundleId
    }
    if (entry.desktopId) {
      meta.desktopId = entry.desktopId
    }
    if (entry.appId) {
      meta.appId = entry.appId
    }
    if (entry.path) {
      meta.path = entry.path
    }
    if (entry.execPath) {
      meta.execPath = entry.execPath
    }
    if (Object.keys(meta).length > 0) {
      payload.meta = meta
    }
    return payload
  }

  sanitizeArgs(args) {
    if (!args) {
      return []
    }
    if (!Array.isArray(args)) {
      return [String(args)]
    }
    return args
      .filter((arg) => typeof arg !== 'undefined' && arg !== null)
      .map((arg) => String(arg))
  }

  async search(options = {}) {
    const { query = '', limit = 20, refresh = false } = options
    await this.ensureIndex({ force: refresh })
    const normalized = this.normalize(query)
    let entries = this.listEntries()
    if (!normalized) {
      entries = entries.sort((a, b) => a.name.localeCompare(b.name))
      return entries.slice(0, limit).map((entry) => this.formatEntry(entry))
    }
    const scored = []
    for (const entry of entries) {
      const score = this.scoreEntry(normalized, entry)
      if (!Number.isFinite(score)) {
        continue
      }
      if (score === Number.POSITIVE_INFINITY) {
        continue
      }
      scored.push({ entry, score })
    }
    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score
      }
      return a.entry.name.localeCompare(b.entry.name)
    })
    return scored.slice(0, limit).map((item) => this.formatEntry(item.entry))
  }

  async findMatch(name, options = {}) {
    const normalized = this.normalize(name)
    if (!normalized) {
      return null
    }
    await this.ensureIndex({ force: options.force })
    let best = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const entry of this.entries.values()) {
      const score = this.scoreEntry(normalized, entry)
      if (score < bestScore) {
        best = entry
        bestScore = score
        if (score === 0) {
          break
        }
      }
    }
    if (!best) {
      return null
    }
    return { entry: best, score: bestScore }
  }

  async info(id, options = {}) {
    await this.ensureIndex({ force: options.force })
    const entry = this.getEntry(id)
    return this.formatEntry(entry)
  }

  async refresh() {
    await this.ensureIndex({ force: true })
    return {
      entries: this.entries.size,
      platform: this.platform,
      updatedAt: this.indexTimestamp
    }
  }

  async launch() {
    throw new Error('launch() not implemented')
  }

  async launchUnknown(params = {}) {
    if (!params.app) {
      throw new Error('Application not found')
    }
    throw new Error(`Application "${params.app}" was not found in the app index`)
  }

  spawnDetached(command, args, options = {}) {
    const spawnOptions = Object.assign({
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }, options || {})
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(command, args, spawnOptions)
      } catch (error) {
        error.command = command
        error.args = args
        return reject(error)
      }
      let resolved = false
      child.once('error', (err) => {
        if (!resolved) {
          err.command = command
          err.args = args
          reject(err)
        }
      })
      child.once('spawn', () => {
        resolved = true
        try {
          child.unref()
        } catch (_) {
        }
        resolve({ pid: child.pid, command, args })
      })
    })
  }
}

module.exports = BasePlatformAdapter
