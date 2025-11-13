const fs = require('fs')
const path = require('path')
const os = require('os')
const BaseAdapter = require('./base')

const DESKTOP_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/snapd/desktop/applications',
  path.join(os.homedir(), '.local/share/applications')
]

class LinuxAdapter extends BaseAdapter {
  constructor(kernel) {
    super(kernel)
    this.desktopDirs = DESKTOP_DIRS
  }

  async buildIndex() {
    this.entries.clear()
    for (const dir of this.desktopDirs) {
      await this.collectDesktopFiles(dir)
    }
  }

  async collectDesktopFiles(root) {
    if (!root) {
      return
    }
    let entries
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name)
      if (entry.isDirectory()) {
        await this.collectDesktopFiles(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.desktop')) {
        continue
      }
      await this.addDesktopEntry(fullPath)
    }
  }

  async addDesktopEntry(filePath) {
    let content
    try {
      content = await fs.promises.readFile(filePath, 'utf8')
    } catch (_) {
      return
    }
    const data = this.parseDesktopFile(content)
    const name = this.resolveLocalizedValue(data, 'Name')
    const execLine = data.Exec
    if (!name || !execLine) {
      return
    }
    if (String(data.NoDisplay || '').toLowerCase() === 'true') {
      return
    }
    const desktopId = path.basename(filePath, '.desktop')
    let id = `desktop:${desktopId}`
    if (this.entries.has(id)) {
      let suffix = 1
      while (this.entries.has(`${id}#${suffix}`)) {
        suffix += 1
      }
      id = `${id}#${suffix}`
    }
    const aliases = [desktopId]
    const generic = this.resolveLocalizedValue(data, 'GenericName')
    if (generic) {
      aliases.push(generic)
    }
    this.addEntry({
      id,
      name,
      aliases,
      kind: 'linux-desktop',
      desktopId,
      execLine,
      path: filePath,
      detail: filePath,
      terminal: String(data.Terminal || '').toLowerCase() === 'true',
      workingDirectory: data.Path || null
    })
  }

  parseDesktopFile(content) {
    const data = {}
    const lines = content.split(/\r?\n/)
    let inEntry = false
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }
      if (line.startsWith('[')) {
        inEntry = line === '[Desktop Entry]'
        continue
      }
      if (!inEntry) {
        continue
      }
      const idx = line.indexOf('=')
      if (idx === -1) {
        continue
      }
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (!(key in data)) {
        data[key] = value
      }
    }
    return data
  }

  resolveLocalizedValue(data, key) {
    if (!data) {
      return null
    }
    if (data[key]) {
      return data[key]
    }
    const lang = process.env.LANG ? process.env.LANG.split('.')[0] : ''
    if (lang) {
      if (data[`${key}[${lang}]`]) {
        return data[`${key}[${lang}]`]
      }
      const short = lang.split('_')[0]
      if (short && data[`${key}[${short}]`]) {
        return data[`${key}[${short}]`]
      }
    }
    const localizedKey = Object.keys(data).find((k) => k.startsWith(`${key}[`))
    if (localizedKey) {
      return data[localizedKey]
    }
    return null
  }

  tokenizeExec(execLine) {
    const tokens = []
    let current = ''
    let quote = null
    let escape = false
    for (const ch of execLine) {
      if (escape) {
        current += ch
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"' || ch === '\'') {
        if (quote === ch) {
          quote = null
        } else if (!quote) {
          quote = ch
        } else {
          current += ch
        }
        continue
      }
      if (!quote && /\s/.test(ch)) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        continue
      }
      current += ch
    }
    if (current) {
      tokens.push(current)
    }
    return tokens
  }

  buildExecCommand(execLine, extraArgs) {
    const tokens = this.tokenizeExec(execLine)
    const cleaned = []
    for (const token of tokens) {
      if (!token) {
        continue
      }
      let replaced = token.replace(/%%/g, '%')
      replaced = replaced.replace(/%[fFuUdDnNickvm]/g, '')
      if (!replaced) {
        continue
      }
      cleaned.push(replaced)
    }
    const args = Array.isArray(extraArgs) ? extraArgs : []
    return cleaned.concat(args)
  }

  async launch(entry, params = {}) {
    const args = this.sanitizeArgs(params.args)
    const commandParts = this.buildExecCommand(entry.execLine, args)
    if (!commandParts.length) {
      throw new Error(`Unable to determine launch command for ${entry.name}`)
    }
    let command = commandParts[0]
    let finalArgs = commandParts.slice(1)
    const options = {}
    if (entry.workingDirectory) {
      options.cwd = entry.workingDirectory
    }
    const result = await this.spawnDetached(command, finalArgs, options)
    return {
      success: true,
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      launcher: 'exec',
      pid: result.pid || null,
      detail: entry.execLine
    }
  }
}

module.exports = LinuxAdapter
