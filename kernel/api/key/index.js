/*
# 1. key.set => pops up key + password input
{
  "method": "key.set"
}

# 2. key.get => pops up key + password input
# 2.1. Publick key/val
{
  "method": "key.get"
}
*/
const fs = require('fs')
const { createStore } = require('key-store')
class Key {
  async set(req, ondata, kernel) {
    ondata(req.params, "key.set")
    let { key, password } = await kernel.api.wait(req.parent.path)
  }
  async get(req, ondata, kernel) {
    ondata(req.params, "key.get")
    let { key, password } = await kernel.api.wait(req.parent.path)
    return response
  }
}
module.exports = Key
