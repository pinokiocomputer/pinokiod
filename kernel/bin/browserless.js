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
    let browserless = this.kernel.which('browserless')
    if (browserless) {
      return true
    } else {
      return false
    }
  }
}
module.exports = Browserless
