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
      let cwd = plugin_path.split("/").slice(0, -1).join("/")
      config.image = "/asset/plugin/" + cwd + "/" + config.icon 
      plugins.push({
        href: "/run/plugin/" + plugin_path,
        ...config
      })
    }

    this.config = {
      menu: plugins.map((plugin) => {
        plugin.text = plugin.title
        return plugin
      })
    }
  }
  async init() {
    let exists = await this.kernel.exists("plugin")
    if (!exists) {
      await fs.promises.mkdir(this.kernel.path("plugin"), { recursive: true }).catch((e) => {})
    }
    let code_exists = await this.kernel.exists("plugin/code")
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
