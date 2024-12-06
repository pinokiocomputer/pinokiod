const fs = require('fs')
const { rimraf } = require('rimraf')
class Playwright {
  async install(req, ondata) {
    await this.kernel.exec({
      message: [
//        "npm init -y",
        `npm config set prefix ${this.kernel.bin.path("miniconda")}`,
      ],
      path: this.kernel.bin.path("playwright"),
      env: {
        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
      }
    }, ondata)
    await this.kernel.exec({
      message: [
//        "npm init -y",
        "npm install -g playwright@1.49.0",
//        "playwright install chromium",
      ],
      //path: this.kernel.bin.path("playwright"),
      env: {
        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
      }
    }, ondata)
    await this.kernel.exec({
      message: [
//        "npm init -y",
        "playwright install firefox",
      ],
      //path: this.kernel.bin.path("playwright"),
      env: {
        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
      }
    }, ondata)
//    await this.kernel.exec({
//      message: [
//        "npm init -y",
//        "npm install @playwright/browser-chromium@1.47.0",
//        "npm install @playwright/browser-firefox@1.47.0",
//        "npm install @playwright/browser-webkit@1.47.0"
////        "npx playwright install chromium"
//      ],
//      path: this.kernel.bin.path("playwright"),
//      env: {
//        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
//      }
//    }, ondata)
    await this.kernel.exec({
      message: [
        "pip install playwright==1.48.0",
//        "playwright install"
//        "npm install playwright --ignore-scripts"
      ],
      env: {
        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
      }
    }, ondata)

    let pwpath
    if (this.kernel.platform === "win32") {
      pwpath = this.kernel.bin.path("miniconda/node_modules/playwright")
    } else {
      pwpath = this.kernel.bin.path("miniconda/lib/node_modules/playwright")
    }
    process.env.PLAYWRIGHT_BROWSERS_PATH = this.kernel.bin.path("playwright/browsers")
    this.kernel.playwright = (await this.kernel.loader.load(pwpath)).resolved
  }
  async installed() {
    let p = this.kernel.bin.path("playwright/browsers")
    let e = await this.kernel.bin.exists(p)
    return e
  }
  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.kernel.bin.path("playwright")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
}
module.exports = Playwright
