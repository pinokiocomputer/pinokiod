const axios = require('axios')
const { URL } = require('url')
const { JSDOM } = require('jsdom')

class Favicon {
  constructor(opts = {}) {
    this.cache = new Map() // origin -> { url: string|null, ts: number }
    this.ttlMs = opts.ttlMs || (10 * 60 * 1000) // 10 minutes
    this.headTimeoutMs = opts.headTimeoutMs || 800
    this.getTimeoutMs = opts.getTimeoutMs || 700
    this.totalBudgetMs = opts.totalBudgetMs || 900
    this.commonPaths = Array.isArray(opts.commonPaths) && opts.commonPaths.length > 0
      ? opts.commonPaths
      : ['/favicon.ico', '/favicon.png']
  }

  _now() {
    return Date.now()
  }

  _getCache(origin) {
    const entry = this.cache.get(origin)
    if (!entry) return null
    if (this._now() - entry.ts > this.ttlMs) {
      this.cache.delete(origin)
      return null
    }
    return entry.url
  }

  _setCache(origin, url) {
    this.cache.set(origin, { url: url || null, ts: this._now() })
  }

  async get(pageUrl) {
    let origin
    try {
      origin = new URL(pageUrl).origin
    } catch {
      throw new Error('Invalid URL: ' + pageUrl)
    }

    const cached = this._getCache(origin)
    if (typeof cached !== 'undefined' && cached !== null) {
      return cached
    } else if (cached === null) {
      // we cached a miss previously
      return null
    }

    const start = this._now()
    const withinBudget = () => (this._now() - start) < this.totalBudgetMs

    // 1) Try common paths (limited set) in parallel, with short HEAD timeouts
    try {
      const attempts = this.commonPaths.map((p) => this.checkImageUrl(origin + p, this.headTimeoutMs))
      const results = await Promise.all(attempts)
      for (let i = 0; i < results.length; i++) {
        if (results[i]) {
          const url = origin + this.commonPaths[i]
          this._setCache(origin, url)
          return url
        }
      }
    } catch (_) {}

    if (!withinBudget()) {
      this._setCache(origin, null)
      return null
    }

    // 2) Fallback: fetch the page quickly, parse <link rel="icon">, then HEAD the first 1-2 candidates
    try {
      const res = await axios.get(pageUrl, { timeout: this.getTimeoutMs })
      const dom = new JSDOM(res.data)
      const nodes = Array.from(dom.window.document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']"))
      const hrefs = []
      for (const node of nodes) {
        const href = node.getAttribute('href')
        if (href && typeof href === 'string') {
          try {
            const resolved = new URL(href, origin).href
            hrefs.push(resolved)
          } catch (_) {}
        }
      }
      // Try at most 2 parsed icons within budget
      for (let i = 0; i < Math.min(2, hrefs.length); i++) {
        if (!withinBudget()) break
        const ok = await this.checkImageUrl(hrefs[i], this.headTimeoutMs)
        if (ok) {
          this._setCache(origin, hrefs[i])
          return hrefs[i]
        }
      }
    } catch (_) {
      // ignore parse failures
    }

    this._setCache(origin, null)
    return null
  }

  async checkImageUrl(url, timeoutOverride) {
    try {
      const res = await axios.head(url, { timeout: timeoutOverride || this.headTimeoutMs })
      return res.status === 200 && (res.headers['content-type'] || '').startsWith('image/')
    } catch {
      return false
    }
  }
}
module.exports = Favicon
