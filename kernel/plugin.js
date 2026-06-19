const fs = require('fs')
const PluginSources = require("./plugin_sources")

class Plugin {
  constructor(kernel) {
    this.kernel = kernel
  }
  async setConfig() {
    this.cache = {}

    const plugins = await PluginSources.loadPluginMenu(this.kernel)

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
    await this.setConfig()
  }
  async update() {
    await this.setConfig()
  }
}
module.exports = Plugin
