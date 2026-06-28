const path = require('path')
const unparse = require('yargs-unparser-custom-flag')

const SHELL_RUN_GUARD = Symbol('pinokio.shellRunCondaRuntimeGuard')
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

const VALUE_FLAGS = new Set([
  '-c',
  '--channel',
  '-f',
  '--file',
  '-n',
  '--name',
  '-p',
  '--prefix',
  '--solver',
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

function getExecutableToken(tokens) {
  let index = 0
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index++
  }
  if (tokens[index] === '&' || String(tokens[index]).toLowerCase() === 'call') {
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

function resolveWrapperTarget(params, context) {
  const conda = params ? params.conda : undefined
  const platform = context.platform || process.platform
  const cwd = context.cwd || (params && params.path) || process.cwd()
  if (!conda) {
    return { kind: 'managed-base', source: 'wrapper', prefix: context.managedBasePrefix || '' }
  }
  if (typeof conda === 'string') {
    return { kind: 'app-env', source: 'wrapper', prefix: resolvePathFrom(cwd, conda, platform) }
  }
  if (conda && conda.path) {
    return { kind: 'app-env', source: 'wrapper', prefix: resolvePathFrom(cwd, conda.path, platform) }
  }
  if (conda && conda.name) {
    if (conda.name === 'base') {
      return { kind: 'managed-base', source: 'wrapper', prefix: context.managedBasePrefix || '' }
    }
    return {
      kind: 'app-env',
      source: 'wrapper',
      name: conda.name,
    }
  }
  return { kind: 'unknown', source: 'wrapper' }
}

function parseCommandTarget(tokens, executableIndex) {
  for (let i = executableIndex + 1; i < tokens.length; i++) {
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

function resolveTarget(tokens, executableIndex, params, context) {
  const wrapperTarget = resolveWrapperTarget(params, context)
  return refineTargetFromCommandArgs(wrapperTarget, parseCommandTarget(tokens, executableIndex), params, context)
}

function findSubcommand(tokens, executableIndex) {
  for (let i = executableIndex + 1; i < tokens.length; i++) {
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

function isEnvironmentTargetingSubcommand(subcommand) {
  return subcommand && (
    subcommand.name === 'create'
    || subcommand.name === 'env create'
    || subcommand.name === 'env remove'
    || subcommand.name === 'env update'
  )
}

function normalizePackageSpec(token) {
  if (!token || token.startsWith('-')) {
    return ''
  }
  const scoped = String(token).split('::').pop()
  return scoped.split(/[=<>!~]/)[0].trim().toLowerCase()
}

function hasAllFlag(tokens, startIndex) {
  return tokens.slice(startIndex).some((token) => token === '--all')
}

function hasDryRunFlag(tokens, startIndex) {
  return tokens.slice(startIndex).some((token) => token === '--dry-run')
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

function protectedPackageFromSubcommand(tokens, subcommand) {
  const packages = explicitPackageNames(tokens, subcommand.endIndex + 1)
  return packages.find((pkg) => PROTECTED_PACKAGES.has(pkg)) || ''
}

function isListedBroadMutation(tokens, subcommand, target) {
  if ((subcommand.name === 'update' || subcommand.name === 'upgrade') && hasAllFlag(tokens, subcommand.endIndex + 1)) {
    return true
  }
  return subcommand.name === 'env remove' && target.source === 'command-target'
}

function classifyCommandTokens(tokens, params = {}, context = {}) {
  const { executable, index: executableIndex } = getExecutableToken(tokens)
  if (!isCondaExecutable(executable, context)) {
    return { shouldSkip: false }
  }
  const target = resolveTarget(tokens, executableIndex, params, context)
  if (target.kind !== 'managed-base') {
    return { shouldSkip: false }
  }
  const subcommand = findSubcommand(tokens, executableIndex)
  if (!subcommand || !subcommand.mutating) {
    return { shouldSkip: false }
  }
  if (hasDryRunFlag(tokens, subcommand.endIndex + 1)) {
    return { shouldSkip: false }
  }

  if (isEnvironmentTargetingSubcommand(subcommand) && target.source !== 'command-target') {
    return { shouldSkip: false }
  }

  const protectedPackage = protectedPackageFromSubcommand(tokens, subcommand)
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

function noopCommand() {
  return 'echo Pinokio skipped a Conda setup command. Pinokio is continuing.'
}

function classifySegment(segment, params, context) {
  const parsed = shellTokenize(segment, context)
  if (!parsed.closed) {
    return { shouldSkip: false }
  }
  return {
    ...classifyCommandTokens(parsed.tokens, params, context),
    tokens: parsed.tokens,
  }
}

function rewriteStringMessage(message, params, context) {
  const parts = splitShellSegments(message, context)
  const skipped = []
  const hasUnsafeSeparator = parts.some((part) => part.type === 'unsafe-separator')

  if (hasUnsafeSeparator) {
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
    if (skipped.length > 0) {
      return { message: noopCommand(), skipped }
    }
    return { message, skipped }
  }

  const rewritten = parts.map((part) => {
    if (part.type !== 'segment') {
      return part.text
    }
    const leading = (part.text.match(/^\s*/) || [''])[0]
    const trailing = (part.text.match(/\s*$/) || [''])[0]
    const body = part.text.trim()
    if (!body) {
      return part.text
    }
    const classification = classifySegment(body, params, context)
    if (!classification.shouldSkip) {
      return part.text
    }
    skipped.push({
      command: body,
      reason: classification.reason,
      target: classification.target,
    })
    return leading + noopCommand() + trailing
  }).join('')
  return { message: rewritten, skipped }
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
    message: noopCommand(),
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
  const count = skipped.length
  const firstCommand = skipped[0] && skipped[0].command ? String(skipped[0].command) : ''
  const truncatedCommand = firstCommand.length > 240 ? `${firstCommand.slice(0, 237)}...` : firstCommand
  const title = count === 1
    ? 'Pinokio skipped a Conda setup command.'
    : `Pinokio skipped ${count} Conda setup commands.`
  const commandHtml = truncatedCommand
    ? [
        '<pre style="white-space:pre-wrap;margin:8px 0 0;font-size:12px;line-height:1.35;">',
        escapeHtml(truncatedCommand),
        '</pre>',
      ].join('')
    : ''
  const moreHtml = count > 1
    ? `<br>${escapeHtml(`${count - 1} more skipped command${count === 2 ? ' is' : 's are'} listed in the terminal log.`)}`
    : ''
  return [
    `<b>${escapeHtml(title)}</b>`,
    escapeHtml('Pinokio already manages base Conda.'),
    escapeHtml('Pinokio is continuing.'),
    commandHtml,
    `${escapeHtml('Details are in the terminal/log.')}${moreHtml}`,
  ].filter(Boolean).join('<br>')
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
  if (!params || !params[SHELL_RUN_GUARD]) {
    return { params, skipped: [] }
  }
  if (params.conda && params.conda.skip === true) {
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
  SHELL_RUN_GUARD,
  applyCondaRuntimeGuard,
  resetNoticeSessionsForTest,
}
