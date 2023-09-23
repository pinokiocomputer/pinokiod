const path = require('path')
const fs = require('fs')
const Server = require('../server')
class Store {
  set(key, val) {
    let o
    try {
      let str = fs.readFileSync(path.resolve(__dirname, "pinokio.json"), "utf8")
      o = JSON.parse(str)
    } catch(e) {
      o = {}
    }
    o[key] = val
    fs.writeFileSync(path.resolve(__dirname, "pinokio.json"), JSON.stringify(o, null, 2))
  }
  get(key) {
    try {
      let str = fs.readFileSync(path.resolve(__dirname, "pinokio.json"), "utf8")
      let o = JSON.parse(str)
      return o[key]
    } catch (e) {
      return null
    }
  }
}
const server = new Server({
  port: 4200,
  agent: "web",
  store: new Store()
})
server.start(true)
