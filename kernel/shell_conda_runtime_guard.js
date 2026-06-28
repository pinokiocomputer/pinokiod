const path = require('path')
const unparse = require('yargs-unparser-custom-flag')

const SHELL_RUN_GUARD_OPTION = 'condaRuntimeGuard'
const noticeSessions = new Set()

const MUTATING_COMMANDS = new Set([
  'create',
  'install',
  'remove',
  'uninstall',
  'update',
  'upgrade',
])

const ENV_MUTATING_COMMANDS = new Set([
  'create',
  'remove',
  'update',
])

const PROTECTED_PACKAGES = new Set([
  'conda',
  'python',
  'conda-libmamba-solver',
])
const PROTECTED_PACKAGE_NAMES = Array.from(PROTECTED_PACKAGES).sort((a, b) => b.length - a.length)

const VALUE_FLAGS = new Set([
  '-c',
  '--channel',
  '-f',
  '--file',
  '-n',
  '--name',
  '-p',
  '--prefix',
  '--revision',
  '--solver',
])

const FILE_FLAGS = new Set([
  '-f',
  '--file',
])

function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function normalizePathname(value, platform) {
  if (!value || typeof value !== 'string') {
    return ''
  }
  const api = pathApi(platform)
  const normalized = api.normalize(value)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isSamePath(target, root, platform) {
  const normalizedTarget = normalizePathname(target, platform)
  const normalizedRoot = normalizePathname(root, platform)
  if (!normalizedTarget || !normalizedRoot) {
    return false
  }
  return pathApi(platform).relative(normalizedRoot, normalizedTarget) === ''
}

function resolvePathFrom(basePath, value, platform) {
  if (!value || typeof value !== 'string') {
    return ''
  }
  const api = pathApi(platform)
  if (api.isAbsolute(value)) {
    return api.normalize(value)
  }
  return api.resolve(basePath || process.cwd(), value)
}

function usesBackslashEscapes(context = {}) {
  const shellName = String(context.shellName || '').toLowerCase()
  if (shellName.includes('cmd.exe') || shellName === 'cmd' || shellName.includes('powershell') || shellName.includes('pwsh')) {
    return false
  }
  return context.platform !== 'win32'
}

function shellTokenize(input, context = {}) {
  const tokens = []
  let token = ''
  let quote = null
  let escaped = false
  const backslashEscapes = usesBackslashEscapes(context)

  const push = () => {
    if (token.length > 0) {
      tokens.push(token)
      token = ''
    }
  }

  for (const char of String(input || '')) {
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        token += char
      }
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
      } else if (char === '\\' && backslashEscapes) {
        escaped = true
      } else {
        token += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\' && backslashEscapes) {
      escaped = true
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    token += char
  }
  if (escaped) {
    token += '\\'
  }
  push()
  return { tokens, closed: quote === null }
}

function splitShellSegments(input, context = {}) {
  const parts = []
  let segment = ''
  let quote = null
  let escaped = false
  const text = String(input || '')
  const backslashEscapes = usesBackslashEscapes(context)

  const pushSegment = () => {
    parts.push({ type: 'segment', text: segment })
    segment = ''
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (escaped) {
      segment += char
      escaped = false
      continue
    }
    if (quote === "'") {
      segment += char
      if (char === "'") {
        quote = null
      }
      continue
    }
    if (quote === '"') {
      segment += char
      if (char === '"') {
        quote = null
      } else if (char === '\\' && backslashEscapes) {
        escaped = true
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      segment += char
      continue
    }
    if (char === '\\' && backslashEscapes) {
      escaped = true
      segment += char
      continue
    }
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      pushSegment()
      parts.push({ type: 'separator', text: char + next })
      i++
      continue
    }
    if (char === '&') {
      const previous = text[i - 1]
      if (previous === '>' || previous === '<' || next === '>') {
        segment += char
        continue
      }
      pushSegment()
      parts.push({ type: 'unsafe-separator', text: char })
      continue
    }
    if (char === '|') {
      pushSegment()
      parts.push({ type: 'unsafe-separator', text: char })
      continue
    }
    if (char === ';' || char === '\n' || char === '\r') {
      pushSegment()
      parts.push({ type: 'separator', text: char })
      continue
    }
    segment += char
  }
  pushSegment()
  return parts
}

function getExecutableToken(tokens, startIndex = 0, context = {}) {
  let index = startIndex
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index++
  }
  const token = String(tokens[index] || '')
  const lower = token.toLowerCase()
  const shellName = String(context.shellName || '').toLowerCase()
  const platform = context.platform || process.platform
  if (
    (token === '&' && (shellName.includes('powershell') || shellName.includes('pwsh')))
    || (lower === 'call' && (platform === 'win32' || shellName.includes('cmd')))
  ) {
    index++
  }
  return { executable: tokens[index] || '', index }
}

function executableBasename(executable, platform) {
  const api = pathApi(platform)
  return api.basename(String(executable || '')).toLowerCase()
}

function isCondaExecutable(executable, context) {
  const platform = context.platform || process.platform
  if (!executable) {
    return false
  }
  if (String(executable).toLowerCase() === 'conda') {
    return true
  }
  const base = executableBasename(executable, platform)
  return base === 'conda' || base === 'conda.exe' || base === 'conda.bat' || base === 'conda.cmd'
}

function isPythonExecutable(executable, context) {
  const platform = context.platform || process.platform
  const base = executableBasename(executable, platform)
  return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/.test(base)
}

function isCondaModuleToken(token) {
  return String(token || '').toLowerCase() === 'conda'
}

function findCondaInvocation(tokens, context, startIndex = 0) {
  const { executable, index: executableIndex } = getExecutableToken(tokens, startIndex, context)
  if (isCondaExecutable(executable, context)) {
    return { executableIndex, argsStart: executableIndex + 1 }
  }
  if (isPythonExecutable(executable, context)) {
    if (tokens[executableIndex + 1] === '-m' && isCondaModuleToken(tokens[executableIndex + 2])) {
      return { executableIndex, argsStart: executableIndex + 3 }
    }
  }
  return null
}

function resolveWrapperTarget(params, context) {
  const conda = params ? params.conda : undefined
  const platform = context.platform || process.platform
  const cwd = context.cwd || (params && params.path) || process.cwd()
  const managedBasePrefix = context.managedBasePrefix || ''
  if (!conda) {
    return { kind: 'managed-base', source: 'wrapper', prefix: managedBasePrefix }
  }
  if (conda && conda.skip === true) {
    return { kind: 'unknown', source: 'wrapper-skip' }
  }
  if (typeof conda === 'string') {
    const prefix = resolvePathFrom(cwd, conda, platform)
    if (managedBasePrefix && isSamePath(prefix, managedBasePrefix, platform)) {
      return { kind: 'managed-base', source: 'wrapper', prefix: managedBasePrefix }
    }
    return { kind: 'app-env', source: 'wrapper', prefix }
  }
  if (conda && conda.activate === 'minimal' && (conda.path || conda.name)) {
    return { kind: 'managed-base', source: 'wrapper', prefix: managedBasePrefix }
  }
  if (conda && conda.path) {
    const prefix = resolvePathFrom(cwd, conda.path, platform)
    if (managedBasePrefix && isSamePath(prefix, managedBasePrefix, platform)) {
      return { kind: 'managed-base', source: 'wrapper', prefix: managedBasePrefix }
    }
    return { kind: 'app-env', source: 'wrapper', prefix }
  }
  if (conda && conda.name) {
    if (conda.name === 'base') {
      return { kind: 'managed-base', source: 'wrapper', prefix: managedBasePrefix }
    }
    return {
      kind: 'app-env',
      source: 'wrapper',
      name: conda.name,
    }
  }
  return { kind: 'unknown', source: 'wrapper' }
}

function parseCommandTarget(tokens, argsStart) {
  for (let i = argsStart; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-p' || token === '--prefix') {
      return { type: 'prefix', value: tokens[i + 1] || '' }
    }
    if (token.startsWith('--prefix=')) {
      return { type: 'prefix', value: token.slice('--prefix='.length) }
    }
    if (token === '-n' || token === '--name') {
      return { type: 'name', value: tokens[i + 1] || '' }
    }
    if (token.startsWith('--name=')) {
      return { type: 'name', value: token.slice('--name='.length) }
    }
  }
  return null
}

function refineTargetFromCommandArgs(target, commandTarget, params, context) {
  if (!commandTarget || !commandTarget.value) {
    return target
  }
  const platform = context.platform || process.platform
  const managedBasePrefix = context.managedBasePrefix || ''
  if (commandTarget.type === 'name') {
    if (commandTarget.value === 'base') {
      return { kind: 'managed-base', source: 'command-target', name: 'base', prefix: managedBasePrefix }
    }
    return { kind: 'app-env', source: 'command-target', name: commandTarget.value }
  }
  const resolved = resolvePathFrom(context.cwd || (params && params.path) || process.cwd(), commandTarget.value, platform)
  if (managedBasePrefix && isSamePath(resolved, managedBasePrefix, platform)) {
    return { kind: 'managed-base', source: 'command-target', prefix: managedBasePrefix }
  }
  return { kind: 'app-env', source: 'command-target', prefix: resolved }
}

function resolveTarget(tokens, argsStart, params, context, wrapperTargetOverride) {
  const wrapperTarget = wrapperTargetOverride || resolveWrapperTarget(params, context)
  return refineTargetFromCommandArgs(wrapperTarget, parseCommandTarget(tokens, argsStart), params, context)
}

function findSubcommand(tokens, argsStart) {
  for (let i = argsStart; i < tokens.length; i++) {
    const token = String(tokens[i] || '').toLowerCase()
    if (!token || token.startsWith('-')) {
      if (VALUE_FLAGS.has(token)) {
        i++
      }
      continue
    }
    if (token === 'env') {
      const subcommand = String(tokens[i + 1] || '').toLowerCase()
      if (ENV_MUTATING_COMMANDS.has(subcommand)) {
        return { name: `env ${subcommand}`, index: i, endIndex: i + 1, mutating: true }
      }
      return { name: `env ${subcommand}`, index: i, endIndex: i + 1, mutating: false }
    }
    if (MUTATING_COMMANDS.has(token)) {
      return { name: token, index: i, endIndex: i, mutating: true }
    }
    return { name: token, index: i, endIndex: i, mutating: false }
  }
  return null
}

function isCreateSubcommand(subcommand) {
  return subcommand && (subcommand.name === 'create' || subcommand.name === 'env create')
}

function normalizePackageSpec(token) {
  if (!token || token.startsWith('-')) {
    return ''
  }
  const scoped = String(token).split('::').pop()
  return scoped.split(/[=<>!~]/)[0].trim().toLowerCase()
}

function protectedPackageFromArchive(token, context) {
  if (!token || token.startsWith('-')) {
    return ''
  }
  const platform = context.platform || process.platform
  const base = executableBasename(token, platform)
  const lower = base.toLowerCase()
  const ext = lower.endsWith('.tar.bz2')
    ? '.tar.bz2'
    : lower.endsWith('.conda')
      ? '.conda'
      : ''
  if (!ext) {
    return ''
  }
  for (const pkg of PROTECTED_PACKAGE_NAMES) {
    const prefix = `${pkg}-`
    if (!lower.startsWith(prefix)) {
      continue
    }
    const body = lower.slice(prefix.length, -ext.length)
    const buildSeparator = body.indexOf('-')
    if (/^\d/.test(body) && buildSeparator > 0 && buildSeparator < body.length - 1) {
      return pkg
    }
  }
  return ''
}

function hasFlag(tokens, startIndex, flags) {
  return tokens.slice(startIndex).some((token) => {
    if (flags.has(token)) {
      return true
    }
    if (String(token).startsWith('--') && String(token).includes('=')) {
      return flags.has(String(token).slice(0, String(token).indexOf('=')))
    }
    return false
  })
}

function hasAllFlag(tokens, startIndex) {
  return hasFlag(tokens, startIndex, new Set(['--all']))
}

function hasDryRunFlag(tokens, startIndex) {
  return hasFlag(tokens, startIndex, new Set(['--dry-run', '-d']))
}

function hasUpdateAllFlag(tokens, startIndex) {
  return hasFlag(tokens, startIndex, new Set(['--update-all', '--all']))
}

function hasRevisionFlag(tokens, startIndex) {
  return hasFlag(tokens, startIndex, new Set(['--revision']))
}

function hasFileFlag(tokens, startIndex) {
  return hasFlag(tokens, startIndex, FILE_FLAGS)
}

function explicitPackageNames(tokens, startIndex) {
  const packages = []
  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) {
      continue
    }
    if (token.startsWith('--') && token.includes('=')) {
      continue
    }
    if (VALUE_FLAGS.has(token)) {
      i++
      continue
    }
    if (token.startsWith('-')) {
      continue
    }
    const pkg = normalizePackageSpec(token)
    if (pkg) {
      packages.push(pkg)
    }
  }
  return packages
}

function protectedPackageFromSubcommand(tokens, subcommand, context) {
  const packages = explicitPackageNames(tokens, subcommand.endIndex + 1)
  const explicitPackage = packages.find((pkg) => PROTECTED_PACKAGES.has(pkg))
  if (explicitPackage) {
    return explicitPackage
  }
  if (subcommand.name !== 'install') {
    return ''
  }
  for (let i = subcommand.endIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) {
      continue
    }
    if (token.startsWith('--') && token.includes('=')) {
      continue
    }
    if (VALUE_FLAGS.has(token)) {
      i++
      continue
    }
    if (token.startsWith('-')) {
      continue
    }
    const archivePackage = protectedPackageFromArchive(token, context)
    if (archivePackage) {
      return archivePackage
    }
  }
  return ''
}

function isListedBroadMutation(tokens, subcommand, target) {
  const startIndex = subcommand.endIndex + 1
  if ((subcommand.name === 'update' || subcommand.name === 'upgrade') && hasUpdateAllFlag(tokens, subcommand.endIndex + 1)) {
    return true
  }
  if (subcommand.name === 'install' && (hasUpdateAllFlag(tokens, startIndex) || hasRevisionFlag(tokens, startIndex))) {
    return true
  }
  if ((subcommand.name === 'remove' || subcommand.name === 'uninstall') && hasAllFlag(tokens, startIndex)) {
    return true
  }
  if ((subcommand.name === 'create' || subcommand.name === 'env create') && target.source === 'command-target') {
    return true
  }
  if (subcommand.name === 'env remove' && target.source === 'command-target') {
    return true
  }
  if (subcommand.name === 'env update') {
    return true
  }
  if (['install', 'update', 'upgrade'].includes(subcommand.name) && hasFileFlag(tokens, startIndex)) {
    return true
  }
  return false
}

function parseCondaRun(tokens, argsStart, params, context, wrapperTarget) {
  let commandTarget = null
  let commandStart = argsStart + 1
  for (let i = argsStart + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-p' || token === '--prefix') {
      commandTarget = { type: 'prefix', value: tokens[i + 1] || '' }
      i++
      commandStart = i + 1
      continue
    }
    if (String(token).startsWith('--prefix=')) {
      commandTarget = { type: 'prefix', value: token.slice('--prefix='.length) }
      commandStart = i + 1
      continue
    }
    if (token === '-n' || token === '--name') {
      commandTarget = { type: 'name', value: tokens[i + 1] || '' }
      i++
      commandStart = i + 1
      continue
    }
    if (String(token).startsWith('--name=')) {
      commandTarget = { type: 'name', value: token.slice('--name='.length) }
      commandStart = i + 1
      continue
    }
    if (token === '--cwd') {
      i++
      commandStart = i + 1
      continue
    }
    if (String(token).startsWith('--cwd=')) {
      commandStart = i + 1
      continue
    }
    if (token === '--') {
      commandStart = i + 1
      break
    }
    if (String(token).startsWith('-')) {
      commandStart = i + 1
      continue
    }
    commandStart = i
    break
  }
  const target = refineTargetFromCommandArgs(wrapperTarget, commandTarget, params, context)
  return { commandStart, target }
}

function classifyCommandTokens(tokens, params = {}, context = {}, startIndex = 0, wrapperTargetOverride = null) {
  const invocation = findCondaInvocation(tokens, context, startIndex)
  if (!invocation) {
    return { shouldSkip: false }
  }
  const wrapperTarget = wrapperTargetOverride || resolveWrapperTarget(params, context)
  const subcommand = findSubcommand(tokens, invocation.argsStart)
  if (subcommand && subcommand.name === 'run') {
    const run = parseCondaRun(tokens, invocation.argsStart, params, context, wrapperTarget)
    return classifyCommandTokens(tokens, params, context, run.commandStart, run.target)
  }
  const target = resolveTarget(tokens, invocation.argsStart, params, context, wrapperTarget)
  if (target.kind !== 'managed-base') {
    return { shouldSkip: false }
  }
  if (!subcommand || !subcommand.mutating) {
    return { shouldSkip: false }
  }
  if (hasDryRunFlag(tokens, invocation.argsStart)) {
    return { shouldSkip: false }
  }

  if (isCreateSubcommand(subcommand) && target.source !== 'command-target') {
    return { shouldSkip: false }
  }
  if (subcommand.name === 'env remove' && target.source !== 'command-target') {
    return { shouldSkip: false }
  }

  const protectedPackage = protectedPackageFromSubcommand(tokens, subcommand, context)
  if (!protectedPackage && !isListedBroadMutation(tokens, subcommand, target)) {
    return { shouldSkip: false }
  }

  return {
    shouldSkip: true,
    target,
    reason: protectedPackage
      ? `protected base Conda package: ${protectedPackage}`
      : `listed broad managed-base mutation: ${subcommand.name}`,
  }
}

function classifySegment(segment, params, context) {
  const parsed = shellTokenize(segment, context)
  if (!parsed.closed) {
    return { shouldSkip: false }
  }
  return classifyCommandTokens(parsed.tokens, params, context)
}

function rewriteStringMessage(message, params, context) {
  const parts = splitShellSegments(message, context)
  const skipped = []

  for (const part of parts) {
    if (part.type !== 'segment') {
      continue
    }
    const body = part.text.trim()
    if (!body) {
      continue
    }
    const classification = classifySegment(body, params, context)
    if (classification.shouldSkip) {
      skipped.push({
        command: body,
        reason: classification.reason,
        target: classification.target,
      })
    }
  }
  return { message: skipped.length > 0 ? '' : message, skipped }
}

function structuredTokens(message) {
  if (!message || message.constructor !== Object) {
    return null
  }
  return unparse(message)
    .filter((item) => item != null)
    .map((item) => String(item))
}

function rewriteSingleMessage(message, params, context) {
  if (typeof message === 'string') {
    return rewriteStringMessage(message, params, context)
  }
  const tokens = structuredTokens(message)
  if (!tokens) {
    return { message, skipped: [] }
  }
  const classification = classifyCommandTokens(tokens, params, context)
  if (!classification.shouldSkip) {
    return { message, skipped: [] }
  }
  return {
    message: '',
    skipped: [{
      command: tokens.join(' '),
      reason: classification.reason,
      target: classification.target,
    }],
  }
}

function sessionKey(params, context) {
  if (context.sessionKey) {
    return context.sessionKey
  }
  const parent = params && params.$parent
  return (parent && (parent.id || parent.path)) || (params && (params.group || params.id || params.path)) || 'global'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatRawNotice(skip) {
  const target = skip.target && skip.target.kind ? skip.target.kind : 'unknown'
  return [
    '',
    '[Pinokio] Skipped Conda setup command.',
    `[Pinokio] Command: ${JSON.stringify(skip.command)}`,
    "[Pinokio] The command targets Pinokio's protected base Conda setup.",
    `[Pinokio] Reason: ${skip.reason || 'protected base Conda setup'}`,
    `[Pinokio] Target: ${target}`,
    '',
  ].join('\r\n')
}

function formatNotifyHtml(skipped) {
  const firstCommand = skipped[0] && skipped[0].command ? String(skipped[0].command) : ''
  const truncatedCommand = firstCommand.length > 240 ? `${firstCommand.slice(0, 237)}...` : firstCommand
  const commandHtml = truncatedCommand
    ? [
        '<code style="display:block;box-sizing:border-box;max-width:100%;white-space:pre-wrap;margin:0;padding:6px 8px;border:1px solid rgba(255,255,255,.16);border-radius:4px;background:rgba(255,255,255,.06);font-size:12px;line-height:1.35;">',
        escapeHtml(truncatedCommand),
        '</code>',
      ].join('')
    : ''
  const rows = [
    `<b style="display:block;">${escapeHtml('Command skipped')}</b>`,
    commandHtml,
    `<span>${escapeHtml('No action needed. Pinokio already includes Conda.')}</span>`,
  ].filter(Boolean).join('')
  return `<div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>`
}

function emitSkipNotices(params, skipped, context) {
  if (!skipped.length || typeof context.ondata !== 'function') {
    return
  }
  for (const skip of skipped) {
    context.ondata({ raw: formatRawNotice(skip) })
  }
  const key = sessionKey(params, context)
  if (noticeSessions.has(key)) {
    return
  }
  noticeSessions.add(key)
  context.ondata({
    silent: true,
    type: 'warning',
    html: formatNotifyHtml(skipped),
  }, 'notify')
}

function applyCondaRuntimeGuard(params, context = {}) {
  if (!params) {
    return { params, skipped: [] }
  }
  const message = params.message
  if (typeof message === 'undefined' || message === null) {
    return { params, skipped: [] }
  }
  const allSkipped = []
  if (Array.isArray(message)) {
    params.message = message.map((item) => {
      const result = rewriteSingleMessage(item, params, context)
      allSkipped.push(...result.skipped)
      return result.message
    })
  } else {
    const result = rewriteSingleMessage(message, params, context)
    params.message = result.message
    allSkipped.push(...result.skipped)
  }
  emitSkipNotices(params, allSkipped, context)
  return { params, skipped: allSkipped }
}

function resetNoticeSessionsForTest() {
  noticeSessions.clear()
}

module.exports = {
  SHELL_RUN_GUARD_OPTION,
  applyCondaRuntimeGuard,
  resetNoticeSessionsForTest,
}
