const path = require('path')
const semver = require('semver')
const Util = require('../util')
class CLI {
  version = ">=0.0.17"
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
      try {
        const moduleRoot = this.kernel.platform === "win32"
          ? this.kernel.path("bin/npm/node_modules")
          : this.kernel.path("bin/npm/lib/node_modules")
        const pkgPath = require.resolve("pterm/package.json", { paths: [moduleRoot] })
        const { version } = require(pkgPath)
        const coerced = semver.coerce(version)
        if (coerced && semver.satisfies(coerced, this.version)) {
          return true
        }
        return false
      } catch (err) {
        return false
      }
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
