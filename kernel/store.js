const os = require('os')
const path = require('path')
const fs = require('fs')
class Store {
  constructor() {
    this.root = path.resolve(os.homedir(), ".pinokio")
    if (!fs.existsSync(path.resolve(this.root))) {
      fs.mkdirSync(path.resolve(this.root))
    }
  }
  exists() {
    let p =  path.resolve(this.root, "config.json")
    return fs.existsSync(p)
  }
  clone(old) {
    console.log("clone", old)
    let p =  path.resolve(this.root, "config.json")
    fs.writeFileSync(p, JSON.stringify(old, null, 2))
  }
  set(key, val) {
    let o
    try {
      let str = fs.readFileSync(path.resolve(this.root, "config.json"), "utf8")
      o = JSON.parse(str)
    } catch(e) {
      o = {}
    }
    o[key] = val
    fs.writeFileSync(path.resolve(this.root, "config.json"), JSON.stringify(o, null, 2))
  }
  get(key) {
    try {
      let str = fs.readFileSync(path.resolve(this.root, "config.json"), "utf8")
      let o = JSON.parse(str)
      return o[key]
    } catch (e) {
      return null
    }
  }
  delete(key) {
    try {
      let str = fs.readFileSync(path.resolve(this.root, "config.json"), "utf8")
      let o = JSON.parse(str)
      delete o[key]
      fs.writeFileSync(path.resolve(this.root, "config.json"), JSON.stringify(o, null, 2))
    } catch (e) {
    }
  }
  store() {
    try {
      let str = fs.readFileSync(path.resolve(this.root, "config.json"), "utf8")
      let o = JSON.parse(str)
      return o
    } catch (e) {
    }
  }
}
module.exports = Store
