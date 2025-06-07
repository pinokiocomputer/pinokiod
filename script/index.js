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
  //port: 41999,
  port: 42000,
  newsfeed: (gitRemote) => {
    return `https://pinokiocomputer.github.io/home/item?uri=${gitRemote}&display=feed`
  },
  profile: (gitRemote) => {
    return `https://pinokiocomputer.github.io/home/item?uri=${gitRemote}&display=profile`
  },
  site: "https://pinokiocomputer.github.io/home",
  discover_dark: "https://pinokiocomputer.github.io/home/app?theme=dark",
  discover_light: "https://pinokiocomputer.github.io/home/app",
  portal: "https://pinokiocomputer.github.io/home/portal",
  docs: "https://pinokiocomputer.github.io/program.pinokio.computer",
  install: "https://pinokiocomputer.github.io/program.pinokio.computer/#/?id=install",
  agent: "web",
  store: new Store()
})
server.start({ debug: true })
