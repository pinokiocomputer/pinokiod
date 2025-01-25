const fs = require('fs')
const path = require('path')
const { rimraf } = require('rimraf')
class Playwright {
  async install(req, ondata) {
    let p = this.kernel.path("bin/playwright")
    await rimraf(p)
    await fs.promises.mkdir(p, { recursive: true }).catch((e) => { })

    if (this.kernel.platform === "linux") {
      await this.kernel.bin.exec({
        message: [
          //"npm init -y",
          //"npm install playwright@latest"
          "npm init -y playwright@latest -- --quiet",
          //"npm install npm corepack playwright@1.49.1 --loglevel verbose",
          //"npm install playwright --loglevel verbose",
          //"playwright install firefox",
  //        "playwright install chromium",
        ],
        on: [{
          event: "/error:/i",
          break: false
        }],
        path: p,
        env: {
          PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
        }
      }, ondata)
      console.log("INSTALL FINISHED")
      //let pwpath = this.kernel.bin.path("playwright/js/node_modules/playwright")
      let pwpath = this.kernel.bin.path("playwright/node_modules/playwright")
      this.kernel.playwright = (await this.kernel.loader.load(pwpath)).resolved
    } else {
      await this.kernel.bin.exec({
        message: [
          //"npm init -y",
          //"npm install playwright@latest --quiet --install-deps"
          //"npm init -y playwright@latest -- --lang js --quiet --install-deps",
          //"npm init -y playwright@latest -- --quiet --install-deps",
          "npm init -y playwright@latest -- --quiet",
          //"npm install npm corepack playwright@1.49.1 --loglevel verbose",
          //"npm install playwright --loglevel verbose",
          //"playwright install firefox",
  //        "playwright install chromium",
        ],
        on: [{
          event: "/error:/i",
          break: false
        }],
        path: p,
        env: {
          PLAYWRIGHT_BROWSERS_PATH: this.kernel.bin.path("playwright/browsers")
        }
      }, ondata)
      console.log("INSTALL FINISHED")
      //let pwpath = this.kernel.bin.path("playwright/js/node_modules/playwright")
      let pwpath = this.kernel.bin.path("playwright/node_modules/playwright")
      this.kernel.playwright = (await this.kernel.loader.load(pwpath)).resolved
    }
  }
  async installed() {
    let browsers = this.kernel.path("bin/playwright/browsers")
    let node_modules = this.kernel.path("bin/playwright/node_modules/playwright")
    let e1 = await this.kernel.bin.exists(browsers)
    let e2 = await this.kernel.bin.exists(node_modules)
    console.log({ e1, e2 })
    return e1 && e2
    //if (this.kernel.platform === "linux") {
    //  let browsers = this.kernel.path("bin/playwright/browsers")
    //  let node_modules = this.kernel.path("bin/playwright/node_modules/playwright")
    //  let e1 = await this.kernel.bin.exists(browsers)
    //  let e2 = await this.kernel.bin.exists(node_modules)
    //  console.log({ e1, e2 })
    //  return e1 && e2
    //} else {
    //  let browsers = this.kernel.path("bin/playwright/browsers")
    //  let node_modules = this.kernel.path("bin/playwright/js/node_modules/playwright")
    //  let e1 = await this.kernel.bin.exists(browsers)
    //  let e2 = await this.kernel.bin.exists(node_modules)
    //  console.log({ e1, e2 })
    //  return e1 && e2
    //}
  }
  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.kernel.bin.path("playwright")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
}
module.exports = Playwright
