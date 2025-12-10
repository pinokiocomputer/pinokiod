const path = require('path')
const { glob } = require('glob')
const Info = require("./info")
class Plugin {
  constructor(kernel) {
    this.kernel = kernel
  }
  async setConfig() {
    let plugin_dir = path.resolve(this.kernel.homedir, "plugin")
    this.cache = {}

    let plugin_paths = await glob('**/pinokio.js', { cwd: plugin_dir })

    let plugins = []
    for(let plugin_path of plugin_paths) {
      let config = await this.kernel.require(path.resolve(plugin_dir, plugin_path))
      if (config && config.run && Array.isArray(config.run)) {
        let invalid
        for(let key in config) {
          if (typeof config[key] === "function") {
            invalid = true
          }
        }
        if (invalid) {
          continue
        }

        let chunks = plugin_path.split(path.sep)
        let cwd = chunks.slice(0, -1).join("/")
        config.image = "/asset/plugin/" + cwd + "/" + config.icon 
        plugins.push({
          href: "/run/plugin/" + chunks.join("/"),
          ...config
        })
      }
    }

    this.config = {
      menu: plugins.map((plugin) => {
        plugin.text = plugin.title
        return plugin
      })
    }
  }
  async init() {
    console.log("Plugin init")
    let exists = await this.kernel.exists("plugin")
    if (!exists) {
      await fs.promises.mkdir(this.kernel.path("plugin"), { recursive: true }).catch((e) => {})
    }
    let code_exists = await this.kernel.exists("plugin/code")
    console.log({ code_exists })
    if (!code_exists) {
      if (this.kernel.bin.installed && this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git")) {
        await this.kernel.exec({
          //message: "git clone https://github.com/peanutcocktail/plugin",
          //message: "git clone https://github.com/pinokiocomputer/plugin",
          message: "git clone https://github.com/pinokiocomputer/code",
          path: this.kernel.path("plugin")
        }, (e) => {
          process.stdout.write(e.raw)
        })
        await this.setConfig()
        return
      }
    } else {
      await this.setConfig()
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
