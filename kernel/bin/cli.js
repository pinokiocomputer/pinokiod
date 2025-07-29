const path = require('path')
const semver = require('semver')
const Util = require('../util')
class CLI {
  version = ">=0.0.14"
  async install(req, ondata) {
    await this.kernel.exec({
      message: "npm install -g pterm@latest --force",
    }, ondata)
  }
  async installed(req, ondata) {
    let exists
    if (this.kernel.platform === "win32") {
      exists = await Util.exists(this.kernel.path("bin/npm/pterm"))
    } else {
      exists = await Util.exists(this.kernel.path("bin/npm/bin/pterm"))
    }
    if (exists) {
//      let p = this.kernel.which("pterm")
//      console.log({ exists, p})
//      if (p) {
        let res = await this.kernel.exec({
          message: "pterm version terminal"
        }, ondata)
        let e = /pterm@([0-9.]+)/.exec(res.stdout)
        if (e && e.length > 0) {
          let v = e[1]
          let coerced = semver.coerce(v)
          if (semver.satisfies(coerced, this.version)) {
            return true
          } else {
            return false
          }
        } else {
          return false
        }
//      } else {
//        return false
//      }
    } else {
      return false
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.exec({
      message: "npm uninstall -g pterm",
    }, ondata)
  }
}
module.exports = CLI
