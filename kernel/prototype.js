const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const marked = require('marked')
const matter = require('gray-matter');
class Proto {
  constructor(kernel) {
    this.kernel = kernel
  }
  async init() {
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
  }
  async ai() {
    let ai_path = this.kernel.path("prototype/system/ai/new/static")
    let mds = await fs.promises.readdir(ai_path)
    mds = mds.filter((md) => {
      return md.endsWith(".md")
    })
    const results = []
    for(let md of mds) {
      let mdpath = path.resolve(ai_path, md)
      let mdstr = await fs.promises.readFile(mdpath, "utf8")
      const { data, content } = matter(mdstr)
//      const html = marked.parse(content)
      let { title, description, ...meta } = data
      results.push({
        title,
        description,
        meta,
        data,
        content
      })
    }
    return results
  }
  async reset() {
    await fs.promises.rm(this.kernel.path("prototype"), { recursive: true })
  }
  async create(req, ondata) {
    console.log("CREATE", req)
    try {
      if (req.client) {
        this.kernel.client = req.client
      }
      console.log("REQ", JSON.stringify(req, null, 2))
      let projectType = req.params.projectType
      let startType = req.params.cliType || req.params.startType

      let cwd = req.cwd
      let name = req.params.name
      let payload = {}
      payload.cwd = path.resolve(cwd, name)
      payload.input = req.params


      // 1. move mkdir into each launcher
      // 2. run logic
      // 3. add docs

//      await fs.promises.mkdir(payload.cwd)

      if (projectType === "blank") {
        return { success: "/p/" + name + "/dev" }
      }

//      let default_icon_path = path.resolve(__dirname, "../server/public/pinokio-black.png")
//      let icon_path = path.resolve(payload.cwd, "icon.png")
//      await fs.promises.cp(default_icon_path, icon_path)

      // run the init logic
      let mod_path = this.kernel.path("prototype/system", projectType, startType)
      let mod = await this.kernel.require(mod_path)
      let response = await mod(payload, ondata, this.kernel)

//      // copy readme
//      let readme_path = this.kernel.path("prototype/PINOKIO.md")
//      await fs.promises.cp(readme_path, path.resolve(cwd, name, "PINOKIO.md"))
//
//      // copy pterm.md
//      let cli_readme_path = this.kernel.path("prototype/PTERM.md")
//      await fs.promises.cp(cli_readme_path, path.resolve(cwd, name, "PTERM.md"))


      if (response) {
        return response
      } else {
        return { success: "/p/" + name + "/dev" }
      }
    } catch (e) {
      console.log("ERROR", e)
      return { error: e.stack }
    }
  }
  async readme(proto) {
    let readme_path = path.resolve(this.kernel.homedir, "prototype", proto, "README.md")
    let readme
    try {
      readme = await fs.promises.readFile(readme_path, "utf8")
    } catch (e) {
      readme = ""
    }
    return marked.parse(readme)
  }
}
module.exports = Proto
