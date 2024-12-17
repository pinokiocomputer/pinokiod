const fs = require('fs')
const path = require('path')
const { rimraf } = require('rimraf')
class Playwright {
  async install(req, ondata) {
//    let c
//    if (this.kernel.platform === "win32") {
//      c = `npm config --global set prefix ${this.kernel.bin.path("miniconda")}`
//    } else {
//      c = [
//        `npm config --global set prefix ${this.kernel.bin.path("miniconda")} --loglevel verbose`,
//        `npm config set prefix ${this.kernel.bin.path("miniconda")} --loglevel verbose`
//      ]
//    }
//    await this.kernel.exec({
//      message: c,
////      path: this.kernel.bin.path("playwright"),
//      env: {
//        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
//      }
//    }, ondata)


    let p
    if (this.kernel.platform === "win32") {
      p = this.kernel.path("bin/miniconda")
    } else {
      p = this.kernel.path("bin/miniconda/lib")
    }
    await this.kernel.exec({
      message: [
//        "npm init -y",
//        "which npm",
//        "npm config get userconfig",
//        "npm config get globalconfig",
//        "npm config list -l --loglevel verbose",
//        "env",
        //"npm install -g playwright@1.49.0 --loglevel verbose",
        "npm install npm corepack playwright@1.49.1 --loglevel verbose",
//        "playwright install chromium",
      ],
      path: p,
      env: {
        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
      }
    }, ondata)
    let pw_path = path.resolve(p, "node_modules/playwright/cli.js")
    await this.kernel.exec({
      message: [
//        "npm init -y",
        `node ${pw_path} install firefox`,
//        "playwright install firefox",
//        "npx -y playwright install firefox"
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
//    await this.kernel.exec({
//      message: [
//        "pip install playwright==1.48.0",
////        "playwright install"
////        "npm install playwright --ignore-scripts"
//      ],
//      env: {
//        PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
//      }
//    }, ondata)

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
