const path = require('path')
const fs = require('fs')
const os = require('os')
const platform = os.platform()
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
  delete(key) {
    try {
      let str = fs.readFileSync(path.resolve(__dirname, "pinokio.json"), "utf8")
      let o = JSON.parse(str)
      console.log("before delete", o)
      delete o[key]
      console.log("after delete", o)
      fs.writeFileSync(path.resolve(__dirname, "pinokio.json"), JSON.stringify(o, null, 2))
    } catch (e) {
    }
  }
}
const server = new Server({
  //port: 42000,
  agent: "web",
  store: new Store()
})
server.start({ debug: true })
