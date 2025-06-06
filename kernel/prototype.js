const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
class Proto {
  constructor(kernel) {
    this.kernel = kernel
  }
  async init() {

    // if ~/pinokio/prototype doesn't exist, clone
    let exists = await this.kernel.exists("prototype")
    if (!exists) {
      console.log("prototype doesn't exist. cloning...")
      await fs.promises.mkdir(this.kernel.path("prototype"), { recursive: true }).catch((e) => { })
      await this.kernel.exec({
        message: "git clone https://github.com/peanutcocktail/prototype system",
        path: this.kernel.path("prototype")
      }, (e) => {
        process.stdout.write(e.raw)
      })
    }


    let cwd = path.resolve(this.kernel.homedir, "prototype")
    let prototype_paths = (await glob('**/pinokio.js', { cwd }))
    let prototype_dir = path.resolve(this.kernel.homedir, "prototype")
    this.items = []
    this.kv = {}
    for(let prototype_path of prototype_paths) {
      let proto = path.dirname(prototype_path)
      let pinokiojs = path.resolve(prototype_dir, prototype_path)
      let config = await this.kernel.require(pinokiojs)
      if (config && config.run) {
        if (config.icon) {
          config.icon = "/prototype/" + proto + "/" + config.icon
        } else {
          config.icon === "/pinokio-black.png"
        }
        let c = {
          id: proto,
          ...config
        }
        this.items.push(c)
        this.kv[proto] = c
      }
    }
  }
}
module.exports = Proto
