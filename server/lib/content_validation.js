const fs = require("fs")
const path = require("path")
const clearModule = require("clear-module")

const {
  TASK_CONFIG_FILENAME,
  TASK_TEMPLATE_FILENAME,
  normalizeTaskId,
  validateTaskConfig,
  validateTaskSchema,
} = require("./task_packages")

function createContentValidationService({ kernel }) {
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const exists = async (filepath) => {
    try {
      await fs.promises.stat(filepath)
      return true
    } catch (_) {
      return false
    }
  }

  const isPlainObject = (value) => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
  }

  const buildError = (message, fix, extra = {}) => {
    return {
      message,
      fix,
      ...extra,
    }
  }

  const buildInvalid = ({ type, subjectTitle, errors, folderPath, manifestPath, detailUrl, extra = {} }) => {
    const normalizedErrors = Array.isArray(errors) ? errors.filter(Boolean) : []
    const title = type === "task"
      ? "Invalid Task"
      : type === "plugin"
        ? "Invalid Plugin"
        : "Invalid App"
    const article = type === "app" ? "app" : type === "plugin" ? "plugin" : "task"
    return {
      valid: false,
      type,
      title,
      subjectTitle: subjectTitle || title,
      summary: `This ${article} is installed, but Pinokio cannot use it until its manifest is fixed.`,
      message: normalizedErrors.length > 0 ? normalizedErrors[0].message : `${title}.`,
      errors: normalizedErrors,
      folderPath: folderPath || "",
      manifestPath: manifestPath || (normalizedErrors.find((entry) => entry && entry.file) || {}).file || "",
      detailUrl: detailUrl || "",
      ...extra,
    }
  }

  const buildValid = (extra = {}) => {
    return {
      valid: true,
      errors: [],
      ...extra,
    }
  }

  const loadJsonFile = async (filepath) => {
    if (!(await exists(filepath))) {
      return { exists: false, value: null, error: null }
    }
    try {
      const raw = await fs.promises.readFile(filepath, "utf8")
      return {
        exists: true,
        value: JSON.parse(raw),
        error: null,
      }
    } catch (error) {
      return {
        exists: true,
        value: null,
        error,
      }
    }
  }

  const loadJsFile = async (filepath) => {
    if (!(await exists(filepath))) {
      return { exists: false, value: null, error: null }
    }
    clearModule(filepath)
    try {
      const loaded = require(filepath)
      try {
        return {
          exists: true,
          value: new loaded(),
          error: null,
        }
      } catch (_) {
        return {
          exists: true,
          value: loaded,
          error: null,
        }
      }
    } catch (error) {
      return {
        exists: true,
        value: null,
        error,
      }
    }
  }

  const normalizePluginPath = (value) => {
    let normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) {
      return ""
    }
    normalized = normalized.replace(/\\/g, "/")
    normalized = normalized.replace(/^\/run(?=\/)/, "")
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`
    }
    normalized = normalized.replace(/\/{2,}/g, "/").replace(/\/+$/, "")
    if (!normalized) {
      return ""
    }
    if (!normalized.endsWith("/pinokio.js")) {
      normalized = `${normalized}/pinokio.js`
    }
    return normalized
  }

  const normalizeBundledPluginSpec = (value) => {
    if (typeof value !== "string") {
      return ""
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return ""
    }
    const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"))
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) {
      return ""
    }
    return normalized
  }

  const buildPluginContext = ({ normalizedPath, absolutePath, config }) => {
    const pluginDir = path.dirname(absolutePath)
    const title = config && typeof config.title === "string" && config.title.trim()
      ? config.title.trim()
      : path.basename(pluginDir)
    const context = {
      title,
      pluginPath: normalizedPath,
      absolutePath,
      dir: pluginDir,
      config,
      hasInstall: Array.isArray(config && config.install),
      hasUpdate: Array.isArray(config && config.update),
      hasUninstall: Array.isArray(config && config.uninstall),
      image: null,
    }

    if (config && typeof config.icon === "string" && config.icon.trim()) {
      if (normalizedPath.startsWith("/plugin/")) {
        const relativeDir = path.posix.dirname(normalizedPath.slice(1))
        context.image = `/asset/${relativeDir}/${config.icon.trim()}`
      } else if (normalizedPath.startsWith("/api/")) {
        const segments = normalizedPath.replace(/^\/+/, "").split("/")
        const appName = segments[1] || ""
        const workspacePath = appName ? kernel.path("api", appName) : ""
        const iconAbsolutePath = path.resolve(pluginDir, config.icon.trim())
        const relativeIconPath = workspacePath ? path.relative(workspacePath, iconAbsolutePath) : ""
        if (relativeIconPath && !relativeIconPath.startsWith("..") && !path.isAbsolute(relativeIconPath)) {
          context.image = `/api/${appName}/${relativeIconPath.split(path.sep).join("/")}?raw=true`
        }
      }
    }

    return context
  }

  const validatePluginByPath = async (requestedPath) => {
    const normalizedPath = normalizePluginPath(requestedPath)
    const fallbackTitle = normalizedPath
      ? path.basename(path.posix.dirname(normalizedPath))
      : "Plugin"
    if (!normalizedPath || (!normalizedPath.startsWith("/plugin/") && !normalizedPath.startsWith("/api/"))) {
      return buildInvalid({
        type: "plugin",
        subjectTitle: fallbackTitle,
        errors: [
          buildError(
            "Plugin path is invalid.",
            "Open this plugin from a valid Pinokio plugin path."
          ),
        ],
        detailUrl: "/plugins",
      })
    }

    const absolutePath = kernel.path(normalizedPath.replace(/^\/+/, ""))
    const folderPath = path.dirname(absolutePath)
    const loaded = await loadJsFile(absolutePath)
    if (!loaded.exists) {
      return buildInvalid({
        type: "plugin",
        subjectTitle: fallbackTitle,
        errors: [
          buildError(
            "pinokio.js was not found for this plugin.",
            "Add a root pinokio.js file for the plugin.",
            { file: absolutePath }
          ),
        ],
        folderPath,
        manifestPath: absolutePath,
        detailUrl: `/plugin?path=${encodeURIComponent(normalizedPath)}`,
      })
    }
    if (loaded.error) {
      return buildInvalid({
        type: "plugin",
        subjectTitle: fallbackTitle,
        errors: [
          buildError(
            `pinokio.js could not be loaded: ${loaded.error.message}`,
            "Fix the JavaScript syntax or module export in pinokio.js.",
            { file: absolutePath }
          ),
        ],
        folderPath,
        manifestPath: absolutePath,
        detailUrl: `/plugin?path=${encodeURIComponent(normalizedPath)}`,
      })
    }

    const config = loaded.value
    const errors = []
    if (!isPlainObject(config)) {
      errors.push(buildError(
        "pinokio.js must export a plain object.",
        "Export a plugin object from pinokio.js.",
        { file: absolutePath }
      ))
    } else {
      if (!Array.isArray(config.run)) {
        errors.push(buildError(
          "Plugins must define a top-level run array.",
          "Add `run: [...]` to pinokio.js.",
          { file: absolutePath }
        ))
      }
      const topLevelFunctionKeys = Object.keys(config).filter((key) => typeof config[key] === "function")
      if (topLevelFunctionKeys.length > 0) {
        errors.push(buildError(
          `Top-level function fields are not supported: ${topLevelFunctionKeys.join(", ")}.`,
          "Move those functions out of pinokio.js or replace them with data.",
          { file: absolutePath }
        ))
      }
      if (normalizedPath.startsWith("/plugin/")) {
        const declaredPath = typeof config.path === "string" ? config.path.trim() : ""
        if (declaredPath !== "plugin") {
          errors.push(buildError(
            'Standalone plugins must set `path: "plugin"`.',
            'Add `path: "plugin"` to pinokio.js.',
            { file: absolutePath }
          ))
        }
      }
    }

    const context = buildPluginContext({ normalizedPath, absolutePath, config })
    if (errors.length > 0) {
      return buildInvalid({
        type: "plugin",
        subjectTitle: context.title,
        errors,
        folderPath,
        manifestPath: absolutePath,
        detailUrl: `/plugin?path=${encodeURIComponent(normalizedPath)}`,
        extra: {
          context,
        },
      })
    }
    return buildValid({
      type: "plugin",
      subjectTitle: context.title,
      folderPath,
      manifestPath: absolutePath,
      detailUrl: `/plugin?path=${encodeURIComponent(normalizedPath)}`,
      context,
    })
  }

  const validateAppByName = async (name) => {
    const appName = typeof name === "string" ? name.trim() : ""
    const workspacePath = kernel.path("api", appName)
    const launcherPath = await kernel.api.launcher_path(appName)
    const launcherScriptPath = path.resolve(launcherPath, "pinokio.js")
    const metaJsonPath = path.resolve(launcherPath, "pinokio_meta.json")
    const appJsonPath = path.resolve(launcherPath, "pinokio.json")

    const [launcherScript, metaJson, appJson] = await Promise.all([
      loadJsFile(launcherScriptPath),
      loadJsonFile(metaJsonPath),
      loadJsonFile(appJsonPath),
    ])

    const anyManifestExists = launcherScript.exists || metaJson.exists || appJson.exists
    if (!anyManifestExists) {
      return buildValid({
        type: "app",
        subjectTitle: appName,
        folderPath: workspacePath,
        manifestPath: "",
        detailUrl: `/p/${encodeURIComponent(appName)}`,
        uninitialized: true,
      })
    }

    const errors = []
    if (launcherScript.exists && launcherScript.error) {
      errors.push(buildError(
        `pinokio.js could not be loaded: ${launcherScript.error.message}`,
        "Fix the JavaScript syntax or export in pinokio.js.",
        { file: launcherScriptPath }
      ))
    }
    if (metaJson.exists && metaJson.error) {
      errors.push(buildError(
        `pinokio_meta.json could not be parsed: ${metaJson.error.message}`,
        "Fix the JSON syntax in pinokio_meta.json.",
        { file: metaJsonPath }
      ))
    }
    if (appJson.exists && appJson.error) {
      errors.push(buildError(
        `pinokio.json could not be parsed: ${appJson.error.message}`,
        "Fix the JSON syntax in pinokio.json.",
        { file: appJsonPath }
      ))
    }

    if (metaJson.exists && !metaJson.error && !isPlainObject(metaJson.value)) {
      errors.push(buildError(
        "pinokio_meta.json must contain an object.",
        "Replace pinokio_meta.json with a JSON object.",
        { file: metaJsonPath }
      ))
    }
    if (appJson.exists && !appJson.error && !isPlainObject(appJson.value)) {
      errors.push(buildError(
        "pinokio.json must contain an object.",
        "Replace pinokio.json with a JSON object.",
        { file: appJsonPath }
      ))
    }

    const merged = Object.assign(
      {},
      isPlainObject(launcherScript.value) ? launcherScript.value : {},
      isPlainObject(metaJson.value) ? metaJson.value : {},
      isPlainObject(appJson.value) ? appJson.value : {}
    )
    const subjectTitle = typeof merged.title === "string" && merged.title.trim() ? merged.title.trim() : appName

    if (errors.length === 0) {
      const declaredPath = typeof merged.path === "string" ? merged.path.trim() : ""
      if (declaredPath && declaredPath !== "api") {
        errors.push(buildError(
          'App launchers must use `path: "api"` when they declare a path.',
          'Change the path to `api`, or remove the path field.',
          { file: appJson.exists ? appJsonPath : launcherScriptPath }
        ))
      }
      if ("plugins" in merged) {
        if (!Array.isArray(merged.plugins)) {
          errors.push(buildError(
            "App plugins must be declared as an array.",
            "Set `plugins` to an array of relative pinokio.js paths.",
            { file: launcherScriptPath }
          ))
        } else {
          merged.plugins.forEach((pluginSpec, index) => {
            const normalizedSpec = normalizeBundledPluginSpec(pluginSpec)
            if (!normalizedSpec || path.posix.basename(normalizedSpec) !== "pinokio.js") {
              errors.push(buildError(
                `plugins[${index}] must point to a relative pinokio.js file.`,
                "Use entries like `plugins/no-gateway/pinokio.js`.",
                { file: launcherScriptPath }
              ))
            }
          })
        }
      }
    }

    if (errors.length > 0) {
      return buildInvalid({
        type: "app",
        subjectTitle,
        errors,
        folderPath: workspacePath,
        manifestPath: errors.find((entry) => entry && entry.file)?.file || launcherScriptPath,
        detailUrl: `/p/${encodeURIComponent(appName)}`,
        extra: {
          context: {
            name: appName,
            title: subjectTitle,
            workspacePath,
            launcherPath,
          },
        },
      })
    }

    return buildValid({
      type: "app",
      subjectTitle,
      folderPath: workspacePath,
      manifestPath: launcherScript.exists
        ? launcherScriptPath
        : (appJson.exists ? appJsonPath : metaJsonPath),
      detailUrl: `/p/${encodeURIComponent(appName)}`,
      context: {
        name: appName,
        title: subjectTitle,
        workspacePath,
        launcherPath,
      },
    })
  }

  const validateTaskById = async (id) => {
    const normalizedId = normalizeTaskId(id)
    const taskDir = normalizedId ? kernel.path("tasks", normalizedId) : kernel.path("tasks")
    const taskConfigPath = normalizedId ? path.resolve(taskDir, TASK_CONFIG_FILENAME) : ""
    const taskTemplatePath = normalizedId ? path.resolve(taskDir, TASK_TEMPLATE_FILENAME) : ""
    if (!normalizedId) {
      return buildInvalid({
        type: "task",
        subjectTitle: "Task",
        errors: [
          buildError(
            "Task id is invalid.",
            "Open a valid installed task."
          ),
        ],
        folderPath: kernel.path("tasks"),
        detailUrl: "/tasks",
      })
    }

    const errors = []
    const configLoad = await loadJsonFile(taskConfigPath)
    let template = ""
    let templateExists = false
    try {
      template = await fs.promises.readFile(taskTemplatePath, "utf8")
      templateExists = true
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        errors.push(buildError(
          `task.md could not be read: ${error.message}`,
          "Fix task.md and reopen the task.",
          { file: taskTemplatePath }
        ))
      }
    }

    if (!configLoad.exists) {
      errors.push(buildError(
        "pinokio.json was not found for this task.",
        "Add a root pinokio.json file to the task.",
        { file: taskConfigPath }
      ))
    } else if (configLoad.error) {
      errors.push(buildError(
        `pinokio.json could not be parsed: ${configLoad.error.message}`,
        "Fix the JSON syntax in pinokio.json.",
        { file: taskConfigPath }
      ))
    }

    if (!templateExists) {
      errors.push(buildError(
        "task.md was not found for this task.",
        "Add a root task.md file to the task.",
        { file: taskTemplatePath }
      ))
    }

    const subjectTitle = configLoad.value && typeof configLoad.value.title === "string" && configLoad.value.title.trim()
      ? configLoad.value.title.trim()
      : normalizedId

    if (errors.length === 0) {
      let config
      try {
        config = validateTaskConfig(configLoad.value)
      } catch (error) {
        const validationErrors = error && error.validation && Array.isArray(error.validation.errors)
          ? error.validation.errors
          : [buildError(error.message || "Task configuration is invalid.", "Fix pinokio.json and reopen the task.", { file: taskConfigPath })]
        validationErrors.forEach((entry) => {
          errors.push({
            ...entry,
            file: entry && entry.file ? entry.file : taskConfigPath,
          })
        })
      }
      if (config) {
        try {
          validateTaskSchema(config, template)
        } catch (error) {
          const validationErrors = error && error.validation && Array.isArray(error.validation.errors)
            ? error.validation.errors
            : [buildError(error.message || "Task schema is invalid.", "Fix pinokio.json and task.md so they match.", { file: taskConfigPath })]
          validationErrors.forEach((entry) => {
            errors.push({
              ...entry,
              file: entry && entry.file ? entry.file : taskConfigPath,
            })
          })
        }
      }
    }

    if (errors.length > 0) {
      return buildInvalid({
        type: "task",
        subjectTitle,
        errors,
        folderPath: taskDir,
        manifestPath: errors.find((entry) => entry && entry.file)?.file || taskConfigPath,
        detailUrl: `/task?id=${encodeURIComponent(normalizedId)}`,
        extra: {
          context: {
            id: normalizedId,
            dir: taskDir,
          },
        },
      })
    }

    return buildValid({
      type: "task",
      subjectTitle,
      folderPath: taskDir,
      manifestPath: taskConfigPath,
      detailUrl: `/task?id=${encodeURIComponent(normalizedId)}`,
      context: {
        id: normalizedId,
        dir: taskDir,
      },
    })
  }

  const validateRunPath = async (pathComponents) => {
    if (!Array.isArray(pathComponents) || pathComponents.length === 0) {
      return buildValid()
    }
    const normalized = pathComponents.filter((part) => typeof part === "string" && part.length > 0)
    if (normalized.length === 0) {
      return buildValid()
    }
    if (normalized[0] === "plugin") {
      return validatePluginByPath(`/${normalized.join("/")}`)
    }
    if (normalized[0] === "api" && normalized.length > 1) {
      const lastSegment = normalized[normalized.length - 1]
      if (lastSegment === "pinokio.js" && normalized.includes("plugins")) {
        return validatePluginByPath(`/${normalized.join("/")}`)
      }
      return validateAppByName(normalized[1])
    }
    return buildValid()
  }

  return {
    validateAppByName,
    validatePluginByPath,
    validateTaskById,
    validateRunPath,
  }
}

module.exports = {
  createContentValidationService,
}
