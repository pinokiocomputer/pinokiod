const fs = require("fs")
const path = require("path")
const { glob } = require("glob")

const LOCAL_RUN_PREFIX = "/run"
const LOCAL_ASSET_PREFIX = "/asset"
const SYSTEM_RUN_PREFIX = "/pinokio/run"
const SYSTEM_ASSET_PREFIX = "/pinokio/asset"
const LOCAL_PLUGIN_RUN_PREFIX = `${LOCAL_RUN_PREFIX}/plugin`
const LOCAL_PLUGIN_ASSET_PREFIX = `${LOCAL_ASSET_PREFIX}/plugin`
const SYSTEM_PLUGIN_RUN_PREFIX = `${SYSTEM_RUN_PREFIX}/plugin`
const SYSTEM_PLUGIN_ASSET_PREFIX = `${SYSTEM_ASSET_PREFIX}/plugin`
const ACTION_KEYS = new Set(["run", "install", "uninstall", "update"])
const STATUS_KEYS = new Set(["installed"])
const FUNCTION_KEYS = new Set([...ACTION_KEYS, ...STATUS_KEYS])
const BUILTIN_TOOL_ALIASES = {
  claude: "pinokio/run/plugin/claude",
  codex: "pinokio/run/plugin/codex",
  grok: "pinokio/run/plugin/grok",
  "grok-build": "pinokio/run/plugin/grok",
  antigravity: "pinokio/run/plugin/antigravity-cli",
  "antigravity-cli": "pinokio/run/plugin/antigravity-cli",
  "code/claude": "pinokio/run/plugin/claude",
  "code/codex": "pinokio/run/plugin/codex",
}

const toPathname = (value) => {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname
    if (raw.startsWith("/")) return new URL(`http://localhost${raw}`).pathname
  } catch (_) {
  }
  return raw.split("?")[0].split("#")[0]
}

const normalizeSlashes = (value) => String(value || "").replace(/\\/g, "/").replace(/\/{2,}/g, "/")

const systemRoot = (kernel) => {
  if (kernel && typeof kernel.systemPath === "function") {
    return kernel.systemPath()
  }
  return path.resolve(__dirname, "..", "system")
}

const systemPluginRoot = (kernel) => {
  if (kernel && typeof kernel.systemPath === "function") {
    return kernel.systemPath("plugin")
  }
  return path.resolve(__dirname, "..", "system", "plugin")
}

const isSystemRunPath = (value) => toPathname(value).startsWith(`${SYSTEM_RUN_PREFIX}/`)
const isLocalRunPath = (value) => toPathname(value).startsWith(`${LOCAL_RUN_PREFIX}/`)
const isRunPath = (value) => isLocalRunPath(value) || isSystemRunPath(value)
const isSystemPluginPath = (value) => normalizeSlashes(value).startsWith(`${SYSTEM_PLUGIN_RUN_PREFIX}/`)
const isLegacyPluginCodePath = (value) => {
  const normalized = normalizeSlashes(value).replace(/^\/+/, "")
  return normalized.startsWith("plugin/code/") || normalized.startsWith("code/")
}

const normalizePluginPath = (value) => {
  let normalized = toPathname(value)
  if (!normalized) return ""
  normalized = normalizeSlashes(normalized)
  if (!normalized.startsWith(`${SYSTEM_RUN_PREFIX}/`)) {
    normalized = normalized.replace(/^\/run(?=\/)/, "")
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`
  }
  normalized = normalized.replace(/\/+$/, "")
  if (!normalized.endsWith("/pinokio.js")) {
    normalized = `${normalized}/pinokio.js`
  }
  return normalized
}

const systemPluginPathForLocalPath = (value) => {
  const normalized = normalizePluginPath(value)
  const localPrefix = "/plugin/"
  if (!normalized.startsWith(localPrefix)) return ""
  return `${SYSTEM_PLUGIN_RUN_PREFIX}/${normalized.slice(localPrefix.length)}`
}

const pluginSelectionMatches = (src, selectedValue) => {
  const selectedPlugin = normalizeSlashes(typeof selectedValue === "string" ? selectedValue.trim() : "")
  if (!selectedPlugin || !src) return false
  const selectedRunPath = selectedPlugin.startsWith(`${SYSTEM_RUN_PREFIX}/`)
    ? selectedPlugin
    : `${LOCAL_RUN_PREFIX}${selectedPlugin}`
  return src === selectedPlugin || src.startsWith(selectedRunPath)
}

const resolveRunPath = (kernel, value) => {
  const pathname = toPathname(value)
  if (isSystemRunPath(pathname)) {
    const parts = pathname.split("/").filter(Boolean).slice(2)
    return kernel.systemPath(...parts)
  }
  if (isLocalRunPath(pathname)) {
    const parts = pathname.split("/").filter(Boolean).slice(1)
    return kernel.path(...parts)
  }
  return ""
}

const systemRelativeFromPluginPath = (normalizedPath) => {
  return normalizeSlashes(normalizedPath).replace(/^\/pinokio\/run\/+/, "")
}

const pluginPathToAbsolute = (kernel, normalizedPath) => {
  if (isSystemPluginPath(normalizedPath)) {
    return kernel.systemPath(systemRelativeFromPluginPath(normalizedPath))
  }
  return kernel.path(normalizeSlashes(normalizedPath).replace(/^\/+/, ""))
}

const pluginRunHrefForPath = (normalizedPath) => {
  if (typeof normalizedPath !== "string" || !normalizedPath) return ""
  if (isSystemPluginPath(normalizedPath)) return normalizedPath
  return `${LOCAL_RUN_PREFIX}${normalizedPath}`
}

const normalizeActionPathComponents = (components) => {
  const normalized = Array.isArray(components)
    ? components.filter((part) => typeof part === "string" && part.length > 0)
    : []
  if (normalized[0] === "pinokio" && normalized[1] === "run") {
    return {
      system: true,
      pathComponents: normalized.slice(2),
    }
  }
  if (normalized[0] === "run") {
    return {
      system: false,
      pathComponents: normalized.slice(1),
    }
  }
  return {
    system: false,
    pathComponents: normalized,
  }
}

const pluginAssetHrefForIcon = (normalizedPath, icon) => {
  const trimmedIcon = typeof icon === "string" ? icon.trim() : ""
  if (!trimmedIcon) return ""
  if (isSystemPluginPath(normalizedPath)) {
    const relativeDir = path.posix.dirname(systemRelativeFromPluginPath(normalizedPath))
    return `${SYSTEM_ASSET_PREFIX}/${relativeDir}/${trimmedIcon}`
  }
  if (normalizeSlashes(normalizedPath).startsWith("/plugin/")) {
    const relativeDir = path.posix.dirname(normalizeSlashes(normalizedPath).slice(1))
    return `${LOCAL_ASSET_PREFIX}/${relativeDir}/${trimmedIcon}`
  }
  return ""
}

const isAction = (value) => Array.isArray(value) || typeof value === "function"
const isInstalledCheck = (value) => typeof value === "function"
const hasAllowedFunction = (config, key) => FUNCTION_KEYS.has(key) && typeof config[key] === "function"
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const declaredPluginPath = (config) => typeof config.path === "string" ? config.path.trim() : ""
const hasInvalidTopLevelFunction = (config) => {
  return Object.keys(config).some((key) => typeof config[key] === "function" && !hasAllowedFunction(config, key))
}
const hasInvalidAction = (config) => {
  return Array.from(ACTION_KEYS).some((key) => key in config && !isAction(config[key]))
}
const hasInvalidInstalledCheck = (config) => {
  return "installed" in config && !isInstalledCheck(config.installed)
}
const isValidPluginConfig = (config, options = {}) => {
  if (!isPlainObject(config) || !isAction(config.run)) {
    return false
  }
  if (hasInvalidTopLevelFunction(config) || hasInvalidAction(config) || hasInvalidInstalledCheck(config)) {
    return false
  }
  if (options.standalone && declaredPluginPath(config) !== "plugin") {
    return false
  }
  return true
}

const normalizeLauncherTool = (toolValue) => {
  let normalizedTool = typeof toolValue === "string" ? toolValue.trim() : ""
  normalizedTool = normalizedTool.replace(/^https?:\/\/[^/]+/i, "")
  normalizedTool = normalizedTool.replace(/^\/+|\/+$/g, "")
  if (!normalizedTool || normalizedTool.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(normalizedTool)) {
    const error = new Error("Invalid plugin.")
    error.status = 400
    throw error
  }
  normalizedTool = BUILTIN_TOOL_ALIASES[normalizedTool] || normalizedTool
  if (!normalizedTool.startsWith("pinokio/run/")) {
    normalizedTool = normalizedTool.replace(/^run\//, "")
  }
  if (isLegacyPluginCodePath(normalizedTool)) {
    const error = new Error("The managed plugin/code path is no longer used.")
    error.status = 400
    throw error
  }
  return normalizedTool
}

const resolveLauncherPluginHref = (toolValue) => {
  const normalizedTool = normalizeLauncherTool(toolValue)
  if (normalizedTool.startsWith("pinokio/run/")) {
    const scriptPath = normalizedTool.endsWith(".js")
      ? normalizedTool
      : `${normalizedTool}/pinokio.js`
    return `/${scriptPath}`
  }
  if (normalizedTool.startsWith("plugin/") || normalizedTool.startsWith("api/")) {
    const scriptPath = normalizedTool.endsWith(".js")
      ? normalizedTool
      : `${normalizedTool}/pinokio.js`
    return `${LOCAL_RUN_PREFIX}/${scriptPath}`
  }
  return `${LOCAL_PLUGIN_RUN_PREFIX}/${normalizedTool}/pinokio.js`
}

const resolveLauncherPluginSelection = (toolValue) => {
  const href = resolveLauncherPluginHref(toolValue)
  if (href.startsWith(`${LOCAL_RUN_PREFIX}/`)) {
    return href.slice(LOCAL_RUN_PREFIX.length)
  }
  return href
}

const normalizeLauncherSuccessPlugin = (successUrl, toolValue) => {
  if (typeof successUrl !== "string" || typeof toolValue !== "string" || !toolValue.trim()) {
    return successUrl
  }

  try {
    const parsed = new URL(successUrl, "http://localhost")
    if (!parsed.searchParams.has("plugin")) {
      return successUrl
    }
    parsed.searchParams.set("plugin", resolveLauncherPluginSelection(toolValue))
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch (_) {
    return successUrl
  }
}

const loadPluginsFromRoot = async ({ kernel, root, runPrefix, assetPrefix, source, ignore = [], standalone = false }) => {
  const exists = await fs.promises.stat(root).then((stat) => stat.isDirectory()).catch(() => false)
  if (!exists) return []

  const pluginPaths = await glob("**/pinokio.js", { cwd: root, ignore })
  const plugins = []
  for (const pluginPath of pluginPaths) {
    const normalizedPluginPath = normalizeSlashes(pluginPath)
    const config = await kernel.require(path.resolve(root, pluginPath))
    if (!isValidPluginConfig(config, { standalone })) continue

    const cwd = normalizedPluginPath.split("/").slice(0, -1).join("/")
    const href = `${runPrefix}/${normalizedPluginPath}`
    const image = config.icon ? `${assetPrefix}/${cwd}/${config.icon}` : config.image
    plugins.push({
      ...config,
      href,
      src: href,
      image,
      source,
      system: source === "system",
    })
  }
  return plugins
}

const loadPluginMenu = async (kernel) => {
  const systemPlugins = await loadPluginsFromRoot({
    kernel,
    root: systemPluginRoot(kernel),
    runPrefix: SYSTEM_PLUGIN_RUN_PREFIX,
    assetPrefix: SYSTEM_PLUGIN_ASSET_PREFIX,
    source: "system",
  })
  const localPlugins = await loadPluginsFromRoot({
    kernel,
    root: path.resolve(kernel.homedir, "plugin"),
    runPrefix: LOCAL_PLUGIN_RUN_PREFIX,
    assetPrefix: LOCAL_PLUGIN_ASSET_PREFIX,
    source: "local",
    ignore: ["code/**"],
    standalone: true,
  })
  return systemPlugins.concat(localPlugins)
}

module.exports = {
  SYSTEM_RUN_PREFIX,
  SYSTEM_ASSET_PREFIX,
  SYSTEM_PLUGIN_RUN_PREFIX,
  systemRoot,
  systemPluginRoot,
  isSystemRunPath,
  isRunPath,
  isSystemPluginPath,
  isLegacyPluginCodePath,
  normalizePluginPath,
  systemPluginPathForLocalPath,
  pluginSelectionMatches,
  resolveRunPath,
  pluginPathToAbsolute,
  pluginRunHrefForPath,
  normalizeActionPathComponents,
  pluginAssetHrefForIcon,
  resolveLauncherPluginHref,
  resolveLauncherPluginSelection,
  normalizeLauncherSuccessPlugin,
  loadPluginMenu,
  ACTION_KEYS,
  STATUS_KEYS,
  FUNCTION_KEYS,
  isAction,
  isInstalledCheck,
  isValidPluginConfig,
}
