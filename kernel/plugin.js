const path = require('path')
class Plugin {
  constructor(kernel) {
    this.kernel = kernel
  }
  async init() {
    console.log("Plugin.init")
    if (this.kernel.bin.installed && this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git")) {
      console.log("INSTALLED")
      // if ~/pinokio/prototype doesn't exist, clone
      let exists = await this.kernel.exists("plugin")
      if (!exists) {
        await this.kernel.exec({
          message: "git clone https://github.com/peanutcocktail/plugin",
          path: this.kernel.homedir
        }, (e) => {
          process.stdout.write(e.raw)
        })
      }
      console.log("#################")

      let plugin_dir = path.resolve(this.kernel.homedir, "plugin")
      let pinokiojs = path.resolve(plugin_dir, "pinokio.js")
      console.log("pinokiojs", pinokiojs)
      this.config = await this.kernel.require(pinokiojs)
      console.log("this.config", this.config)
    }
  }
  async update() {
    if (this.kernel.bin.installed && this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git")) {
      let exists = await this.kernel.exists("plugin")
      if (!exists) {
        await this.kernel.exec({
          message: "git pull",
          path: this.kernel.path("plugin")
        }, (e) => {
          process.stdout.write(e.raw)
        })
      }
    }
  }
}
module.exports = Plugin
