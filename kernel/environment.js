const path = require('path')
const fs = require('fs')
const Util = require('./util')
const ENVS = [{
  type: "cache_folder",
  key: "HF_HOME",
}, {
  type: "cache_folder",
  key: "TORCH_HOME",
}, {
  type: "cache_folder",
  key: "HOMEBREW_CACHE",
}, {
  type: "cache_folder",
  key: "XDG_CACHE_HOME",
}, {
  type: "cache_folder",
  key: "PIP_CACHE_DIR",
}, {
  type: "cache_folder",
  key: "PIP_TMPDIR",
}, {
  type: "cache_folder",
  key: "TMPDIR",
}, {
  type: "cache_folder",
  key: "TEMP",
}, {
  type: "cache_folder",
  key: "TMP",
}, {
  type: "cache_folder",
  key: "XDG_DATA_HOME",
}, {
  type: "cache_folder",
  key: "XDG_CONFIG_HOME",
}, {
  type: "cache_folder",
  key: "XDG_STATE_HOME",
}, {
  type: "cache_folder",
  key: "GRADIO_TEMP_DIR",
}, {
  key: "PIP_CONFIG_FILE",
  val: (home) => {
    return path.resolve(home, "pipconfig")
  }
}, {
  key: "CONDARC",
  val: (home) => {
    return path.resolve(home, "condarc")
  },
}, {
  key: "PS1",
  val: (home) => {
    return "<<PINOKIO SHELL>> "
  },
}, {
  key: "GRADIO_ANALYTICS_ENABLED",
  val: (home) => {
    return "False"
  },
}, {
  key: "GRADIO_ALLOWED_PATHS",
  val: (home) => {
    return home
  },
}, {
  key: "PINOKIO_SHARE_VAR",
  val: (home) => {
    return "url"
  },
}, {
  type: "folder",
  key: "PINOKIO_DRIVE",
  val: (home) => {
    return path.resolve(home, "drive")
  }
}, {
  key: "PINOKIO_SCRIPT_DEFAULT",
  val: (home) => {
    return "true"
  }
}, {
  key: "PINOKIO_PORT",
  val: (home) => {
    return "80"
  }
}];
const folders = ENVS.filter((env) => {
  return env.type === "cache_folder" || env.type === "folder"
}).map((e) => {
  return e.key
})
const ENV = (homedir) => {
  const lines = ENVS.map((e) => {
    if (e.type) {
      if (e.type === "cache_folder") {
        return `${e.key}=${path.resolve(homedir, "cache", e.key)}`
      }
    } else {
      if (e.val) {
        return `${e.key}=${e.val(homedir)}`
      }
    }
  })
  return lines.join("\n")
}
const APP_ENV = () => {
  const items = [
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
    "HF_HOME=cache/HF_HOME",
    "",
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
    "TORCH_HOME=cache/TORCH_HOME",
    "",
    "##########################################################################",
    "#",
    "# GRADIO_TEMP_DIR",
    "# All the files uploaded through gradio goes here.",
    "#",
    "# Delete this line to store the files under PINOKIO_HOME/cache/GRADIO_TEMPDIR",
    "# or change the path if you want to use a different path",
    "#",
    "##########################################################################",
    "GRADIO_TEMP_DIR=cache/GRADIO_TEMP_DIR",
    "",
    "##########################################################################",
    "#",
    "# PINOKIO_SHARE_LOCAL",
    "# Set this variable to true to share the app on the local network.",
    "#",
    "##########################################################################",
    "PINOKIO_SHARE_LOCAL=true",
    "",
    "##########################################################################",
    "#",
    "# PINOKIO_SHARE_CLOUDFLARE",
    "# Set this variable to share the app publicly via cloudflare tunnel.",
    "#",
    "##########################################################################",
    "PINOKIO_SHARE_CLOUDFLARE=false",
    "",
    "##########################################################################",
    "#",
    "# PINOKIO_SCRIPT_DEFAULT",
    "# If this variable is false, 'default': true menu items in pinokio.js",
    "# will NOT automatically run",
    "#",
    "##########################################################################",
    "PINOKIO_SCRIPT_DEFAULT=true",
  ]
  return items.join("\n")
}
const init_folders = async (homedir) => {
  // get the environment object from homedir
  const current_env = await get(homedir)

  // filter out only the folder keys

  // create folders
  for(let key in current_env) {
    // env key included in folders
    if (folders.includes(key)) {
      // mkdir
      let full_path = path.resolve(homedir, current_env[key])
      await fs.promises.mkdir(full_path, { recursive: true }).catch((e) => {})
    }
  }
}

// Get the actual environment variable at specific path
const get2 = async (filepath, kernel) => {
  let api_path = Util.api_path(filepath, kernel)
  let default_env = await get(kernel.homedir)
  let api_env = await get(api_path)
  return Object.assign(process.env, default_env, api_env)
}
const get = async (homedir) => {
  const env_path = path.resolve(homedir, "ENVIRONMENT")
  const current_env = await Util.parse_env(env_path)
  // if the key is a folder/cache_folder type, resolve the path
  for(let key in current_env) {
    if (folders.includes(key)) {
      let full_path = path.resolve(homedir, current_env[key])
      current_env[key] = full_path
    }
  }
  return current_env
}
module.exports = { ENV, get, get2, init_folders, APP_ENV }
