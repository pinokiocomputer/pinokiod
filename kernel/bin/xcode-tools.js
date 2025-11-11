const fs = require('fs')
const path = require('path')

const MIN_XCODESELECT_VERSION = 2349
const REQUIRED_BINARIES = [
  ["usr", "bin", "clang"],
  ["usr", "bin", "git"]
]
const CLT_PACKAGE_IDS = [
  "com.apple.pkg.CLTools_Executables",
  "com.apple.pkg.DeveloperToolsCLI"
]

async function detectCommandLineTools({ exec }) {
  if (typeof exec !== 'function') {
    throw new Error('detectCommandLineTools requires an exec function')
  }

  const run = (message) => exec({ message, conda: { skip: true } })

  const status = { valid: false }
  let pathResult

  try {
    pathResult = await run('xcode-select -p')
  } catch (err) {
    status.reason = 'xcode-select -p failed'
    return status
  }

  const developerPath = extractDeveloperPath(pathResult && pathResult.stdout)
  if (!developerPath) {
    status.rawPathOutput = pathResult ? pathResult.stdout : ''
    status.reason = 'unable to parse developer path from xcode-select output'
    return status
  }
  status.path = developerPath

  try {
    const stat = await fs.promises.stat(developerPath)
    if (!stat.isDirectory()) {
      status.reason = `${developerPath} is not a directory`
      return status
    }
  } catch (err) {
    status.reason = `developer path ${developerPath} is not accessible`
    return status
  }

  try {
    for (const rel of REQUIRED_BINARIES) {
      const binaryPath = path.join(developerPath, ...rel)
      await fs.promises.access(binaryPath, fs.constants.X_OK)
    }
  } catch (err) {
    status.reason = 'required developer binaries are missing'
    return status
  }

  const pkgInfo = await readCommandLineToolsPkgVersion(run)
  if (!pkgInfo) {
    status.reason = 'unable to read command line tools package info'
    return status
  }
  status.pkgVersion = pkgInfo.version

  const selectInfo = await readXcodeSelectVersion(run)
  status.xcodeSelectVersion = selectInfo.version
  if (!selectInfo.valid) {
    status.reason = selectInfo.reason || 'xcode-select version below minimum'
    return status
  }

  status.valid = true
  return status
}

async function readCommandLineToolsPkgVersion(exec) {
  for (const pkgId of CLT_PACKAGE_IDS) {
    try {
      const result = await exec(`pkgutil --pkg-info=${pkgId}`)
      if (result && result.stdout) {
        const match = /version:\s*([^\n]+)/i.exec(result.stdout)
        if (match) {
          return { pkgId, version: match[1].trim() }
        }
      }
    } catch (err) {
      // pkg not installed, try next id
    }
  }
  return null
}

async function readXcodeSelectVersion(exec) {
  let result
  try {
    result = await exec('xcode-select --version')
  } catch (err) {
    return { valid: false, reason: 'xcode-select --version failed' }
  }

  const match = result && result.stdout && /xcode-select version\s+(\d+)/i.exec(result.stdout)
  if (!match) {
    return { valid: false, reason: 'unable to parse xcode-select version' }
  }

  const numericVersion = Number(match[1])
  return {
    valid: numericVersion >= MIN_XCODESELECT_VERSION,
    version: numericVersion
  }
}

module.exports = {
  detectCommandLineTools,
  MIN_XCODESELECT_VERSION
}

function extractDeveloperPath(stdout) {
  if (!stdout) {
    return null
  }

  const lines = stdout.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    if (line.startsWith('/')) {
      return line
    }
  }
  return null
}
