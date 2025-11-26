const fs = require('fs')
const semver = require('semver')

const MIN_CLT_VERSION = '13.0'
const PREFERRED_PKG_IDS = [
  'com.apple.pkg.CLTools_Executables',
  'com.apple.pkg.DeveloperToolsCLI',
  'com.apple.pkg.Xcode'
]
const PACKAGE_MATCHERS = [
  /^com\.apple\.pkg\.CLTools_/, 
  /^com\.apple\.pkg\.DeveloperToolsCLI$/, 
  /^com\.apple\.pkg\.Xcode$/
]

async function detectCommandLineTools({ exec }) {
  if (typeof exec !== 'function') {
    throw new Error('detectCommandLineTools requires an exec function')
  }

  const run = (message) => exec({ message, conda: { skip: true } })

  let selectResult
  try {
    selectResult = await run('xcode-select -p')
  } catch (err) {
    console.log('[CLT] xcode-select -p failed', err)
    return { valid: false, reason: 'xcode-select -p failed' }
  }

  const developerPath = (selectResult && selectResult.stdout ? selectResult.stdout : '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('/'))
  if (!developerPath) {
    return {
      valid: false,
      reason: 'unable to parse developer path from xcode-select output',
      rawPathOutput: selectResult ? selectResult.stdout : ''
    }
  }
  console.log('[CLT] developer path:', developerPath)

  try {
    const stat = await fs.promises.stat(developerPath)
    if (!stat.isDirectory()) {
      return { valid: false, reason: `${developerPath} is not a directory` }
    }
  } catch (err) {
    console.log('[CLT] stat failed for developer path:', err)
    return { valid: false, reason: `developer path ${developerPath} is not accessible` }
  }

  let clangResult
  try {
    clangResult = await run('xcrun --find clang')
  } catch (err) {
    console.log('[CLT] xcrun --find clang failed', err)
    return { valid: false, reason: 'unable to locate clang via xcrun' }
  }

  const clangStdout = clangResult && clangResult.stdout ? clangResult.stdout : ''
  const clangPath =
    clangStdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse()
      .find((line) => line.startsWith('/')) || null
  if (!clangPath) {
    console.log('[CLT] xcrun --find clang stdout did not include a path:', clangStdout)
    return { valid: false, reason: 'unable to locate clang via xcrun' }
  }
  console.log('[CLT] clang path:', clangPath)

  const status = { valid: true, path: developerPath, clangPath }

  const pkgInfo = await readPkgInfo(run)
  if (!pkgInfo) {
    console.log('[CLT] pkg info not found for command line tools packages')
    return { ...status, valid: false, reason: 'unable to determine command line tools version' }
  }

  Object.assign(status, { pkgId: pkgInfo.pkgId, pkgVersion: pkgInfo.version })
  console.log('[CLT] pkg info:', pkgInfo)
  const coercedVersion = pkgInfo.version && semver.coerce(pkgInfo.version)
  const minRequirement = semver.coerce(MIN_CLT_VERSION)
  if (!coercedVersion || !minRequirement || !semver.gte(coercedVersion, minRequirement)) {
    return {
      ...status,
      valid: false,
      reason: `command line tools version ${pkgInfo.version} is below required ${MIN_CLT_VERSION}`
    }
  }

  try {
    const versionResult = await run('xcode-select --version')
    const versionStdout = versionResult && versionResult.stdout ? versionResult.stdout : ''
    const match = /xcode-select\s+version\s+([^\s]+)/i.exec(versionStdout)
    const version = (match && match[1] ? match[1] : '')
      .replace(/[^0-9.]+/g, '')
      .replace(/\.+$/, '') || null
    status.xcodeSelectVersion = version
    console.log('[CLT] xcode-select --version parsed:', version)
  } catch (err) {
    console.log('[CLT] xcode-select --version failed', err)
  }

  return status
}

async function pkgInfoFor(run, pkgId) {
  try {
    const result = await run(`pkgutil --pkg-info=${pkgId}`)
    const stdout = result && result.stdout ? result.stdout : ''
    const match = /version:\s*([^\n]+)/i.exec(stdout)
    if (match) {
      return { pkgId, version: match[1].trim() }
    }
  } catch (err) {
    console.log(`[CLT] pkgutil --pkg-info ${pkgId} failed`, err)
  }
  return null
}

async function readPkgInfo(run) {
  for (const pkgId of PREFERRED_PKG_IDS) {
    const info = await pkgInfoFor(run, pkgId)
    if (info) {
      return info
    }
  }

  let candidates = []
  try {
    const listResult = await run('pkgutil --pkgs')
    const stdout = listResult && listResult.stdout ? listResult.stdout : ''
    candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((id) => PACKAGE_MATCHERS.some((matcher) => matcher.test(id)))
  } catch (err) {
    console.log('[CLT] pkgutil --pkgs failed', err)
  }

  if (candidates.length === 0) {
    candidates = ['com.apple.pkg.CLTools_Executables']
  }
  console.log('[CLT] pkg candidates:', candidates)

  for (const pkgId of candidates) {
    const info = await pkgInfoFor(run, pkgId)
    if (info) {
      return info
    }
  }
  return null
}

module.exports = {
  detectCommandLineTools
}
