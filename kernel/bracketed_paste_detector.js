const { spawn } = require('child_process')
const os = require('os')

const cache = new Map()

const OK_MARKER = '__PINOKIO_BP_OK__'
const NO_MARKER = '__PINOKIO_BP_NO__'

function normalizeKey(shell, platform) {
  return `${platform || os.platform()}::${(shell || '').toLowerCase()}`
}

function isWindowsShell(shell) {
  const name = (shell || '').toLowerCase()
  return name.includes('cmd.exe') || name === 'cmd' || name.includes('powershell') || name.includes('pwsh')
}

function isBash(shell) {
  return (shell || '').toLowerCase().includes('bash')
}

function isZsh(shell) {
  return (shell || '').toLowerCase().includes('zsh')
}

function runProbe(shell, args, script) {
  return new Promise((resolve) => {
    let stdout = ''
    const child = spawn(shell, [...args, script], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', () => resolve(null))
    child.on('close', () => resolve(stdout))
  })
}

async function detect(shell, platform = os.platform()) {
  const key = normalizeKey(shell, platform)
  if (cache.has(key)) {
    return cache.get(key)
  }

  let result
  try {
    result = await runDetection(shell, platform)
  } catch (_) {
    result = null
  }
  if (result === null) {
    result = true
  }
  cache.set(key, result)
  return result
}

async function runDetection(shell, platform) {
  if (!shell) {
    return true
  }
  if (isWindowsShell(shell)) {
    return false
  }

  if (isBash(shell)) {
    const script = `if bind -v 2>/dev/null | grep -q 'enable-bracketed-paste'; then bind 'set enable-bracketed-paste on' >/dev/null 2>&1; printf '${OK_MARKER}\n'; else printf '${NO_MARKER}\n'; fi`
    const output = await runProbe(shell, ['--noprofile', '--norc', '-ic'], script)
    return parseProbeOutput(output)
  }

  if (isZsh(shell)) {
    const script = `if setopt -q bracketed-paste 2>/dev/null; then printf '${OK_MARKER}\n'; exit 0; fi; if setopt bracketed-paste 2>/dev/null; then printf '${OK_MARKER}\n'; exit 0; fi; printf '${NO_MARKER}\n'`
    const output = await runProbe(shell, ['-f', '-c'], script)
    return parseProbeOutput(output)
  }

  // For other shells assume supported unless clearly Windows-only.
  return true
}

function parseProbeOutput(output) {
  if (typeof output !== 'string') {
    return null
  }
  if (output.includes(OK_MARKER)) {
    return true
  }
  if (output.includes(NO_MARKER)) {
    return false
  }
  return null
}

module.exports = {
  detect
}
