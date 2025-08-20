class Browserless {
  description = "The headless Chrome/Chromium driver"
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "npm uninstall -g @browserless/cli"
    }, ondata)
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: "npm install -g @browserless/cli"
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
