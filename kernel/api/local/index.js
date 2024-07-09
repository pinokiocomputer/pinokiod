const set = require("../set")
const rm = require("../rm")
const Cloudflare = require("../cloudflare")
const Proxy = require('../proxy')
const Environment = require('../../environment')
const Util = require("../../util")
class Local {
  async import(req, ondata, kernel) {
    /*
      req := {
        "method": "local.import",
        "params": {
          <name>: <uri>|<relative_filepath>|<absolute_filepath>,
          <name>: <uri>|<relative_filepath>|<absolute_filepath>,
        }
      }
    */
    let imported = kernel.import("local", req.params, req.cwd)
    let converted = Object.assign({}, req, {
      params: {
        local: imported
      }
    })
    let res = await set(converted, ondata, kernel)
    return res
  }
  async set(req, ondata, kernel) {
    /*
      req := {
        "method": "local.set",
        "params": {
          <key>: <val>,
          <key>: <val>,
        }
      }

      equivalent to:

      req := {
        "method": "set",
        "params": {
          "local": {
            <key>: <val>,
            <key>: <val>,
          }
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        local: req.params
      }
    })
    let res = await set(converted, ondata, kernel)

    // handle special local variables
    /*
      req :- {
        method: "set",
        params: {
          "url": k
        }
      }
    */

    let api_path = await Util.api_path(req.parent.path, kernel)
    let current_env = await Environment.get(api_path)
    let default_env = await Environment.get(kernel.homedir)
    current_env = Object.assign(process.env, default_env, current_env)

    // if the key at current_env.PINOKIO_SHARE_VAR (by default it's 'url') is the variable being set, trigger the share logic
    if (current_env.PINOKIO_SHARE_VAR && current_env.PINOKIO_SHARE_VAR in req.params) {
      // the share logic is triggered ONLY IF the env.PINOKIO_SHARE is non-empty and contains "cloudflare", "local", or "cloudflare,local"
      const KEY = current_env.PINOKIO_SHARE_VAR
      if ("PINOKIO_SHARE_CLOUDFLARE" in current_env) {
        let val = current_env.PINOKIO_SHARE_CLOUDFLARE.trim().toLowerCase()
        if (val === "true" || val === "1") {
          const c = new Cloudflare()
          req.params.uri = req.params[KEY]
          await c.tunnel(req, ondata, kernel)
        }
      }
      if ("PINOKIO_SHARE_LOCAL" in current_env) {
        let val = current_env.PINOKIO_SHARE_LOCAL.trim().toLowerCase()
        if (val === "true" || val === "1") {
          const p = new Proxy()
          req.params.name = "Local Sharing",
          req.params.uri = req.params[KEY]
          await p.start(req, ondata, kernel)
        }
      }
    }

    return res
  }
  async rm(req, ondata, kernel) {
    /*
      req := {
        "method": "local.rm",
        "params": [<key>, <key>, ..]
      }

      equivalent to:

      req := {
        "method": "rm",
        "params": {
          "local": [<key>, <key>, ..]
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        local: req.params
      }
    })
    let res = await rm(converted, ondata, kernel)
    return res
  }
}
module.exports = Local
