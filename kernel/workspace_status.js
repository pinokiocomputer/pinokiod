const ParcelWatcher = require('@parcel/watcher')

class WorkspaceStatusManager {
  constructor(options = {}) {
    this.enableWatchers = options.enableWatchers !== false
    this.fallbackIntervalMs = typeof options.fallbackIntervalMs === 'number' ? options.fallbackIntervalMs : 60000
    this.cache = new Map()
    this.watchers = new Map()
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
    this.defaultIgnores = options.ignores && Array.isArray(options.ignores) ? options.ignores : [
      '**/.git/**',
      '**/node_modules/**',
      '**/.venv/**',
      '**/venv/**',
      '**/env/**',
      '**/__pycache__/**',
      '**/site-packages/**',
      '**/dist/**',
      '**/build/**',
      '**/.cache/**',
      '**/logs/**',
      '**/*.log',
      '**/tmp/**',
      '**/temp/**',
      '**/.parcel-cache/**',
      '**/.webpack/**',
    ]
  }

  markDirty(workspaceName) {
    let entry = this.cache.get(workspaceName)
    if (!entry) {
      entry = { dirty: true, inflight: null, data: null, updatedAt: 0 }
    } else {
      entry.dirty = true
    }
    this.cache.set(workspaceName, entry)
  }

  async ensureWatcher(workspaceName, workspaceRoot) {
    if (!this.enableWatchers) {
      return
    }
    if (this.watchers.has(workspaceName)) {
      return
    }
    try {
      const subscription = await ParcelWatcher.subscribe(
        workspaceRoot,
        (error, events) => {
          if (error) {
            console.warn('workspace watcher error', workspaceName, error)
            return
          }
          if (events && events.length > 0) {
            console.log("Events", events)
            this.markDirty(workspaceName)
            if (this.onEvent) {
              try {
                this.onEvent(workspaceName, events)
              } catch (err) {
                console.warn('workspace watcher callback error', workspaceName, err && err.message ? err.message : err)
              }
            }
          }
        },
        { ignore: this.defaultIgnores }
      )
      this.watchers.set(workspaceName, subscription)
      this.markDirty(workspaceName)
    } catch (error) {
      console.warn('workspace watcher unavailable, falling back to polling', workspaceName, error)
      this.enableWatchers = false
      this.watchers.clear()
    }
  }

  async getStatus(workspaceName, computeStatusFn, workspaceRoot) {
    let entry = this.cache.get(workspaceName)
    if (!entry) {
      entry = { dirty: true, inflight: null, data: null, updatedAt: 0 }
      this.cache.set(workspaceName, entry)
    }
    const now = Date.now()
    if (entry.updatedAt && (now - entry.updatedAt) > this.fallbackIntervalMs) {
      entry.dirty = true
    }
    if (!this.enableWatchers) {
      entry.dirty = true
    }

    if (!entry.dirty && entry.data) {
      return entry.data
    }
    if (entry.inflight) {
      return entry.inflight
    }

    if (this.enableWatchers && workspaceRoot) {
      await this.ensureWatcher(workspaceName, workspaceRoot)
    }

    entry.inflight = (async () => {
      const data = await computeStatusFn()
      entry.data = data
      entry.dirty = false
      entry.updatedAt = Date.now()
      entry.inflight = null
      return data
    })().catch((error) => {
      entry.inflight = null
      throw error
    })

    return entry.inflight
  }
}

module.exports = WorkspaceStatusManager
