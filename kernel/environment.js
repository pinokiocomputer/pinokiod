const path = require('path')
const fs = require('fs')
const Util = require('./util')
const ENVS = [{
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
  val: "<<PINOKIO SHELL>> "
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
}, {
  type: ["system"],
  key: "PINOKIO_PORT",
  val: "80",
  comment: [
    "##########################################################################",
    "#",
    "# PINOKIO_PORT",
    "#",
    "# The server port Pinokio will use. By default it's 80 but you can",
    "# Change it to anything else",
    "#",
    "##########################################################################",
  ],
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
}];
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
const ENV = (type) => {
  return ENVS.filter((e) => {
    return e.type.includes(type)
  }).map((e) => {
    let comment = ""
    if (e.comment && Array.isArray(e.comment)) {
      comment = "\n" + e.comment.join("\n") + "\n"
    }

    let kv
    if (typeof e.val === "function") {
      kv = `${e.key}=${e.val(type)}`
    } else {
      kv = `${e.key}=${e.val}`
    }
    return comment + kv
  }).join("\n")
}
const init_folders = async (homedir) => {
  const current_env = await get(homedir)
  for(let key in current_env) {
    let val = current_env[key]
    let is_absolute = path.isAbsolute(val)
    let is_relative = val.startsWith("./")
    if (is_absolute || is_relative) {
      // it's a path
      let full_path = path.resolve(homedir, val)
      await fs.promises.mkdir(full_path, { recursive: true }).catch((e) => {})
    }
  }
}

// Get the actual environment variable at specific path
const get2 = async (filepath, kernel) => {
  let api_path = Util.api_path(filepath, kernel)
  let default_env = await get(kernel.homedir)
  let api_env = await get(api_path)
  let current_env = Object.assign(process.env, default_env, api_env)
  return current_env
}
const get = async (homedir) => {
  const env_path = path.resolve(homedir, "ENVIRONMENT")
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
module.exports = { ENV, get, get2, init_folders }
