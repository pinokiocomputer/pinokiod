function isCmdShellName(shellName) {
  const name = (shellName || '').toLowerCase()
  return name.includes('cmd.exe') || name === 'cmd'
}

function isPowerShellName(shellName) {
  const name = (shellName || '').toLowerCase()
  return name.includes('powershell') || name.includes('pwsh')
}

const ENV_ARG_MARKER_RE = /__PINOKIO_ENVARG_(\d+)__/g

function envArgMarker(index) {
  return `__PINOKIO_ENVARG_${index}__`
}

function isPinokioEnvArgKey(key) {
  return /^PINOKIO_ARG_\d+$/.test(key || "")
}

function hasEnvArgMarker(value) {
  ENV_ARG_MARKER_RE.lastIndex = 0
  return ENV_ARG_MARKER_RE.test(String(value))
}

function quotePosixLiteral(value) {
  const input = value == null ? "" : String(value)
  return `'${input.split("'").join("'\"'\"'")}'`
}

function quotePowerShellComposite(value) {
  const input = value == null ? "" : String(value)
  ENV_ARG_MARKER_RE.lastIndex = 0
  let output = '"'
  let lastIndex = 0
  for (const match of input.matchAll(ENV_ARG_MARKER_RE)) {
    const literal = input.slice(lastIndex, match.index)
    output += literal.replace(/[`"$]/g, (char) => "`" + char)
    output += "${env:PINOKIO_ARG_" + match[1] + "}"
    lastIndex = match.index + match[0].length
  }
  output += input.slice(lastIndex).replace(/[`"$]/g, (char) => "`" + char)
  output += '"'
  return output
}

function quoteCmdComposite(value) {
  const input = value == null ? "" : String(value)
  ENV_ARG_MARKER_RE.lastIndex = 0
  let output = '"'
  let lastIndex = 0
  for (const match of input.matchAll(ENV_ARG_MARKER_RE)) {
    const literal = input.slice(lastIndex, match.index)
    output += literal.replace(/([()%!^"<>&|])/g, '^$1')
    output += "!PINOKIO_ARG_" + match[1] + "!"
    lastIndex = match.index + match[0].length
  }
  output += input.slice(lastIndex).replace(/([()%!^"<>&|])/g, '^$1')
  output += '"'
  return output
}

function quoteEnvArgComposite(value, shellName) {
  const input = value == null ? "" : String(value)
  if (isCmdShellName(shellName)) {
    return quoteCmdComposite(input)
  }
  if (isPowerShellName(shellName)) {
    return quotePowerShellComposite(input)
  }

  ENV_ARG_MARKER_RE.lastIndex = 0
  const parts = []
  let lastIndex = 0
  for (const match of input.matchAll(ENV_ARG_MARKER_RE)) {
    const literal = input.slice(lastIndex, match.index)
    if (literal) {
      parts.push(quotePosixLiteral(literal))
    }
    parts.push('"$PINOKIO_ARG_' + match[1] + '"')
    lastIndex = match.index + match[0].length
  }
  const tail = input.slice(lastIndex)
  if (tail) {
    parts.push(quotePosixLiteral(tail))
  }
  return parts.length > 0 ? parts.join("") : "''"
}

function shellNameFor(kernel, params) {
  let shellName = kernel && kernel.platform === "win32" ? "cmd.exe" : "bash"
  if (params && typeof params.shell === "string" && params.shell.trim()) {
    shellName = params.shell
  }
  return shellName
}

function isPlainObject(value) {
  return value && value.constructor === Object
}

function hasMultiline(value) {
  return typeof value === "string" && /[\r\n]/.test(value)
}

function isStructuredArgvMessage(value) {
  return isPlainObject(value) && Array.isArray(value._)
}

function hasStructuredArgvMessage(value) {
  if (isStructuredArgvMessage(value)) {
    return true
  }
  if (Array.isArray(value)) {
    return value.some((item) => isStructuredArgvMessage(item))
  }
  return false
}

function protectStructuredString(value, state) {
  if (!hasMultiline(value)) {
    return value
  }
  const name = `PINOKIO_ARG_${state.args.length}`
  state.args.push({
    name,
    value: value == null ? "" : String(value)
  })
  return envArgMarker(state.args.length - 1)
}

function protectStructuredValue(value, state) {
  if (typeof value === "string") {
    return protectStructuredString(value, state)
  }
  if (Array.isArray(value)) {
    return value.map((item) => protectStructuredValue(item, state))
  }
  if (isPlainObject(value)) {
    const rendered = {}
    for (const [key, item] of Object.entries(value)) {
      rendered[key] = protectStructuredValue(item, state)
    }
    return rendered
  }
  return value
}

function protectStructuredMessage(value, state) {
  if (isStructuredArgvMessage(value)) {
    return protectStructuredValue(value, state)
  }
  if (Array.isArray(value)) {
    return value.map((item) => isStructuredArgvMessage(item) ? protectStructuredValue(item, state) : item)
  }
  return value
}

function renderEnvArgs(kernel, rpc, memory) {
  if (!rpc || rpc.method !== "shell.run" || !rpc.params || !hasStructuredArgvMessage(rpc.params.message)) {
    return rpc
  }

  const shellName = shellNameFor(kernel, rpc.params)
  const state = { args: [] }
  const message = protectStructuredMessage(rpc.params.message, state)

  if (state.args.length === 0) {
    return rpc
  }

  const env = Object.assign({}, rpc.params.env || {})
  for (const arg of state.args) {
    env[arg.name] = arg.value
  }

  return {
    ...rpc,
    params: {
      ...rpc.params,
      message,
      env,
      _pinokio_env_args: state.args,
      _pinokio_cmd_delayed_expansion: isCmdShellName(shellName)
    }
  }
}

function envArgDetails(value) {
  const normalized = String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "?")
  const lines = normalized.split("\n")
  const previewLines = []
  const maxLines = 8
  const maxChars = 800
  let used = 0

  for (const line of lines.slice(0, maxLines)) {
    const remaining = maxChars - used
    if (remaining <= 0) {
      break
    }
    if (line.length > remaining) {
      previewLines.push(line.slice(0, remaining) + "...")
      used = maxChars
      break
    }
    previewLines.push(line)
    used += line.length + 1
  }

  const preview = previewLines.join("\n")
  const truncated = lines.length > previewLines.length || normalized.length > preview.length
  if (truncated && previewLines[previewLines.length - 1] !== "...") {
    previewLines.push("...")
  }

  return {
    lineCount: normalized.length === 0 ? 0 : lines.length,
    previewLines,
    truncated
  }
}

function formatEnvArgsPreview(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return ""
  }
  const lines = ["\r\nPinokio shell args", ""]
  for (const arg of args) {
    const details = envArgDetails(arg.value)
    lines.push(`${arg.name}  ${details.lineCount} lines`)
    for (const previewLine of details.previewLines) {
      lines.push(`  ${previewLine}`)
    }
    lines.push("")
  }
  return lines.join("\r\n") + "\r\n"
}

function envArgSummary(value) {
  const details = envArgDetails(value)
  return {
    type: "pinokio env arg",
    lines: details.lineCount,
    preview: details.previewLines.join("\n"),
    truncated: details.truncated
  }
}

function redactEnvArgs(env) {
  if (!env || typeof env !== "object") {
    return env
  }
  const redacted = { ...env }
  for (const key of Object.keys(redacted)) {
    if (isPinokioEnvArgKey(key)) {
      redacted[key] = envArgSummary(redacted[key])
    }
  }
  return redacted
}

module.exports = {
  renderEnvArgs,
  quoteEnvArgComposite,
  hasEnvArgMarker,
  isPinokioEnvArgKey,
  formatEnvArgsPreview,
  redactEnvArgs
}
