const os = require('os')
const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const Cmake = require("./cmake")
const Python = require('./python')
const Git = require('./git')
const Node = require('./node')
const Brew = require("./brew")
const Conda = require("./conda")
//const Puppet = require("./puppeteer")
class Bin {
  constructor(kernel) {
    this.kernel = kernel
    this.arch = os.arch()
    this.platform = os.platform()
    this.mods = [{
      name: "homebrew",
      mod: new Brew(this)
    }, {
      name: "cmake",
      mod: new Cmake(this)
    }, {
      name: "python",
      mod: new Python(this)
    }, {
      name: "git",
      mod: new Git(this)
    }, {
      name: "node",
      mod: new Node(this)
    }, {
      name: "conda",
      mod: new Conda(this)
//    }, {
//      name: "puppeteer",
//      mod: new Puppet(this)
    }]
  }
  paths() {
    let modpaths = this.mods.map((mod) => {
      return mod.mod.path
    }).filter(x => x)
    return _.flatten(modpaths)
  }
  async is_installed(name) {
    let mod = this.mod(name)
    if (mod) {
      if (mod.path) {
        if (mod.check && typeof mod.check === 'function') {
          let installed = await mod.check()
          return installed
        } else {
          let installed = true
          if (Array.isArray(mod.path)) {
            for(let p of mod.path) {
              let exists = await this.exists(p)
              if (!exists) installed = false 
            }
          } else {
            let exists = await this.exists(mod.path)
            if (!exists) installed = false 
          }

//          const bin_folder = this.path(name)
//          let installed
//          let exists = await this.exists(bin_folder)
//          if (exists) {
//            // check that the folder is not empty
//            let files = await fs.promises.readdir(bin_folder)
//            if (files.length > 0) {
//              let bin_exists = await this.exists(mod.path)
//              installed = true
//            } else {
//              installed = false
//            }
//          } else {
//            installed = false
//          }
          return installed
        }
      } else {
        if (mod.check) {
          if (typeof mod.check === 'function') {
            let installed = await mod.check()
            return installed
          } else if (mod.check.pattern) {
            let installed = false
            await this.sh({
              message: mod.check.run,
            }, async (stream) => {
              if (this.regex(mod.check.pattern).test(stream.cleaned)) {
                installed = true
              }
              process.stdout.write(stream.raw)
            })
            return installed
          } else if (mod.check.negative) {
            let installed = true
            await this.sh({
              message: mod.check.run,
            }, async (stream) => {
              if (this.regex(mod.check.negative).test(stream.cleaned)) {
                installed = false
              }
            })
            return installed
          }
        } else {
          // assume installed (linux for now)
          return true
        }
      }
    } else {
      return false
    }
  }
  regex (str) {
    let matches = /^\/([^\/]+)\/([dgimsuy]*)$/.exec(str)
    if (!/g/.test(matches[2])) {
      matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
    }
    return new RegExp(matches[1], matches[2])
  }
  async init() {
    this.installed = {}
    for(let mod of this.mods) {
      let installed = await this.is_installed(mod.name)
      this.installed[mod.name] = installed
    }
    if (Object.values(this.installed).filter(x => x).length === this.mods.length) {
      this.all_installed = true
    } else {
      this.all_installed = false
    }
  }
  async bootstrap(req, ondata) {
    for(let mod of this.mods) {
      try {
        let installed = await this.is_installed(mod.name)
        if (!installed) await this.install(mod.name, null, ondata)
      } catch (e) {
        console.log(e.message)
      }
    }
    await this.init()
    return "success"
  }
  exists(_path) {
    return new Promise(r=>fs.access(_path, fs.constants.F_OK, e => r(!e)))
  }
  path(...args) {
    return this.kernel.path("bin", ...args)
  }
  mod(name) {
    let filtered = this.mods.filter((m) => {
      return m.name === name
    })
    return (filtered.length > 0 ? filtered[0].mod : null)
  }
  async install(name, options, ondata) {
    await this.mod(name).rm({}, ondata)
    await this.mod(name).install(options, ondata)
  }
  async sh(params, ondata) {
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Bin
