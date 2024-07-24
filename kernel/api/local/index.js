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

    let current_env = await Environment.get2(req.parent.path, kernel)
    console.log({ current_env })

    // if the key at current_env.PINOKIO_SHARE_VAR (by default it's 'url') is the variable being set, trigger the share logic
    if (current_env.PINOKIO_SHARE_VAR && current_env.PINOKIO_SHARE_VAR in req.params) {
      // the share logic is triggered ONLY IF the env.PINOKIO_SHARE is non-empty and contains "cloudflare", "local", or "cloudflare,local"
      const KEY = current_env.PINOKIO_SHARE_VAR
      if ("PINOKIO_SHARE_CLOUDFLARE" in current_env) {
        let val = current_env.PINOKIO_SHARE_CLOUDFLARE.trim().toLowerCase()
        if (val === "true" || val === "1") {
          const c = new Cloudflare()
          req.params.uri = req.params[KEY]
          if ("PINOKIO_SHARE_PASSCODE" in current_env) {
            req.params.passcode = current_env.PINOKIO_SHARE_PASSCODE
          }
          await c.tunnel(req, ondata, kernel)
        }
      }
      if ("PINOKIO_SHARE_LOCAL" in current_env) {
        let val = current_env.PINOKIO_SHARE_LOCAL.trim().toLowerCase()
        if (val === "true" || val === "1") {

          req.params.name = "Local Sharing",
          req.params.uri = req.params[KEY]
          if ("PINOKIO_SHARE_LOCAL_PORT" in current_env) {
            let port = current_env.PINOKIO_SHARE_LOCAL_PORT.trim().toLowerCase()
            if (port.length > 0) {
              console.log("start proxy at custom port", port)
              req.params.port = port
            }
          }
          const p = new Proxy()
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
