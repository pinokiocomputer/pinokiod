const set = require("../set")
const rm = require("../rm")
class Global {
  async set(req, ondata, kernel) {
    /*
      req := {
        "method": "global.set",
        "params": {
          <key>: <val>,
          <key>: <val>,
        }
      }

      equivalent to:

      req := {
        "method": "set",
        "params": {
          "global": {
            <key>: <val>,
            <key>: <val>,
          }
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        global: req.params
      }
    })
    let res = await set(converted, ondata, kernel)
    return res
  }
  async rm(req, ondata, kernel) {
    /*
      req := {
        "method": "global.rm",
        "params": [<key>, <key>, ..]
      }

      equivalent to:

      req := {
        "method": "rm",
        "params": {
          "global": [<key>, <key>, ..]
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        global: req.params
      }
    })
    let res = await rm(converted, ondata, kernel)
    return res
  }
}
module.exports = Global
