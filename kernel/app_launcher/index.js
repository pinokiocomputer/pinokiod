const os = require('os')

const PLATFORM_MODULE = {
  darwin: './platform/macos',
  win32: './platform/windows',
  linux: './platform/linux'
}

class AppLauncher {
  constructor(kernel) {
    this.kernel = kernel
    this.platform = os.platform()
    this.adapter = null
  }

  async init() {
    try {
      const adapter = await this.ensureAdapter()
      if (adapter && adapter.ensureIndex) {
        await adapter.ensureIndex({ force: false })
      }
    } catch (error) {
      console.warn('[AppLauncher] init failed:', error.message)
    }
  }

  resolveAdapterModule() {
    return PLATFORM_MODULE[this.platform] || './platform/unsupported'
  }

  async ensureAdapter() {
    if (this.adapter) {
      return this.adapter
    }
    const modulePath = this.resolveAdapterModule()
    const Adapter = require(modulePath)
    this.adapter = new Adapter(this.kernel)
    return this.adapter
  }

  async search(params = {}) {
    const adapter = await this.ensureAdapter()
    return adapter.search(params)
  }

  async info(params = {}) {
    if (!params || !params.id) {
      throw new Error('app.info requires params.id')
    }
    const adapter = await this.ensureAdapter()
    return adapter.info(params.id, { force: params.refresh })
  }

  async findMatch(query, options = {}) {
    if (!query) {
      return null
    }
    const adapter = await this.ensureAdapter()
    return adapter.findMatch(query, options)
  }

  async refresh(params = {}) {
    const adapter = await this.ensureAdapter()
    return adapter.refresh(params)
  }

  async launch(params = {}) {
    if (!params || (!params.id && !params.app)) {
      throw new Error('app.launch requires params.app or params.id')
    }
    const adapter = await this.ensureAdapter()
    if (params.refresh) {
      await adapter.ensureIndex({ force: true })
    } else {
      await adapter.ensureIndex({ force: false })
    }
    let entry = null
    let confidence = null
    if (params.id) {
      entry = adapter.getEntry(params.id)
    }
    if (!entry && params.app) {
      const match = await adapter.findMatch(params.app, { force: false })
      if (match) {
        entry = match.entry
        confidence = match.score
      }
    }
    if (!entry) {
      if (!params.install && adapter && typeof adapter.launchUnknown === 'function') {
        return adapter.launchUnknown(params)
      }
      const error = new Error(params.app ? `Application "${params.app}" was not found` : 'Application not found')
      error.code = 'APP_NOT_FOUND'
      error.app = params.app || params.id
      throw error
    }
    const result = await adapter.launch(entry, params)
    if (result && typeof result === 'object') {
      const response = Object.assign({}, result)
      response.id = response.id || entry.id
      response.name = response.name || entry.name
      response.platform = response.platform || entry.platform || this.platform
      response.kind = response.kind || entry.kind
      response.detail = response.detail || entry.detail
      if (confidence !== null && typeof confidence !== 'undefined') {
        response.confidence = confidence
      }
      return response
    }
    return result
  }
}

module.exports = AppLauncher
