const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const BaseAdapter = require('./base')

const execFileAsync = promisify(execFile)

class WindowsAdapter extends BaseAdapter {
  constructor(kernel) {
    super(kernel)
    this.systemRoot = process.env.SystemRoot || 'C:\\Windows'
    this.powershellBinary = this.resolvePowerShell()
  }

  resolvePowerShell() {
    const explicit = process.env.POWERSHELL || process.env.POWERSHELL_EXE
    if (explicit) {
      return explicit
    }
    const candidate = path.join(this.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    } catch (_) {
    }
    return 'powershell.exe'
  }

  startMenuDirs() {
    const dirs = []
    const programData = process.env.ProgramData
    if (programData) {
      dirs.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    }
    const appData = process.env.APPDATA
    if (appData) {
      dirs.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    }
    return dirs
  }

  async buildIndex() {
    this.entries.clear()
    await this.collectShortcuts()
    await this.collectStartApps()
  }

  async collectShortcuts() {
    const dirs = this.startMenuDirs()
    for (const dir of dirs) {
      await this.walkShortcuts(dir)
    }
  }

  async walkShortcuts(root) {
    if (!root) {
      return
    }
    const stack = [root]
    const visited = new Set()
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) {
        continue
      }
      const normalized = path.resolve(current)
      if (visited.has(normalized)) {
        continue
      }
      visited.add(normalized)
      let entries
      try {
        entries = await fs.promises.readdir(normalized, { withFileTypes: true })
      } catch (_) {
        continue
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue
        }
        const fullPath = path.join(normalized, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
          const id = `shortcut:${fullPath.replace(/\\/g, '/')}`
          const name = path.basename(entry.name, '.lnk')
          this.addEntry({
            id,
            name,
            aliases: [name.replace(/ shortcut$/i, ''), fullPath],
            kind: 'windows-shortcut',
            path: fullPath,
            detail: path.relative(root, fullPath).replace(/\\/g, '/')
          })
        }
      }
    }
  }

  async collectStartApps() {
    let apps = []
    try {
      apps = await this.readStartApps()
    } catch (_) {
      apps = []
    }
    for (const app of apps) {
      if (!app || !app.Name || !app.AppId) {
        continue
      }
      const id = `appx:${app.AppId}`
      this.addEntry({
        id,
        name: app.Name,
        aliases: [app.AppId],
        kind: 'windows-appx',
        appId: app.AppId,
        detail: app.AppId
      })
    }
  }

  async readStartApps() {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$apps = Get-StartApps | Select-Object -Property Name, AppId
$apps | ConvertTo-Json -Depth 4 -Compress
`
    const { stdout } = await this.runPowerShell(script)
    if (!stdout) {
      return []
    }
    try {
      const parsed = JSON.parse(stdout)
      if (Array.isArray(parsed)) {
        return parsed
      }
      if (parsed) {
        return [parsed]
      }
      return []
    } catch (_) {
      return []
    }
  }

  quotePowerShell(value) {
    const str = String(value === undefined || value === null ? '' : value)
    return `'${str.replace(/'/g, "''")}'`
  }

  buildPowerShellArray(items) {
    if (!items || items.length === 0) {
      return '@()'
    }
    const encoded = items.map((item) => this.quotePowerShell(item))
    return `@(${encoded.join(',')})`
  }

  async runPowerShell(script) {
    const wrapped = `& {\n${script}\n}`
    try {
      return await execFileAsync(this.powershellBinary, [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        wrapped
      ], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
    } catch (error) {
      error.script = script
      throw error
    }
  }

  async launch(entry, params = {}) {
    const args = this.sanitizeArgs(params.args)
    if (entry.kind === 'windows-shortcut') {
      return this.launchShortcut(entry, args)
    }
    if (entry.kind === 'windows-appx') {
      if (args.length > 0) {
        throw new Error('Passing args to Windows Store applications is not supported')
      }
      return this.launchAppx(entry)
    }
    throw new Error(`Unsupported Windows app kind: ${entry.kind}`)
  }

  async launchShortcut(entry, args) {
    const argLiteral = this.buildPowerShellArray(args)
    const script = `
$path = ${this.quotePowerShell(entry.path)}
$extra = ${argLiteral}
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($path)
$target = $shortcut.TargetPath
if (-not $target) { throw 'Shortcut is missing a target' }
$argumentList = @()
if ($shortcut.Arguments) { $argumentList += $shortcut.Arguments }
if ($extra.Count -gt 0) { $argumentList += $extra }
$startInfo = @{ FilePath = $target }
if ($argumentList.Count -gt 0) { $startInfo.ArgumentList = $argumentList }
if ($shortcut.WorkingDirectory) { $startInfo.WorkingDirectory = $shortcut.WorkingDirectory }
Start-Process @startInfo | Out-Null
`
    await this.runPowerShell(script)
    return {
      success: true,
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      launcher: 'powershell-shortcut',
      detail: entry.path
    }
  }

  async launchAppx(entry) {
    const literal = this.quotePowerShell(`shell:AppsFolder\\${entry.appId}`)
    const script = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${literal} | Out-Null
`
    await this.runPowerShell(script)
    return {
      success: true,
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      launcher: 'powershell-appx',
      detail: entry.appId
    }
  }
}

module.exports = WindowsAdapter
