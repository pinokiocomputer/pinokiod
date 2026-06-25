const path = require('path')
const portfinder = require('portfinder-cp')
const fs = require('fs')
const Util = require('./util')
const ManagedSkills = require('./managed_skills')
const TEMP_ENV_KEYS = ["TMP", "TEMP", "TMPDIR", "PIP_TMPDIR"]
const CACHE_ENV_KEYS = ["UV_CACHE_DIR", "PIP_CACHE_DIR"]
const CACHE_PREFLIGHT_KEYS = TEMP_ENV_KEYS.concat(CACHE_ENV_KEYS)
const SCRIPT_AUTOLAUNCH_KEY = "PINOKIO_SCRIPT_AUTOLAUNCH"
const SCRIPT_AUTOLAUNCH_ENABLED_KEY = "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED"
const SCRIPT_REQUIREMENTS_KEY = "PINOKIO_SCRIPT_REQUIRES"

const parseBooleanFlag = (value) => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }
  return null
}

const getScriptAutolaunch = (env) => {
  return typeof (env && env[SCRIPT_AUTOLAUNCH_KEY]) === "string"
    ? env[SCRIPT_AUTOLAUNCH_KEY].trim()
    : ""
}

const getScriptAutolaunchEnabled = (env) => {
  const script = getScriptAutolaunch(env)
  if (!script) {
    return false
  }
  const explicit = parseBooleanFlag(env && env[SCRIPT_AUTOLAUNCH_ENABLED_KEY])
  return explicit === null ? true : explicit
}

const parseAutolaunchList = (value) => {
  if (typeof value !== "string") {
    return []
  }
  const seen = new Set()
  const values = []
  for (const part of value.split(",")) {
    const raw = part.trim()
    if (!raw) {
      continue
    }
    let id = raw
    try {
      id = decodeURIComponent(raw)
    } catch (_) {}
    id = String(id || "").trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    values.push(id)
  }
  return values
}

const formatAutolaunchList = (ids) => {
  if (!Array.isArray(ids)) {
    return ""
  }
  return ids
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => encodeURIComponent(id))
    .join(",")
}

const getScriptRequirements = (env) => {
  return parseAutolaunchList(env && env[SCRIPT_REQUIREMENTS_KEY])
}

const formatCachePreflightError = (error) => {
  if (!error) {
    return ""
  }
  const parts = []
  if (error.code) {
    parts.push(`code=${error.code}`)
  }
  if (typeof error.errno !== "undefined") {
    parts.push(`errno=${error.errno}`)
  }
  if (error.syscall) {
    parts.push(`syscall=${error.syscall}`)
  }
  if (error.path) {
    parts.push(`path=${error.path}`)
  }
  if (error.dest) {
    parts.push(`dest=${error.dest}`)
  }
  if (error.message) {
    parts.push(`message=${error.message}`)
  }
  return parts.join(" ")
}

const logCachePreflight = (message) => {
  console.log(`[Pinokio cache preflight] ${message}`)
}

const probeCacheDir = async (dirPath) => {
  const probeDir = path.resolve(
    dirPath,
    `.pinokio-cache-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  const probeFile = path.resolve(probeDir, "probe.tmp")
  const renamedFile = path.resolve(probeDir, "probe-renamed.tmp")
  const steps = [
    ["create probe directory", () => fs.promises.mkdir(probeDir, { recursive: false })],
    ["write probe file", () => fs.promises.writeFile(probeFile, "pinokio")],
    ["append probe file", () => fs.promises.appendFile(probeFile, "-cache-probe")],
    ["rename probe file", () => fs.promises.rename(probeFile, renamedFile)],
    ["delete probe file", () => fs.promises.unlink(renamedFile)],
    ["remove probe directory", () => fs.promises.rmdir(probeDir)]
  ]

  for (const [step, run] of steps) {
    try {
      await run()
    } catch (error) {
      await fs.promises.rm(probeDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, step, error }
    }
  }
  return { ok: true }
}

const managedCacheEnvDefaults = () => {
  const defaults = {}
  for (const key of CACHE_PREFLIGHT_KEYS) {
    defaults[key] = `./cache/${key}`
  }
  return defaults
}

const ensureCachePreflightDir = async (key, targetPath) => {
  logCachePreflight(`${key}: target=${targetPath}`)
  try {
    await fs.promises.mkdir(targetPath, { recursive: true })
    logCachePreflight(`${key}: mkdir ok`)
  } catch (error) {
    logCachePreflight(`${key}: mkdir failed ${formatCachePreflightError(error)}`)
  }

  const firstProbe = await probeCacheDir(targetPath)
  if (firstProbe.ok) {
    logCachePreflight(`${key}: probe ok`)
    return { key, path: targetPath, repaired: false, ok: true }
  }

  logCachePreflight(`${key}: probe failed step="${firstProbe.step}" ${formatCachePreflightError(firstProbe.error)}`)
  logCachePreflight(`${key}: repair delete start path=${targetPath}`)

  try {
    await fs.promises.rm(targetPath, { recursive: true, force: true })
    logCachePreflight(`${key}: repair delete ok`)
  } catch (error) {
    logCachePreflight(`${key}: repair delete failed ${formatCachePreflightError(error)}`)
    return { key, path: targetPath, repaired: false, ok: false, step: "repair delete", error }
  }

  try {
    await fs.promises.mkdir(targetPath, { recursive: true })
    logCachePreflight(`${key}: repair mkdir ok`)
  } catch (error) {
    logCachePreflight(`${key}: repair mkdir failed ${formatCachePreflightError(error)}`)
    return { key, path: targetPath, repaired: true, ok: false, step: "repair mkdir", error }
  }

  const secondProbe = await probeCacheDir(targetPath)
  if (secondProbe.ok) {
    logCachePreflight(`${key}: repair probe ok`)
    return { key, path: targetPath, repaired: true, ok: true }
  }

  logCachePreflight(`${key}: repair probe failed step="${secondProbe.step}" ${formatCachePreflightError(secondProbe.error)}`)
  return { key, path: targetPath, repaired: true, ok: false, step: secondProbe.step, error: secondProbe.error }
}

const ensurePinokioCacheDirs = async (kernel, options = {}) => {
  if (!kernel || !kernel.homedir) {
    return {}
  }
  const throwOnFailure = !!options.throwOnFailure
  const root = path.resolve(kernel.homedir)
  const cacheRoot = path.resolve(root, "cache")
  const envPath = path.resolve(root, "ENVIRONMENT")
  const defaults = managedCacheEnvDefaults()
  logCachePreflight(`start root=${root}`)
  await Util.update_env(envPath, defaults)
  logCachePreflight(`ENVIRONMENT updated keys=${CACHE_PREFLIGHT_KEYS.join(",")}`)
  try {
    await fs.promises.mkdir(cacheRoot, { recursive: true })
    logCachePreflight(`cache root mkdir ok path=${cacheRoot}`)
  } catch (error) {
    logCachePreflight(`cache root mkdir failed path=${cacheRoot} ${formatCachePreflightError(error)}`)
  }

  if (process.platform === "darwin") await fs.promises.writeFile(path.resolve(root, ".metadata_never_index"), "", { flag: "a" }).catch(() => {})

  const errors = []
  const results = []

  for (const key of CACHE_PREFLIGHT_KEYS) {
    const targetPath = path.resolve(cacheRoot, key)
    const result = await ensureCachePreflightDir(key, targetPath)
    results.push(result)
    if (!result.ok) {
      errors.push(result)
    }
  }

  if (errors.length > 0) {
    kernel.cacheDirErrors = errors
    const message = errors
      .map((error) => `${error.key}: ${error.path} (${error.step || "unknown"} ${formatCachePreflightError(error.error)})`)
      .join(", ")
    logCachePreflight(`failed ${message}`)
    if (throwOnFailure) {
      throw new Error(`Pinokio could not create writable cache directories: ${message}`)
    }
  } else {
    kernel.cacheDirErrors = []
    logCachePreflight(`complete ok checked=${results.length} repaired=${results.filter((result) => result.repaired).length}`)
  }

  kernel.cacheDirPreflight = results
  const env = await get(root, kernel)
  return { env, errors, results }
}
const ENVS = async () => {
//  const primary_port = 80
//  const secondary_port = 42000
//  const available = await portfinder.isAvailablePromise({ host: "0.0.0.0", port: primary_port })
//  let port
//  if (available) {
//    port = primary_port
//  } else {
//    port = secondary_port 
//  }
  return [{
    type: ["system"],
    key: "HOMEBREW_CACHE",
    hidden: true,
    val: "./cache/HOMEBREW_CACHE"
  }, {
    type: ["system"],
    key: "XDG_CACHE_HOME",
    hidden: true,
    val: "./cache/XDG_CACHE_HOME"
  }, {
    type: ["system"],
    key: "PIP_CACHE_DIR",
    hidden: true,
    val: "./cache/PIP_CACHE_DIR"
  }, {
    type: ["system"],
    key: "UV_CACHE_DIR",
    hidden: true,
    val: "./cache/UV_CACHE_DIR"
  }, {
    type: ["system"],
    key: "PIP_TMPDIR",
    hidden: true,
    val: "./cache/PIP_TMPDIR"
  }, {
    type: ["system"],
    key: "TMPDIR",
    hidden: true,
    val: "./cache/TMPDIR"
  }, {
    type: ["system"],
    key: "TEMP",
    hidden: true,
    val: "./cache/TEMP"
  }, {
    type: ["system"],
    key: "TMP",
    hidden: true,
    val: "./cache/TMP"
  }, {
    type: ["system"],
    key: "XDG_DATA_HOME",
    hidden: true,
    val: "./cache/XDG_DATA_HOME"
  }, {
    type: ["system"],
    key: "XDG_CONFIG_HOME",
    hidden: true,
    val: "./cache/XDG_CONFIG_HOME"
  }, {
    type: ["system"],
    key: "XDG_STATE_HOME",
    hidden: true,
    val: "./cache/XDG_STATE_HOME"
  }, {
    type: ["system"],
    key: "PIP_CONFIG_FILE",
    hidden: true,
    val: "./pipconfig"
  }, {
    type: ["system"],
    key: "CONDARC",
    hidden: true,
    val: "./condarc"
  }, {
    type: ["system"],
    key: "PS1",
    hidden: true,
    val: "<<PINOKIO_SHELL>> "
  }, {
    type: ["system"],
    key: "GRADIO_ANALYTICS_ENABLED",
    val: "False"
  }, {
    type: ["system"],
    key: "GRADIO_ALLOWED_PATHS",
    val: "./",
    comment: [
      "##########################################################################",
      "#",
      "# GRADIO_ALLOWED_PATHS",
      "#",
      "# This allows every Gradio app installed under Pinokio to serve files",
      "# outside of each app's root folder, which is useful for many cases.",
      "# Do not touch this unless you want to add additional paths",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["app"],
    key: "PINOKIO_SCRIPT_AUTOLAUNCH",
    val: "",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SCRIPT_AUTOLAUNCH",
      "# the relative file path for auto launching any script",
      "# the specified script will automatically run when pinokio first launches",
      "#",
      "##########################################################################",
    ]
  }, {
    type: ["app"],
    key: SCRIPT_REQUIREMENTS_KEY,
    val: "",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SCRIPT_REQUIRES",
      "# comma-separated local app folder IDs this app requires before launch",
      "# requirements do not automatically enable run-at-startup for those apps",
      "#",
      "##########################################################################",
    ]
  }, {
    type: ["system"],
    key: "PINOKIO_SHARE_VAR",
    val: "url",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SHARE_VAR",
      "#",
      "# When you set this local variable from any script, it will trigger Pinokio",
      "# share actions (local sharing, cloudflare, ...)",
      "#",
      "# You can customize whether to avoid this using PINOKIO_SHARE_CLOUDFLARE",
      "# and PINOKIO_SHARE_LOCAL",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "PINOKIO_SHARE_CLOUDFLARE",
    val: "false",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SHARE_CLOUDFLARE",
      "# Set this variable to share the app publicly via cloudflare tunnel.",
      "#",
      "##########################################################################",
    ]
  }, {
    type: ["app"],
    key: "PINOKIO_SHARE_PASSCODE",
    val: "",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SHARE_PASSCODE",
      "#",
      "# By default, your publicly shared app will be 100% open to anyone",
      "# with the link via Cloudflare.",
      "#",
      "# You can add authorization by protecting it with a passcode.",
      "# Set this value, and any access to the app will require a pass code input",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "PINOKIO_SCRIPT_DEFAULT",
    val: "true",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SCRIPT_DEFAULT",
      "# If this variable is false, 'default': true menu items in pinokio.js",
      "# will NOT automatically run",
      "#",
      "##########################################################################",
    ]
  }, {
    type: ["system"],
    key: "PINOKIO_DRIVE",
    val: "./drive",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_DRIVE",
      "#",
      "# The virtual drive path.",
      "# Change it if you want to use a different path.",
      "# You can even enter an absolute path to use a folder outside of pinokio",
      "# or an entirely different disk drive",
      "#",
      "##########################################################################",
    ],
//  }, {
//    type: ["system"],
//    key: "PINOKIO_PORT",
//    val: `${port}`,
//    comment: [
//      "##########################################################################",
//      "#",
//      "# PINOKIO_PORT",
//      "#",
//      "# The server port Pinokio will use. By default it's 80 but you can",
//      "# Change it to anything else",
//      "#",
//      "##########################################################################",
//    ],
  }, {
    type: ["system", "app"],
    key: "GRADIO_TEMP_DIR",
    val: "./cache/GRADIO_TEMP_DIR",
    comment: [
      "##########################################################################",
      "#",
      "# GRADIO_TEMP_DIR",
      "# All the files uploaded through gradio goes here.",
      "#",
      "# Delete this line to store the files under PINOKIO_HOME/cache/GRADIO_TEMPDIR",
      "# or change the path if you want to use a different path",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "HF_HOME",
    val: "./cache/HF_HOME",
    comment: [
      "##########################################################################",
      "#",
      "# HF_HOME",
      "#",
      "# Huggingface cache",
      "# All the model files automatically downloaded through libraries like",
      "# diffusers, transformers, etc. will be stored under this path",
      "#",
      "# You can save disk space by deleting this line, which will store all",
      "# huggingface files under PINOKIO_HOME/cache/HF_HOME without redundancy.",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system"],
    key: "HF_TOKEN_PATH",
    val: "./cache/HF_AUTH/token",
    comment: [
      "##########################################################################",
      "#",
      "# HF_TOKEN_PATH",
      "#",
      "# Hugging Face authentication token file",
      "# Pinokio keeps this shared across apps so each app can customize HF_HOME",
      "# for model/cache files without changing the logged-in Hugging Face account.",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "TORCH_HOME",
    val: "./cache/TORCH_HOME",
    comment: [
      "##########################################################################",
      "#",
      "# TORCH_HOME",
      "#",
      "# Torch hub cache",
      "# All the files automatically downloaded by pytorch will be stored here",
      "#",
      "# You can save disk space by deleting this line, which will store all",
      "# torch hub files under PINOKIO_HOME/cache/TORCH_HOME without redundancy.",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "PINOKIO_SHARE_LOCAL",
    val: "false",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SHARE_LOCAL",
      "# Set this variable to true to share the app on the local network.",
      "#",
      "##########################################################################",
    ],
  }, {
    type: ["system", "app"],
    key: "PINOKIO_SHARE_LOCAL_PORT",
    val: "",
    comment: [
      "##########################################################################",
      "#",
      "# PINOKIO_SHARE_LOCAL_PORT",
      "# Set this variable to use fixed port for the local network sharing feature",
      "# If not specified, a random port will be assigned to the local proxy used",
      "# for local sharing.",
      "#",
      "##########################################################################",
    ],
  }];
}
//const ENV = (homedir) => {
//  const lines = ENVS.map((e) => {
//    if (e.type) {
//      if (e.type === "cache_folder") {
//        return `${e.key}=${path.resolve(homedir, "cache", e.key)}`
//      }
//    } else {
//      if (e.val) {
//        return `${e.key}=${e.val(homedir)}`
//      }
//    }
//  })
//  return lines.join("\n")
//}

// type := system|app
const ENV = async (type, homedir, kernel) => {
  const envs = await ENVS()
  let filtered_envs = []
  let irrelevant_keys = []
  for(let e of envs) {
    if (e.type.includes(type)) {
      filtered_envs.push(e)
    } else {
      irrelevant_keys.push(e.key)
    }
  }
//  let filtered_envs = envs.filter((e) => {
//    return e.type.includes(type)
//  })

  let lines = []
  let system_env
  let keys = new Set()
  for(let e of filtered_envs) {
    let comment = ""
    if (e.comment && Array.isArray(e.comment)) {
      comment = "\n" + e.comment.join("\n") + "\n"
    }

    let val
    if (typeof e.val === "function") {
      val = e.val(type)
    } else {
      val = e.val
    }

    // if app environment,
    //  if e.key exists on system env, use that
    //  if e.key does NOT exist on system env, use from the hardcoded default option
    if (type === 'app') {
      system_env = await get_raw(homedir, kernel)
      if (e.key in system_env) {
        val = system_env[e.key]
        keys.add(e.key)
      }
    }

    let kv = `${e.key}=${val}`
    lines.push(comment+kv)
  }

  // In case of type: app, inherit any other custom ENVIRONMENT variable not yet included
  if (type === "app" && system_env) {
    for(let key in system_env) {
      if (!keys.has(key)) {
        // the key has not been processed, need to add to the lines
        if (irrelevant_keys.includes(key)) {
        } else {
          let val = system_env[key]
          let kv = `${key}=${val}`
          lines.push(kv)
        }
      }
    }
  }

  return lines.join("\n")
}
const init_folders = async (homedir, kernel) => {
  const current_env = await get(homedir, kernel)
  for(let key in current_env) {
    let val = current_env[key]

    let is_absolute = path.isAbsolute(val)
    let is_relative = val.startsWith("./")
    if (is_absolute || is_relative) {

      // skip condarc and pipconfig => special case
      if (["PIP_CONFIG_FILE", "CONDARC", "HF_TOKEN_PATH"].includes(key)) {
        continue
      }
      // it's a path
      let full_path = path.resolve(homedir, val)
      await fs.promises.mkdir(full_path, { recursive: true }).catch((e) => {})
    }
  }
}

// Get the actual environment variable at specific path
const get2 = async (filepath, kernel) => {
  let api_path = Util.api_path(filepath, kernel)
  let default_env = await get(kernel.homedir, kernel)
  let api_env = await get(api_path, kernel)
  let process_env = kernel.envs || process.env
  let current_env = Object.assign({}, process_env, default_env, api_env)
  for(let key in current_env) {
    let val = current_env[key]
    if (typeof val === 'String' && val.trim() === "") {
      delete current_env[key]
    }
  }
  return current_env
}

// return env object
// 1. if the value starts with ./ => convert to absolute path
// 2. if the value is empty => don't return the kv pair for that value
const get = async (homedir, kernel) => {
  const got_root = await get_root({ path: homedir }, kernel)
  const root = got_root.root
  const env_path = path.resolve(root, "ENVIRONMENT")
  const current_env = await Util.parse_env(env_path)
  for(let key in current_env) {
    let val = current_env[key]
    if (val.startsWith("./")) {
      let full_path = path.resolve(homedir, val)
      current_env[key] = full_path
    }
    if (val.trim() === "") {
      delete current_env[key]
    }
  }
  return current_env
}

const get_raw = async (homedir, kernel) => {
  const got_root = await get_root({ path: homedir }, kernel)
  const root = got_root.root
  const env_path = path.resolve(root, "ENVIRONMENT")
  const current_env = await Util.parse_env(env_path)
  for(let key in current_env) {
    let val = current_env[key]
    if (val.trim() === "") {
      delete current_env[key]
    }
  }
  return current_env
}

const requirements = async (script, cwd, kernel) => {
  let pre_items = []
  let requires_instantiation = false
  if (script) {
    let pre
    if (Array.isArray(script.pre)) {
      pre = script.pre
    } else if (Array.isArray(script.env)) {
      pre = script.env
    }
    if (pre) {
      let env = await get2(cwd, kernel)
      for(let item of pre) {
        if (!item || typeof item !== "object") {
          continue
        }
        let env_key
        if (typeof item.env === "string" && item.env) {
          env_key = item.env
        } else if (typeof item.key === "string" && item.key) {
          env_key = item.key
          item.env = item.key
        }
        if (env_key) {
          // if index is not set, use 0 as default (for key)
          if (!item.index) {
            item.index = 0
          }
          if (typeof item.host === "string" && item.host.trim()) {
            const host = item.host.trim()
            let parsedHost = ""
            try {
              const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(host);
              const url = new URL(hasProtocol ? host : `https://${host}`);
              parsedHost = url.host
            } catch (e) {
              item.host = ""
            }
            if (parsedHost) {
              item.host = parsedHost
              item.val = await kernel.kv.get(item.host, item.index)
            }
          } else {
            item.host = ""
          }
          if (env[env_key]) {
            item.val = env[env_key]
          } else {
            if (item.default) {
              item.val = item.default
            }
            requires_instantiation = true
          }
          pre_items.push(item)
        }
      }
    }
  }
  return { items: pre_items, requires_instantiation }
}
const get_root = async (options, kernel) => {
  let root
  let relpath
  if (options.path) {
    let primary_path = path.resolve(options.path, "pinokio")
    let primary_exists = await kernel.exists(primary_path)
    if (primary_exists) {
      root = primary_path
      relpath = "pinokio"
    } else {
      root = options.path
      relpath = ""
    }
  } else if (options.name) {
    let primary_path = kernel.path("api", options.name, "pinokio")
    let primary_exists = await kernel.exists(primary_path)
    if (primary_exists) {
      root = primary_path
      relpath = "pinokio"
    } else {
      root = kernel.path("api", options.name)
      relpath = ""
    }
  }
  return { root, relpath }
}
const init = async (options, kernel) => {
  /*
  options = {
    name,
    no_inherit
  }
  */
  // check if pinokio folder exists
  // 1. if it exists, it's pinokio/ENVIRONMENT
  // 2. if not, it's ENVIRONMENT
  let relpath, root
  if (options.name) {
    let got_root = await get_root(options, kernel)
    relpath = got_root.relpath
    root = got_root.root
  } else {
    root = kernel.homedir
  }
  const homeRoot = path.resolve(kernel.homedir)
  const isHomeRoot = path.resolve(root) === homeRoot
  const writeFileIfChanged = async (targetPath, content) => {
    let shouldWrite = true
    try {
      const existingContent = await fs.promises.readFile(targetPath, "utf8")
      shouldWrite = existingContent !== content
    } catch (error) {
      if (!(error && error.code === "ENOENT")) {
        throw error
      }
    }

    if (shouldWrite) {
      await fs.promises.writeFile(targetPath, content, "utf8")
    }
  }
  const backupFileIfChanged = async (targetPath, desiredContent) => {
    let existingContent
    try {
      existingContent = await fs.promises.readFile(targetPath, "utf8")
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return
      }
      throw error
    }
    if (existingContent === desiredContent) {
      return
    }
    const backupPath = `${targetPath}.pinokio.backup`
    try {
      await fs.promises.access(backupPath, fs.constants.F_OK)
      return
    } catch (error) {
      if (!(error && error.code === "ENOENT")) {
        throw error
      }
    }
    await fs.promises.copyFile(targetPath, backupPath)
  }
  let current = path.resolve(root, "ENVIRONMENT")
  let exists = await kernel.exists(current)
  if (exists) {
    // if ENVIRONMENT already exists, don't do anything
  } else {
    // if ENVIRONMENT doesn't exist, need to create one
    // 1. if _ENVIRONMENT exists, create ENVIRONMENT by appending _ENVIRONMENT to ENVIRONMENT
    // 2. if _ENVIRONMENT doesn't exist, just write ENVIRONMENT
    // if _ENVIRONMENT exists, 

    let root_exists = await kernel.exists(root)
    if (!root_exists) {
      await fs.promises.mkdir(root, { recursive: true }).catch((e) => { })
    }

    let _environment = path.resolve(root, "_ENVIRONMENT")
    let _exists = await kernel.exists(_environment)
    if (options && options.no_inherit) {
      if (_exists) {
        let _environmentStr = await fs.promises.readFile(_environment, "utf8")
        await fs.promises.writeFile(current, _environmentStr)
      }
    } else {
      let content = await ENV("app", kernel.homedir, kernel)
      if (_exists) {
        let _environmentStr = await fs.promises.readFile(_environment, "utf8")
        await fs.promises.writeFile(current, _environmentStr + "\n\n\n" + content)
      } else {
        await fs.promises.writeFile(current, content)
      }
    }
  }

  const agentTemplatePath = kernel.path("prototype/system/AGENTS.md")
  const agentTemplateExists = await kernel.exists(agentTemplatePath)
  if (agentTemplateExists) {
    const agentFiles = [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "QWEN.md",
      ".windsurfrules",
      ".cursorrules",
      ".clinerules"
    ]
    const structure_path = kernel.path("prototype/system/structure/clone")
    const structure_content = await fs.promises.readFile(structure_path, "utf-8")
    const proto_path = kernel.path("prototype")
    const home_path = kernel.homedir
    const rendered_recipe = await kernel.renderFile(agentTemplatePath, {
      structure: structure_content,
      examples: kernel.path("prototype/system/examples"),
      browser_logs: kernel.path("logs/browser.log"),
      PINOKIO_DOCUMENTATION: kernel.path("prototype/PINOKIO.md"),
      PTERM_DOCUMENTATION: kernel.path("prototype/PTERM.md"),
      app_root: root,
      proto_path,
      home_path,
    })
    if (isHomeRoot) {
      const soulPath = path.resolve(root, "SOUL.md")
      let soulExists = await kernel.exists(soulPath)
      if (!soulExists) {
        for (const filename of agentFiles) {
          const destination = path.resolve(root, filename)
          await backupFileIfChanged(destination, rendered_recipe)
        }
        await fs.promises.writeFile(soulPath, "", "utf8")
        soulExists = true
      }
      let renderedOutput = rendered_recipe
      if (soulExists) {
        const soulContent = await fs.promises.readFile(soulPath, "utf8")
        const soulBody = soulContent.trim()
        if (soulBody.length > 0) {
          const soulWrapper = [
            "## User Soul",
            "",
            "The following instructions come from `SOUL.md`.",
            "",
            "If this section conflicts with the general Pinokio defaults earlier in this document, follow this section.",
            "",
            "If there is no conflict, follow both.",
          ].join("\n")
          const separator = rendered_recipe.endsWith("\n") ? "\n" : "\n\n"
          renderedOutput = `${rendered_recipe}${separator}${soulWrapper}\n\n${soulBody}\n`
        }
      }
      for (const filename of agentFiles) {
        const destination = path.resolve(root, filename)
        await writeFileIfChanged(destination, renderedOutput)
      }
    } else {
      for (const filename of agentFiles) {
        const destination = path.resolve(root, filename)
        const destinationExists = await kernel.exists(destination)
        if (!destinationExists) {
          await fs.promises.writeFile(destination, rendered_recipe)
        }
      }
    }
    const geminiIgnorePath = path.resolve(root, ".geminiignore")
    const geminiIgnoreContent = `ENVIRONMENT
!/logs
!/GEMINI.md
!/SPEC.md
!/app
!${kernel.homedir}`
    let shouldWriteGeminiIgnore = false
    try {
      const existingGeminiIgnore = await fs.promises.readFile(geminiIgnorePath, "utf8")
      if (existingGeminiIgnore !== geminiIgnoreContent) {
        shouldWriteGeminiIgnore = true
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        shouldWriteGeminiIgnore = true
      } else {
        throw error
      }
    }
    if (shouldWriteGeminiIgnore) {
      await fs.promises.writeFile(geminiIgnorePath, geminiIgnoreContent)
    }
  }

  // Keep Pinokio-managed skills in sync for the home root.
  if (isHomeRoot) {
    try {
      await ManagedSkills.syncManagedSkills(kernel)
    } catch (error) {
      console.warn("[managed skills] Failed to sync managed skills", error)
    }
  }

  const gitDir = path.resolve(root, ".git")
  const gitDirExists = await kernel.exists(gitDir)
  if (gitDirExists) {
    const excludePath = path.resolve(gitDir, "info/exclude")
    await fs.promises.mkdir(path.dirname(excludePath), { recursive: true })

    let excludeContent = ""
    try {
      excludeContent = await fs.promises.readFile(excludePath, "utf8")
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error
      }
    }

    const existingEntries = new Set(
      excludeContent
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
    )

    const entriesToEnsure = [
      "ENVIRONMENT",
//      ".*",
//      "~*",
      "/.pinokio-temp",
      "/logs",
      "/cache",
      "/AGENTS.md",
      "/CLAUDE.md",
      "/GEMINI.md",
      "/QWEN.md",
      "/.geminiignore",
      ".clinerules",
      ".cursorrules",
      ".windsurfrules"
    ]

    const missingEntries = entriesToEnsure.filter(entry => !existingEntries.has(entry))
    if (missingEntries.length > 0) {
      let appendContent = ""
      if (excludeContent.length > 0 && !excludeContent.endsWith("\n")) {
        appendContent += "\n"
      }
      appendContent += missingEntries.join("\n") + "\n"
      await fs.promises.appendFile(excludePath, appendContent)
    }
  }
  return {
    relpath,
    root_path: root,
    env_path: current
  }
}
module.exports = { ENV, get, get2, init_folders, ensurePinokioCacheDirs, requirements, init, get_root, SCRIPT_AUTOLAUNCH_KEY, SCRIPT_AUTOLAUNCH_ENABLED_KEY, SCRIPT_REQUIREMENTS_KEY, getScriptAutolaunch, getScriptAutolaunchEnabled, parseAutolaunchList, formatAutolaunchList, getScriptRequirements  }
