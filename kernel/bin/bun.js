const semver = require("semver")
const Util = require("../util")

const BUN_VERSION = "1.3.11"

class Bun {
  description = "Installs Bun, a fast JavaScript runtime and package manager."
  cmd() {
    return `bun@${BUN_VERSION}`
  }
  executableCandidates() {
    if (this.kernel.platform === "win32") {
      return [
        this.kernel.path("bin/npm/bun"),
        this.kernel.path("bin/npm/bun.cmd"),
        this.kernel.path("bin/npm/bun.exe"),
      ]
    }
    return [
      this.kernel.path("bin/npm/bin/bun"),
    ]
  }
  moduleRoot() {
    if (this.kernel.platform === "win32") {
      return this.kernel.path("bin/npm/node_modules")
    }
    return this.kernel.path("bin/npm/lib/node_modules")
  }
  async install(req, ondata) {
    const node = this.kernel.bin.mod && this.kernel.bin.mod.node
    if (node && node.installed && node.install) {
      const nodeInstalled = await node.installed()
      if (!nodeInstalled) {
        await node.install(req, ondata)
      }
    }
    await this.kernel.exec({
      message: `npm install -g ${this.cmd()} --force`,
    }, ondata)
  }
  async installed() {
    let exists = false
    for (const candidate of this.executableCandidates()) {
      if (await Util.exists(candidate)) {
        exists = true
        break
      }
    }
    if (!exists) {
      return false
    }
    try {
      const pkgPath = require.resolve("bun/package.json", { paths: [this.moduleRoot()] })
      const { resolved } = await this.kernel.loader.load(pkgPath)
      const { version } = resolved || {}
      const coerced = semver.coerce(version)
      return !!(coerced && semver.satisfies(coerced, BUN_VERSION))
    } catch (err) {
      return false
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.exec({
      message: "npm uninstall -g bun",
    }, ondata)
  }
}

module.exports = Bun
