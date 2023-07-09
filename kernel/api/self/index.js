const set = require("../set")
const rm = require("../rm")
class Self {
  async set(req, ondata, kernel) {
    /*
      req := {
        "method": "self.set",
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
          "self": {
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
        self: req.params
      }
    })
    let res = await set(converted, ondata, kernel)
    return res
  }
  async rm(req, ondata, kernel) {
    /*
      req := {
        "method": "self.rm",
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
          "self": {
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
        self: req.params
      }
    })
    let res = await rm(converted, ondata, kernel)
    return res
  }
}
module.exports = Self
