const ParcelWatcher = require('@parcel/watcher')
const fs = require('fs')
const path = require('path')
const ignore = require('ignore')

class WorkspaceStatusManager {
  constructor(options = {}) {
    this.enableWatchers = options.enableWatchers !== false
    this.fallbackIntervalMs = typeof options.fallbackIntervalMs === 'number' ? options.fallbackIntervalMs : 60000
    this.cache = new Map()
    this.watchers = new Map()
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
    this.gitIgnoreEngines = new Map()
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

  async ensureGitIgnoreEngine(workspaceName, workspaceRoot) {
    if (!workspaceRoot) {
      return
    }
    if (this.gitIgnoreEngines.has(workspaceName)) {
      return
    }
    const ig = ignore()
    const gitignoreFiles = []

    const walk = async (dir) => {
      let entries
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch (error) {
        return
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'venv' || entry.name === '.venv') {
            continue
          }
          await walk(path.join(dir, entry.name))
        } else if (entry.isFile() && entry.name === '.gitignore') {
          gitignoreFiles.push(path.join(dir, entry.name))
        }
      }
    }

    try {
      await walk(workspaceRoot)
    } catch (error) {
      console.warn('workspace gitignore scan failed', workspaceName, error && error.message ? error.message : error)
    }

    for (const gitignorePath of gitignoreFiles) {
      let content
      try {
        content = await fs.promises.readFile(gitignorePath, 'utf8')
      } catch (_) {
        continue
      }
      const relDir = path.relative(workspaceRoot, path.dirname(gitignorePath))
      const prefix = relDir && relDir !== '.' ? relDir.split(path.sep).join('/') + '/' : ''
      const lines = content.split(/\r?\n/)
      for (let line of lines) {
        if (!line) continue
        line = line.trim()
        if (!line || line.startsWith('#')) continue
        let negated = false
        if (line.startsWith('!')) {
          negated = true
          line = line.slice(1)
        }
        if (!line) continue
        line = line.replace(/^\/+/, '')
        if (!line) continue
        const pattern = prefix + line
        if (!pattern) continue
        if (negated) {
          ig.add('!' + pattern)
        } else {
          ig.add(pattern)
        }
      }
    }

    this.gitIgnoreEngines.set(workspaceName, ig)
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
      await this.ensureGitIgnoreEngine(workspaceName, workspaceRoot)
      const subscription = await ParcelWatcher.subscribe(
        workspaceRoot,
        (error, events) => {
          if (error) {
            console.warn('workspace watcher error', workspaceName, error)
            return
          }
          if (!events || events.length === 0) {
            return
          }
          let relevantEvents = events
          const engine = this.gitIgnoreEngines.get(workspaceName)
          if (engine && workspaceRoot) {
            const root = workspaceRoot
            relevantEvents = events.filter((evt) => {
              if (!evt || !evt.path) {
                return true
              }
              let rel = path.relative(root, evt.path)
              if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
                return true
              }
              const normalized = rel.split(path.sep).join('/')
              return !engine.ignores(normalized)
            })
          }
          if (relevantEvents.length === 0) {
            return
          }
          this.markDirty(workspaceName)
          if (this.onEvent) {
            try {
              this.onEvent(workspaceName, relevantEvents)
            } catch (err) {
              console.warn('workspace watcher callback error', workspaceName, err && err.message ? err.message : err)
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

    if (this.enableWatchers && workspaceRoot) {
      await this.ensureWatcher(workspaceName, workspaceRoot)
    }

    if (!entry.dirty && entry.data) {
      return entry.data
    }

    if (entry.dirty && entry.data) {
      if (!entry.inflight) {
        entry.inflight = (async () => {
          try {
            const data = await computeStatusFn()
            entry.data = data
            entry.dirty = false
            entry.updatedAt = Date.now()
          } catch (error) {
            console.warn('workspace status background compute failed', workspaceName, error && error.message ? error.message : error)
          } finally {
            entry.inflight = null
          }
        })()
      }
      return entry.data
    }

    if (entry.inflight) {
      if (entry.data) {
        return entry.data
      }
      return entry.inflight
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
