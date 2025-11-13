const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const BaseAdapter = require('./base')

const execFileAsync = promisify(execFile)
const OPEN_BINARY = '/usr/bin/open'
const DEFAULT_DIRECTORIES = [
  '/Applications',
  '/System/Applications',
  '/System/Applications/Utilities',
  '/System/Library/CoreServices/Applications',
  path.join(os.homedir(), 'Applications')
]

class MacOSAdapter extends BaseAdapter {
  constructor(kernel) {
    super(kernel)
    this.directories = DEFAULT_DIRECTORIES
    this.walkSeen = new Set()
  }

  async buildIndex() {
    this.entries.clear()
    this.walkSeen.clear()
    for (const dir of this.directories) {
      await this.walkApplications(dir)
    }
  }

  async walkApplications(root) {
    if (!root) {
      return
    }
    const normalized = path.resolve(root)
    if (this.walkSeen.has(normalized)) {
      return
    }
    this.walkSeen.add(normalized)
    let entries
    try {
      entries = await fs.promises.readdir(normalized, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      const fullPath = path.join(normalized, entry.name)
      if (entry.name.toLowerCase().endsWith('.app')) {
        await this.addBundle(fullPath)
        continue
      }
      if (entry.isDirectory()) {
        await this.walkApplications(fullPath)
      }
    }
  }

  async addBundle(bundlePath) {
    const infoPath = path.join(bundlePath, 'Contents', 'Info.plist')
    let info = null
    try {
      info = await this.readPlist(infoPath)
    } catch (_) {
    }
    const baseName = path.basename(bundlePath, '.app')
    const displayName = (info && (info.CFBundleDisplayName || info.CFBundleName)) || baseName
    const bundleId = info && info.CFBundleIdentifier ? info.CFBundleIdentifier : null
    const execName = info && info.CFBundleExecutable ? info.CFBundleExecutable : null
    const execPath = execName ? path.join(bundlePath, 'Contents', 'MacOS', execName) : null
    let id = bundleId || `bundle-path:${bundlePath}`
    if (this.entries.has(id)) {
      let suffix = 1
      while (this.entries.has(`${id}#${suffix}`)) {
        suffix += 1
      }
      id = `${id}#${suffix}`
    }
    const aliases = [baseName]
    if (bundleId) {
      aliases.push(bundleId)
    }
    if (execName) {
      aliases.push(execName)
    }
    this.addEntry({
      id,
      name: displayName,
      aliases,
      kind: 'macos-bundle',
      bundleId,
      path: bundlePath,
      execPath,
      detail: bundleId || bundlePath
    })
  }

  async readPlist(plistPath) {
    try {
      const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', plistPath], {
        maxBuffer: 2 * 1024 * 1024
      })
      if (!stdout) {
        return null
      }
      return JSON.parse(stdout)
    } catch (_) {
      return null
    }
  }

  async launch(entry, params = {}) {
    const args = this.sanitizeArgs(params.args)
    const openArgs = []
    if (entry.bundleId) {
      openArgs.push('-b', entry.bundleId)
    } else if (entry.path) {
      openArgs.push('-a', entry.path)
    } else if (entry.name) {
      openArgs.push('-a', entry.name)
    }
    if (args.length > 0) {
      openArgs.push('--args', ...args)
    }
    const result = await this.spawnDetached(OPEN_BINARY, openArgs)
    return {
      success: true,
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      launcher: 'macos-open',
      pid: result.pid || null,
      detail: entry.bundleId || entry.path || entry.name
    }
  }

  async launchUnknown(params = {}) {
    if (!params.app) {
      return super.launchUnknown(params)
    }
    const args = this.sanitizeArgs(params.args)
    const openArgs = ['-a', params.app]
    if (args.length > 0) {
      openArgs.push('--args', ...args)
    }
    const result = await this.spawnDetached(OPEN_BINARY, openArgs)
    return {
      success: true,
      id: null,
      name: params.app,
      kind: 'macos-bundle',
      launcher: 'macos-open',
      pid: result.pid || null,
      detail: params.app
    }
  }
}

module.exports = MacOSAdapter
