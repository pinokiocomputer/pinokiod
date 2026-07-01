const fs = require("fs")
const path = require("path")
const PluginSources = require("../../kernel/plugin_sources")

const isPathInsideRoot = (candidatePath, rootPath) => {
  const relative = path.relative(rootPath, candidatePath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

const httpError = (status, message) => {
  const error = new Error(message)
  error.status = status
  return error
}

const assertFinalRmTargetInsidePluginRoot = async (target) => {
  const pluginRoot = path.resolve(target.pluginRoot)
  const rmPath = path.resolve(target.pluginDir)
  if (!isPathInsideRoot(rmPath, pluginRoot) || rmPath === pluginRoot) {
    throw httpError(403, "Plugin folder is outside the downloaded plugin folder.")
  }

  const [realPluginRoot, realRmPath] = await Promise.all([
    fs.promises.realpath(pluginRoot),
    fs.promises.realpath(rmPath),
  ])
  if (!isPathInsideRoot(realRmPath, realPluginRoot) || realRmPath === realPluginRoot) {
    throw httpError(403, "Plugin folder is outside the downloaded plugin folder.")
  }
}

const resolvePluginDeleteTarget = ({ kernel, plugin }) => {
  if (!kernel || typeof kernel.path !== "function") {
    throw httpError(500, "Plugin home path is unavailable.")
  }

  const normalizedPath = PluginSources.normalizePluginPath(plugin && plugin.pluginPath ? plugin.pluginPath : "")
  if (!normalizedPath) {
    throw httpError(400, "Plugin path is required.")
  }
  if ((plugin && (plugin.system === true || plugin.source === "system")) || PluginSources.isSystemPluginPath(normalizedPath)) {
    throw httpError(403, "Built-in plugins cannot be deleted.")
  }
  if (!normalizedPath.startsWith("/plugin/") || PluginSources.isLegacyPluginCodePath(normalizedPath)) {
    throw httpError(403, "Only downloaded plugin folders can be deleted.")
  }

  const pluginRoot = path.resolve(kernel.path("plugin"))
  const pluginFilePath = path.resolve(kernel.path(normalizedPath.slice(1)))
  if (!isPathInsideRoot(pluginFilePath, pluginRoot)) {
    throw httpError(403, "Plugin path is outside the downloaded plugin folder.")
  }

  const pluginDir = path.dirname(pluginFilePath)
  if (pluginDir === pluginRoot) {
    throw httpError(403, "The plugin root folder cannot be deleted from this page.")
  }

  const relativeDir = path.relative(pluginRoot, pluginDir).split(path.sep).join("/")
  return {
    pluginPath: normalizedPath,
    pluginRoot,
    pluginFilePath,
    pluginDir,
    relativeDir,
    localLabel: relativeDir ? `plugin/${relativeDir}` : "plugin",
  }
}

const deletePluginFolder = async ({ kernel, plugin }) => {
  const target = resolvePluginDeleteTarget({ kernel, plugin })

  const [fileStat, dirStat] = await Promise.all([
    fs.promises.stat(target.pluginFilePath).catch(() => null),
    fs.promises.stat(target.pluginDir).catch(() => null),
  ])
  if (!fileStat || !fileStat.isFile() || !dirStat || !dirStat.isDirectory()) {
    throw httpError(404, "Plugin folder was not found.")
  }

  await assertFinalRmTargetInsidePluginRoot(target)
  await fs.promises.rm(target.pluginDir, { recursive: true, force: true })
  return target
}

module.exports = {
  deletePluginFolder,
  resolvePluginDeleteTarget,
}
