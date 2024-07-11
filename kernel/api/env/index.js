const path = require('path')
const set = require("../set")
const rm = require("../rm")
const Environment = require('../../environment')
const Util = require("../../util")
class Env {
  async set(req, ondata, kernel) {
    /*
      req := {
        "method": "env.set",
        "params": {
          <key>: <val>,
          <key>: <val>,
        }
      }
    */
    // write to current app folder's ENVIRONMENT
    let api_path = Util.api_path(req.parent.path, kernel)
    let env_path = path.resolve(api_path, "ENVIRONMENT")
    await Util.update_env(env_path, req.params)
  }
  async switch(req, ondata, kernel) {
    /*
      req := {
        "method": "env.switch",
        "params": {
          <key>: ["true", "false"],
        }
      }

      req := {
        "method": "env.switch",
        "params": {
          <key>: ["apple", "orange", "grape"],
        }
      }
    */
    let api_path = Util.api_path(req.parent.path, kernel)
    let env_path = path.resolve(api_path, "ENVIRONMENT")
    let env = await Environment.get2(req.parent.path, kernel)
    // does the key exist?

    let update = {}
    for(let key in req.params) {
      let options = req.params[key]
      if (key in env) {
        // if the key exists, check if the values are one of the options
        let existing_val = env[key]
        if (options.includes(existing_val)) {
          // find the item index
          let existing_index = options.indexOf(existing_val)
          // choose the next option in the array
          let next_index = (existing_index + 1) % options.length
          let next_item = options[next_index]
          update[key] = next_item
        } else {
          // if not one of the options, ignore. must match exactly
        }
      } else {
        // if the key doesn't exist, the first item is the default
        update[key] = options[0]
      }
    }
    await Util.update_env(env_path, update)
  }
}
module.exports = Env
