const fs = require("fs")
const path = require("path")

function createInstallValidationService({ kernel }) {
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const isPlainObject = (value) => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
  }

  const buildValidation = ({ type, title, errors }) => {
    const normalizedErrors = Array.isArray(errors) ? errors.filter(Boolean) : []
    return {
      valid: normalizedErrors.length === 0,
      type,
      title,
      message: normalizedErrors.length > 0 ? normalizedErrors[0].message : "",
      errors: normalizedErrors
    }
  }

  const buildError = (message, fix, extra = {}) => {
    return {
      message,
      fix,
      ...extra
    }
  }

  const normalizeRelativeInstallPath = (rawPath, fallback = "api") => {
    if (typeof rawPath !== "string") {
      return fallback
    }
    let trimmed = rawPath.trim()
    if (!trimmed) {
      return fallback
    }
    trimmed = trimmed.replace(/^~[\\/]?/, "").replace(/^[\\/]+/, "")
    if (!trimmed) {
      return fallback
    }
    const segments = trimmed.split(/[\\/]+/).filter(Boolean)
    if (!segments.length) {
      return fallback
    }
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return ""
    }
    return segments.join("/")
  }

  const validateInstallFolderName = (folderName) => {
    const normalized = typeof folderName === "string" ? folderName.trim() : ""
    if (!normalized) {
      return ""
    }
    if (normalized === "." || normalized === "..") {
      return ""
    }
    if (/[\\/]/.test(normalized) || normalized.includes("\0")) {
      return ""
    }
    return normalized
  }

  const validateStandalonePlugin = async (pluginDir) => {
    const configPath = path.resolve(pluginDir, "pinokio.js")
    const loaded = await kernel.loader.load(configPath)
    const config = loaded ? loaded.resolved : null
    const errors = []

    if (!isPlainObject(config)) {
      errors.push(buildError(
        "Standalone plugins must export a plain object from pinokio.js.",
        "Create a root pinokio.js that exports the plugin definition object."
      ))
      return buildValidation({
        type: "plugin",
        title: "Invalid Plugin",
        errors
      })
    }

    const declaredPath = typeof config.path === "string" ? config.path.trim() : ""
    if (declaredPath !== "plugin") {
      errors.push(buildError(
        'Standalone plugins must set `path: "plugin"`.',
        'Add `path: "plugin"` to the root pinokio.js.'
      ))
    }

    if (!Array.isArray(config.run)) {
      errors.push(buildError(
        "Standalone plugins must define a run array.",
        "Add a top-level `run: [...]` array to pinokio.js."
      ))
    }

    const topLevelFunctionKeys = Object.keys(config).filter((key) => {
      return typeof config[key] === "function"
    })
    if (topLevelFunctionKeys.length > 0) {
      errors.push(buildError(
        "Standalone plugins cannot use top-level function fields in the current runtime.",
        `Remove or move function fields out of pinokio.js: ${topLevelFunctionKeys.join(", ")}.`
      ))
    }

    return buildValidation({
      type: "plugin",
      title: "Invalid Plugin",
      errors
    })
  }

  const validateAppLauncher = async (appDir) => {
    const meta = await kernel.api.meta({ path: appDir })
    const errors = []
    const declaredPath = meta && typeof meta.declared_path === "string" ? meta.declared_path.trim() : ""
    const taskTemplateStats = await fs.promises.stat(path.resolve(appDir, "task.md")).catch(() => null)

    if (taskTemplateStats && taskTemplateStats.isFile()) {
      errors.push(buildError(
        "Task packages cannot be installed into PINOKIO_HOME/api.",
        "Import this repository from the Tasks flow instead of downloading it into api."
      ))
      if (declaredPath !== "tasks") {
        errors.push(buildError(
          'Task packages must set `path: "tasks"` in pinokio.json.',
          'Change the task path to `tasks` before importing it.'
        ))
      }
      return buildValidation({
        type: "task",
        title: "Invalid Task",
        errors
      })
    }

    if (meta && !meta.init_required) {
      if (declaredPath && declaredPath !== "api") {
        errors.push(buildError(
          'App launchers must use `path: "api"` when they declare a path.',
          'Change the launcher path to `api`, or remove the path field entirely.'
        ))
      }
      return buildValidation({
        type: "app",
        title: "Invalid App",
        errors
      })
    }

    if (declaredPath && declaredPath !== "api") {
      errors.push(buildError(
        `Downloaded content declares \`path: "${declaredPath}"\` and cannot be installed into PINOKIO_HOME/api.`,
        'Download this content through the correct flow, or change the launcher path to `api`.'
      ))
      return buildValidation({
        type: "app",
        title: "Invalid App",
        errors
      })
    }

    return buildValidation({
      type: "app",
      title: "Invalid App",
      errors
    })
  }

  const validateInstalledDirectory = async ({ absolutePath, installRoot }) => {
    const normalizedRoot = typeof installRoot === "string" ? installRoot.trim() : ""
    if (!absolutePath || !normalizedRoot) {
      return buildValidation({
        type: "unknown",
        title: "Invalid Download",
        errors: [
          buildError(
            "Install destination is invalid.",
            "Try downloading again into a standard Pinokio folder."
          )
        ]
      })
    }

    if (normalizedRoot === "plugin") {
      return validateStandalonePlugin(absolutePath)
    }
    if (normalizedRoot === "api") {
      return validateAppLauncher(absolutePath)
    }

    return buildValidation({
      type: normalizedRoot,
      title: "Invalid Download",
      errors: []
    })
  }

  const validateInstalledFolder = async ({ relativePath, folderName, fallbackRoot = "api" }) => {
    const normalizedPath = normalizeRelativeInstallPath(relativePath, fallbackRoot)
    const normalizedFolderName = validateInstallFolderName(folderName)
    if (!normalizedPath || !normalizedFolderName) {
      return buildValidation({
        type: "unknown",
        title: "Invalid Download",
        errors: [
          buildError(
            "Install destination is invalid.",
            "Try downloading again with a valid folder name."
          )
        ]
      })
    }
    const absolutePath = path.resolve(kernel.homedir, normalizedPath, normalizedFolderName)
    const topLevelRoot = normalizedPath.split("/")[0]
    return validateInstalledDirectory({
      absolutePath,
      installRoot: topLevelRoot
    })
  }

  return {
    normalizeRelativeInstallPath,
    validateInstallFolderName,
    validateInstalledDirectory,
    validateInstalledFolder
  }
}

module.exports = {
  createInstallValidationService
}
