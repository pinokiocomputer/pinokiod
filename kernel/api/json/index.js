const path = require('path')
const set = require("../set")
const rm = require("../rm")
class J {
  async get(req, ondata, kernel) {
    /*
      // set local variables from json
      req := {
        "method": "json.get",
        "params": {
          "<key1>": <filepath1>,
          "<key1>": <filepath2>
        }
      }
    */
    let params = {}
    for(let key in req.params) {
      let filepath = path.resolve(req.cwd, req.params[key])
      if (filepath.endsWith(".json")) {
        let j = (await kernel.loader.load(filepath)).resolved
        params[key] = j
      }
    }
    let converted = Object.assign({}, req, {
      params: {
        local: params
      }
    })
    await set(converted, ondata, kernel)
  }
  async set(req, ondata, kernel) {
    /*
      req := {
        "method": "json.set",
        "params": {
          "index.json": {
            <key>: <val>,
            <key>: <val>,
          },
          "data/models.json": {
            <key>: <val>,
            <key>: <val>,
          }
        }
      }

      equivalent to:

      req := {
        "method": "set",
        "params": {
          "json": {
            "index.json": {
              <key>: <val>,
              <key>: <val>,
            },
            "data/models.json": {
              <key>: <val>,
              <key>: <val>,
            }
          }
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        json: req.params
      }
    })
    let res = await set(converted, ondata, kernel)
    return res
  }
  async rm(req, ondata, kernel) {
    /*
      req := {
        "method": "json.rm",
        "params": {
          "index.json": {
            "abc": "def"
          },
          "data/models.json": {
            [ "attr", "a.b.c" ]
          }
        }
      }

      equivalent to:

      req := {
        "method": "rm",
        "params": {
          "json": {
            "index.json": {
              "abc": "def"
            },
            "data/models.json": {
              [ "attr", "a.b.c" ]
            }
          }
        }
      }
    */
    let converted = Object.assign({}, req, {
      params: {
        json: req.params
      }
    })
    let res = await rm(converted, ondata, kernel)
    return res
  }
}
module.exports = J
