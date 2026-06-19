const fs = require('fs')
const path = require('path')

class Browserless {
  description = "The headless Chrome/Chromium driver"
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "pnpm uninstall -g @browserless/cli"
    }, ondata)
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: "pnpm install -g @browserless/cli"
    }, ondata)
  }
  async installed() {
    const base = this.kernel.path("bin/npm")
    const candidates = this.kernel.platform === "win32"
      ? ["browserless.cmd", "browserless.ps1"]
      : ["browserless"]
    for (const name of candidates) {
      try {
        await fs.promises.access(path.join(base, name), fs.constants.F_OK)
        return true
      } catch (_) {
        // keep checking other candidates
      }
    }
    return false
  }
}
module.exports = Browserless
