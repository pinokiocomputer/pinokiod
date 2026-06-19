const axios = require('axios')
const Environment = require('../environment')
const Common = require('./common')

class PinokioDomainRouter {
  constructor(kernel) {
    this.kernel = kernel
    this.common = new Common(this)
    this.domainSuffix = ''
    this.custom_routers = {}
    this.resetState()
    this.old_config = null
    this.info = {}
    this.active = false
  }

  resetState() {
    this._mapping = {}
    this.mapping = {}
    this.rewrite_mapping = {}
    this.port_mapping = {}
    this.local_network_mapping = {}
    this.port_cache = {}
  }

  async init() {
    this.resetState()
    await this.loadDomainSuffix()
    this.setupBaseConfig()
  }

  async loadDomainSuffix() {
    const envDomain = (process.env.PINOKIO_DOMAIN || '').trim()
    if (envDomain) {
      this.domainSuffix = envDomain.toLowerCase()
    } else {
      const env = await Environment.get(this.kernel.homedir, this.kernel)
      this.domainSuffix = (env.PINOKIO_DOMAIN || '').trim().toLowerCase()
    }
    this.active = this.domainSuffix.length > 0
  }

  setupBaseConfig() {
    this.config = {
      apps: {
        http: {
          servers: {
            main: {
              listen: [':8080'],
              automatic_https: {
                disable: true
              },
              routes: [
                {
                  match: [{ method: ['OPTIONS'] }],
                  handle: [
                    {
                      handler: 'headers',
                      response: {
                        set: {
                          'Access-Control-Allow-Origin': ['*'],
                          'Access-Control-Allow-Methods': ['GET, POST, OPTIONS, PUT, DELETE'],
                          'Access-Control-Allow-Headers': ['*'],
                          Vary: ['Origin']
                        }
                      }
                    },
                    {
                      handler: 'static_response',
                      status_code: 204
                    }
                  ]
                }
              ]
            }
          }
        }
      },
      logging: {
        logs: {
          default: {
            writer: {
              output: 'file',
              filename: this.kernel.path('logs/caddy.log'),
              roll: true,
              roll_size_mb: 1,
              roll_keep: 1,
              roll_keep_days: 1,
              roll_gzip: false,
              roll_local_time: true
            },
            level: 'INFO'
          }
        }
      }
    }
  }

  normalizeLabel(value) {
    if (!value || typeof value !== 'string') {
      return ''
    }
    return value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  domainFor(apiName) {
    if (!this.active) {
      return null
    }
    const label = this.normalizeLabel(apiName)
    if (!label) {
      return null
    }
    return `${label}-${this.domainSuffix}`
  }

  extractPrimaryUrl(local) {
    if (!local || typeof local !== 'object') {
      return null
    }
    const preferredKeys = ['url', 'public_url', 'local_url']
    for (const key of preferredKeys) {
      const val = local[key]
      if (typeof val === 'string' && this.isHttp(val)) {
        return val
      }
    }

    const queue = [local]
    const visited = new Set()
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || typeof current !== 'object') {
        continue
      }
      if (visited.has(current)) {
        continue
      }
      visited.add(current)
      const iterable = Array.isArray(current) ? current : Object.values(current)
      for (const val of iterable) {
        if (typeof val === 'string' && this.isHttp(val)) {
          return val
        }
        if (val && typeof val === 'object') {
          queue.push(val)
        }
      }
    }
    return null
  }

  isHttp(value) {
    return /^https?:\/\//i.test(value)
  }

  firstUrl(entries) {
    if (!Array.isArray(entries)) {
      return null
    }
    for (const entry of entries) {
      const local = entry && entry.local
      const url = this.extractPrimaryUrl(local)
      if (url) {
        return url
      }
    }
    return null
  }

  attachRoute({ domain, url }) {
    if (!domain || !url) {
      return
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch (error) {
      return
    }

    const isHttps = /^https:/i.test(parsed.protocol || '')
    const port = parsed.port || (isHttps ? '443' : '80')
    let hostname = parsed.hostname || ''
    if (!hostname) {
      return
    }

    if (hostname.includes(':') && !hostname.startsWith('[')) {
      hostname = `[${hostname}]`
    }

    const dial = `${hostname}:${port}`
    const match = domain.toLowerCase()
    this.common.handle({
      match,
      dial,
      host: this.kernel.peer.host
    })
  }

  async local() {
    if (!this.active) {
      this.mapping = {}
      this.info = {}
      return
    }

    this.setupBaseConfig()

    const baseDomain = this.domainSuffix ? this.domainSuffix.toLowerCase() : ''
    if (baseDomain) {
      this.common.handle({
        match: baseDomain,
        dial: '127.0.0.1:42000',
        host: this.kernel.peer.host
      })
    }

    const scriptsByApi = this.kernel.info && typeof this.kernel.info.scriptsByApi === 'function'
      ? this.kernel.info.scriptsByApi()
      : {}

    const usedDomains = new Set()
    for (const [apiName, entries] of Object.entries(scriptsByApi)) {
      const domain = this.domainFor(apiName)
      if (!domain || usedDomains.has(domain)) {
        continue
      }
      const url = this.firstUrl(entries)
      if (!url) {
        continue
      }
      this.attachRoute({ domain, url })
      usedDomains.add(domain)
    }

    this.mapping = this._mapping
    this.info = this._info()
  }

  async remote() {
    // no-op for custom domain router
  }

  async static() {
    // no-op for custom domain router
  }

  async custom_domain() {
    // no-op for custom domain router
  }

  fallback() {
    // no default fallback required for custom domain router
  }

  add({ host, dial, match }) {
    if (!this._mapping[host]) {
      this._mapping[host] = {}
    }
    if (!this._mapping[host][dial]) {
      this._mapping[host][dial] = new Set()
    }
    if (Array.isArray(match)) {
      for (const m of match) {
        this._mapping[host][dial].add(m)
      }
    } else {
      this._mapping[host][dial].add(match)
    }
  }

  _info() {
    const mapping = {}
    for (const host in this.mapping) {
      const internal = this.mapping[host]
      if (!mapping[host]) {
        mapping[host] = {}
      }
      for (const url in internal) {
        mapping[host][url] = Array.from(internal[url])
      }
    }
    return mapping
  }

  published() {
    const pub = {}
    if (this.info) {
      const routes = this.info[this.kernel.peer.host]
      if (routes) {
        for (const dial in routes) {
          pub[dial] = routes[dial]
        }
      }
    }
    return pub
  }

  async update() {
    if (JSON.stringify(this.config) === JSON.stringify(this.old_config)) {
      return
    }
    console.log('[router] detected config changes, posting update to caddy (custom domain router)')
    try {
      console.log('Try loading caddy config [custom domain]')
      await axios.post('http://127.0.0.1:2019/load', this.config, {
        headers: { 'Content-Type': 'application/json' }
      })
      this.old_config = this.config
    } catch (error) {
      console.log('Caddy Request Failed [custom domain]', error)
    }
  }

  async check() {
    try {
      const res = await axios.get('http://localhost:2019/config/', {
        timeout: 2000
      })
      return res.data
    } catch (error) {
      return null
    }
  }
}

module.exports = PinokioDomainRouter
