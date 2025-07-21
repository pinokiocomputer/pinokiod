const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const marked = require('marked')
class Proto {
  constructor(kernel) {
    this.kernel = kernel
  }
  async init() {
    console.log("Proto init")
    this.items = []
    this.kv = {}
    if (this.kernel.bin.installed && this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git")) {

      // if ~/pinokio/prototype doesn't exist, clone
      let exists = await this.kernel.exists("prototype/system")
      if (!exists) {
        console.log("prototype doesn't exist. cloning...")
        await fs.promises.mkdir(this.kernel.path("prototype"), { recursive: true }).catch((e) => { })
        await this.kernel.exec({
          //message: "git clone https://github.com/peanutcocktail/prototype system",
          //message: "git clone https://github.com/pinokiocomputer/prototype system",
          message: "git clone https://github.com/pinokiocomputer/proto system",
          path: this.kernel.path("prototype")
        }, (e) => {
          process.stdout.write(e.raw)
        })
      }
      let exists2 = await this.kernel.exists("prototype/PINOKIO.md")
      if (!exists2) {
        await this.kernel.download({
          uri: "https://raw.githubusercontent.com/pinokiocomputer/home/refs/heads/main/docs/README.md",
          path: this.kernel.path("prototype"),
          filename: "PINOKIO.md"
        }, (e) => {
          process.stdout.write(e.raw)
        })
      }
      let exists3 = await this.kernel.exists("prototype/PTERM.md")
      if (!exists3) {
        await this.kernel.download({
          uri: "https://raw.githubusercontent.com/pinokiocomputer/pterm/refs/heads/main/README.md",
          path: this.kernel.path("prototype"),
          filename: "PTERM.md"
        }, (e) => {
          process.stdout.write(e.raw)
        })
      }
    }
    console.log("Proto init done")
  }
  async reset() {
    await fs.promises.rm(this.kernel.path("prototype"), { recursive: true })
  }
  async create(req, ondata) {
    try {
      let projectType = req.params.projectType
      let startType = req.params.cliType || req.params.startType
      console.log({ projectType, startType })

      let cwd = req.cwd
      let name = req.name
      let payload = {}
      payload.cwd = path.resolve(cwd, name)
      payload.input = req.params

      let mod_path = this.kernel.path("prototype/system", projectType, startType)
      let mod = await this.kernel.require(mod_path)

      await mod(payload, ondata, this.kernel)

      // copy readme
      let readme_path = this.kernel.path("prototype/PINOKIO.md")
      await fs.promises.cp(readme_path, path.resolve(cwd, name, "PINOKIO.md"))

      // copy pterm.md
      let cli_readme_path = this.kernel.path("prototype/PTERM.md")
      await fs.promises.cp(cli_readme_path, path.resolve(cwd, name, "PTERM.md"))


      return { success: "/p/" + name }
    } catch (e) {
      console.log("ERROR", e)
      return { error: e.stack }
    }
  }
  async readme(proto) {
    console.log("proto.readme", proto)
    let readme_path = path.resolve(this.kernel.homedir, "prototype", proto, "README.md")
    let readme
    try {
      readme = await fs.promises.readFile(readme_path, "utf8")
    } catch (e) {
      readme = ""
    }
    console.log({ readme_path, readme })
    return marked.parse(readme)
  }
}
module.exports = Proto
