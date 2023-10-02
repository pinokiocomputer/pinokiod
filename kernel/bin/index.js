const os = require('os')
const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const { rimraf } = require('rimraf')
const { DownloaderHelper } = require('node-downloader-helper');

const Cmake = require("./cmake")
const Python = require('./python')
const Git = require('./git')
const Node = require('./node')
const Brew = require("./brew")
const Conda = require("./conda")
const Win = require("./win")
const Ffmpeg = require("./ffmpeg")
const Aria2 = require('./aria2')
const Zip = require('./zip')
const LLVM = require('./llvm')
const VS = require("./vs")
const Cuda = require("./cuda")
//const Puppet = require("./puppeteer")
class Bin {
  constructor(kernel) {
    this.kernel = kernel
    this.arch = os.arch()
    this.platform = os.platform()
  }
  async exec(params, ondata) {
    params.path = this.path()
    if (this.client) {
      params.cols = this.client.cols
      params.rows = this.client.rows
    }
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
  async download(url, dest, ondata) {
    const dl = new DownloaderHelper(url, this.path(), {
      fileName: dest
    })
    ondata({ raw: `\r\n` })
    let res = await new Promise((resolve, reject) => {
      dl.on('end', () => {
        console.log('Download Completed');
        resolve()
      })
      dl.on('error', (err) => {
        console.log('Download Failed', err)
        reject(err)
      })
      dl.on('progress', (stats) => {
        let p = Math.floor(stats.progress)
        let str = ""
        for(let i=0; i<p; i++) {
          str += "#"
        }
        for(let i=p; i<100; i++) {
          str += "-"
        }
        ondata({ raw: `\r${str}` })
      })
      dl.start().catch((err) => {
        console.log('Download Failed', err)
        reject(err)
      })
    })
    ondata({ raw: `\r\n` })

  /*
    await this.exec({ message: `aria2 -o download.zip ${url}` })
    */
  }
  async unzip(filepath, dest, options, ondata) {
    await this.exec({ message: `7z x ${options ? options : ''} ${filepath} -o${dest}` }, ondata)
  }
  async rm(src, ondata) {
    ondata({ raw: `rm ${src}\r\n` })
    await fs.promises.rm(this.path(src), { recursive: true })
    //await rimraf(src)
    ondata({ raw: `success\r\n` })
  }
  async mv(src, dest, ondata) {
    ondata({ raw: `mv ${src} ${dest}\r\n` })
    await fs.promises.rename(this.path(src), this.path(dest))
    ondata({ raw: `success\r\n` })
  }
  exists(_path) {
    let abspath = this.path(_path)
    return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
  }

  /*
    env(kernel)
    init(kernel)
    installed(kernel)
    install(req, ondata, kernel)
    uninstall(req, ondata, kernel)
  */
  merge_env(existing, merge) {
    // merge 'merge' into 'existing'
    for(let key in merge) {
      let val = merge[key]
      if (Array.isArray(val)) {
        if (typeof existing[key] === 'undefined') {
          existing[key] = val
        } else {
          existing[key] = existing[key].concat(val)
        }
      } else {
        existing[key] = val
      }
    }
    return existing
  }
  envs(override_env) {
    // return a single merged env object, constructed from all the modules

    // 1. get the module envs
    let envs = this.mods.map((mod) => {
      if (mod.mod.env) {
        return mod.mod.env(this.kernel)
      } else {
        return null
      }
    }).filter(x => x)

    // 2. Merge module envs
    let e = {}
    for(let env of envs) {
      e = this.merge_env(e, env)
    }

    // 3. Merge override_envs
    e = this.merge_env(e, override_env)

    return e
  }
  async init() {
    const bin_folder = this.path()
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => { })
    // ORDERING MATTERS.
    // General purpose package managers like conda, conda needs to come at the end
    this.mods = [{
      name: "conda",
      mod: new Conda()
    }, {
      name: "git",
      mod: new Git()
    }, {
      name: "zip",
      mod: new Zip()
    }, {
      name: "ffmpeg",
      mod: new Ffmpeg()
    }, {
      name: "torch",
      mod: new Torch()
    }]

    if (this.platform === 'win32') {
      this.mods.push({
        name: "vs",
        mod: new VS()
      })
    } else if (this.platform === 'darwin') {
      this.mods.push({
        name: "homebrew",
        mod: new Brew()
      })
    } else if (this.platform === "linux") {
    }
//    this.mods.push({
//      name: "llvm",
//      mod: new LLVM(this)
//    })

    // inject kernel
    for(let i=0; i<this.mods.length; i++) {
      this.mods[i].mod.kernel = this.kernel 
    }

    this.installed = {}
    this.mod = {}
    for(let mod of this.mods) {
      if (mod.mod.init) {
        await mod.mod.init()
      }
      let installed = await mod.mod.installed(this.kernel)
      if (mod.mod.init) {
        await mod.mod.init()
      }
      this.installed[mod.name] = installed
      this.mod[mod.name] = mod.mod
    }
    if (Object.values(this.installed).filter(x => x).length === this.mods.length) {
      this.all_installed = true
    } else {
      this.all_installed = false
    }
  }
  async bootstrap(req, ondata) {
    let home = req.params.home
    this.kernel.store.set("home", home)
    await this.kernel.init()
    for(let mod of this.mods) {
      let installed = await mod.mod.installed(this.kernel)
      if (!installed) {
        await mod.mod.install(req, ondata, this.kernel)
      }
    }
    return "success"
  }


/*********************************
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
    const bin_folder = this.path()
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
    // ORDERING MATTERS.
    // General purpose package managers like conda, conda needs to come at the end
    if (this.platform === 'win32') {
      this.mods = [{
        // this must come first, so that this compiler is used instead of any potential compiler that may be installed via pip or conda automatically
        name: "win",
        mod: new Win(this)
      }, {
        name: "node",
        mod: new Node(this)
      }, {
        name: "python",
        mod: new Python(this)
      }, {
        name: "cmake",
        mod: new Cmake(this)
      }, {
        name: "ffmpeg",
        mod: new Ffmpeg(this)
      }, {
        name: "git",
        mod: new Git(this)
      }, {
        name: "aria2",
        mod: new Aria2(this)
      }, {
        name: "conda",
        mod: new Conda(this)
      }]
    } else {
      this.mods = [{
        name: "python",
        mod: new Python(this)
      }, {
        name: "node",
        mod: new Node(this)
      }, {
        name: "cmake",
        mod: new Cmake(this)
      }, {
        name: "ffmpeg",
        mod: new Ffmpeg(this)
      }, {
        name: "homebrew",
        mod: new Brew(this)
      }, {
        name: "git",
        mod: new Git(this)
      }, {
        name: "aria2",
        mod: new Aria2(this)
      }, {
        name: "conda",
        mod: new Conda(this)
      }]

    }

//    if (this.platform !== "darwin") {
//      // check if cuda compatible
//      let re = /cuda version/i
//      let cuda_compatible;
//      await this.bin.sh({
//        message: "nvidia-smi"
//      }, (stream) => {
//        ondata(stream)
//        if (re.test(stream.cleaned)) {
//          cuda_compatible = true
//        }
//        process.stdout.write(stream.raw)
//      })
//      console.log("cuda_compatible", cuda_compatible)
//      ondata({ raw: `cuda_compatible: ${cuda_compatible}` })
//
//      // if cuda_compatible, install cudatools and cudnn
//      if (cuda_compatible) {
//        this.mods.push({
//          name: "cuda",
//          mod: new Cuda(this)
//        })
//      }
//    }


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
    let home = req.params.home
    this.kernel.store.set("home", home)
    await this.kernel.init()
    for(let mod of this.mods) {
      let installed = await this.is_installed(mod.name)
      if (!installed) await this.install(mod.name, null, ondata)
    }
    return "success"
  }
  exists(_path) {
    return new Promise(r=>fs.access(_path, fs.constants.F_OK, e => r(!e)))
  }
*********************************/

  path(...args) {
    return this.kernel.path("bin", ...args)
  }
  mod(name) {
    let filtered = this.mods.filter((m) => {
      return m.name === name
    })
    return (filtered.length > 0 ? filtered[0].mod : null)
  }
  //async install(name, options, ondata) {
  //  await this.mod(name).rm({}, ondata)
  //  await this.mod(name).install(options, ondata)
  //}
  async install(req, ondata) {
    /*
      req.params := {
        client: {
        },
        requirements: [{
          type: "bin"|"api",
          uri: <name>
        }, {
          ...
        }]
      }
    */
    console.log("<INSTALL>", req)
    if (req.client) {
      this.client = req.client
    } else {
      this.client = null
    }

    let requirements = JSON.parse(req.params)
    console.log("requirements", requirements)
    for(let requirement of requirements) {
      let type = requirement.type
      let uri = requirement.uri
      if (requirement.installed) {
        console.log("Already installed", requirement)
      } else {
        console.log("Not yet installed", requirement)
        if (type === "bin") {
          // find the mod
          for(let m of this.mods) {
            if (m.name === uri) {
              //await m.mod.install(this, ondata)
              console.log("########### Installing", requirement)
              await m.mod.install(requirement, ondata, this.kernel)
              break
            }
          }
        }
      }
    }
  }
  async sh(params, ondata) {
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Bin
