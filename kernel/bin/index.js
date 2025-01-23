const os = require('os')
const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const { rimraf } = require('rimraf')
const { DownloaderHelper } = require('node-downloader-helper');

//const Cmake = require("./cmake")
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
const Torch = require("./torch")
const { glob } = require('glob')
const fakeUa = require('fake-useragent');
const fse = require('fs-extra')
const semver = require('semver')


//const Puppet = require("./puppeteer")
class Bin {
  constructor(kernel) {
    this.kernel = kernel
    this.arch = os.arch()
    this.platform = os.platform()
  }
  async exec(params, ondata) {
    params.path = params.path || this.path()
    if (this.client) {
      params.cols = this.client.cols
      params.rows = this.client.rows
    }
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
  async download(url, dest, ondata) {
    const userAgent = fakeUa()
    console.log("download userAgent", userAgent)
    const dl = new DownloaderHelper(url, this.path(), {
      fileName: dest,
      override: true,
      headers: {
        "User-Agent": userAgent
      }
    })
    ondata({ raw: `\r\nDownloading ${url} to ${this.path()}...\r\n` })
    let res = await new Promise((resolve, reject) => {
      dl.on('end', () => {
        ondata({ raw: `\r\nDownload Complete!\r\n` })
        resolve()
      })
      dl.on('error', (err) => {
        ondata({ raw: `\r\nDownload Failed: ${err.message}!\r\n` })
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
        ondata({ raw: `\r\nDownload Failed: ${err.message}!\r\n` })
        reject(err)
      })
    })

  /*
    await this.exec({ message: `aria2 -o download.zip ${url}` })
    */
  }
  async unzip(filepath, dest, options, ondata) {
    await this.exec({ message: `7z x ${options ? options : ''} ${filepath} -o${dest}` }, ondata)
  }
  async rm(src, ondata) {
    ondata({ raw: `rm ${src}\r\n` })
    await fs.promises.rm(this.path(src), { recursive: true }).catch((e) => {
//      ondata({ raw: `${e.stack}\r\n` })
    })
    //await rimraf(src)
    ondata({ raw: `success\r\n` })
  }
  async mv(src, dest, ondata) {
    ondata({ raw: `mv ${src} ${dest}\r\n` })
    await fse.move(this.path(src), this.path(dest))
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
      // Array => like PATH
      if (Array.isArray(merge[key])) {
        if (typeof existing[key] === 'undefined') {
          existing[key] = merge[key]
        } else {
          // if the env value is an array, it should be PREPENDED to the existing, in order to override
          if (existing[key]) {
            existing[key] = merge[key].concat(existing[key])
          } else {
            existing[key] = merge[key]
          }
        }
      } else {
        existing[key] = merge[key]
      }
    }
    return existing
  }
  envs(override_env) {
    // return a single merged env object, constructed from all the modules

    // 1. get the module envs
    let envs = this.mods.map((mod) => {
      if (mod.name === "vs") {
        // don't include vs now
        // instead, include it after conda activation, since this should be top priority and even higher priority than conda activated environment variables
        this.vs_path_env = mod.mod.env(this.kernel)
        return null
      } else {
        if (mod.mod.env) {
          return mod.mod.env(this.kernel)
        } else {
          return null
        }
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
    if (this.kernel.homedir) {
      const bin_folder = this.path()
      await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => { })
      if (this.platform !== "linux") {
        const playwright_folder = path.resolve(bin_folder, "playwright/browsers")
        process.env.PLAYWRIGHT_BROWSERS_PATH = playwright_folder
      }
//      await fs.promises.mkdir(playwright_folder, { recursive: true }).catch((e) => { })
    }
    // ORDERING MATTERS.
    // General purpose package managers like conda, conda needs to come at the end

    let modfiles = (await fs.promises.readdir(__dirname)).filter((file) => {
      return file.endsWith(".js") && file !== "index.js" && file !== "cmake.js"
    })

    this.mods = []
    for(let filename of modfiles) {
      // 1. get all the modules in __dirname
      // 2. load them
      // 3. create this.mods
      let filepath = path.resolve(__dirname, filename)
      let mod = (await this.kernel.loader.load(filepath)).resolved
      let name = path.basename(filename, ".js")
      this.mods.push({ name, mod })
    }
    // inject kernel
    for(let i=0; i<this.mods.length; i++) {
      this.mods[i].mod.kernel = this.kernel 
    }

    // init mods
    if (!this.mod) this.mod = {}
    if (!this.installed) this.installed = {}
    for(let mod of this.mods) {
      if (mod.mod.init) {
        await mod.mod.init()
      }
      this.mod[mod.name] = mod.mod
    }



    // write to pipconfig if it doesn't exist
    if (this.kernel.homedir) {
      try {
        await this.refreshInstalled()
      } catch (e) {
        console.log("RefreshInstalled Error", e)
      }
      let pipconfig_path = path.resolve(this.kernel.homedir, "pipconfig")
      let pipconfig_exists = await this.kernel.api.exists(pipconfig_path)
      // if not, create one
      if (!pipconfig_exists) {
        const pipconfigStr = `[global]
  timeout = 1000`
        await fs.promises.writeFile(pipconfig_path, pipconfigStr) 
  //      await fs.promises.copyFile(
  //        path.resolve(__dirname, "..", "pipconfig_template"),
  //        pipconfig_path
  //      )
      }
    }


    /*
      this.installed.conda = Set()
      this.installed.pip = Set()
      this.installed.brew = Set()
    */
  }
  async tryList() {
    let res
    let start
    let conda_check = {}
    let conda = new Set()

    //////////////////////////////////////////////////////////////////
    // exception handling
    // if importlib_metadata || uvicorn || fastapi exist in the base environment, this.correct_conda = false
    let site_packages_path
    if (this.platform === "win32") {
      site_packages_path = path.resolve(this.kernel.homedir, "bin/miniconda/Lib/site-packages")
    } else {
      site_packages_path = path.resolve(this.kernel.homedir, "bin/miniconda/lib/python3.10/site-packages")
    }
    // check if any of 'uvicorn', 'importlib_metadata', 'fastapi' exists
    let module_paths = ["fastapi", "uvicorn", "importlib_metadata"].map((name) => {
      return path.resolve(site_packages_path, name)
    })
    let to_reset_exists = false
    for(let module_path of module_paths) {
      let e = await this.kernel.exists(module_path)
      console.log({ e, module_path })
      if (e) {
        to_reset_exists = true
        break;
      }
    }
    console.log({ to_reset_exists })
    if (to_reset_exists) {
      this.correct_conda = false
    } else {
      res = await this.exec({ message: `conda list` }, (stream) => {
  //      process.stdout.write(stream.raw)
  //        console.log("conda list check", { stream })
      })

      let lines = res.response.split(/[\r\n]+/)
      for(let line of lines) {
        if (start) {
          let chunks = line.split(/\s+/).filter(x => x)
          if (chunks.length > 2) {
            let name = chunks[0]
            let version = chunks[1]
            conda.add(name)
            if (name === "conda") {
              //if (String(version) === "24.11.1") {
              if (String(version) === "24.11.3") {
                conda_check.conda = true
              }
            }
            if (name === "conda-libmamba-solver") {
              //if (String(version) === "24.7.0") {
              let channel = chunks[3]
              let coerced = semver.coerce(version)
              let mamba_requirement = ">=24.11.1"
              console.log({ name, channel, version })
              if (semver.satisfies(coerced, mamba_requirement) && channel === "conda-forge") {
                conda_check.mamba = true
              }
            }
            // Use sqlite to check if `conda update -y --all` went through successfully
            // sometimes it just fails silently so need to check
            if (name === "sqlite") {
              let coerced = semver.coerce(version)
              let sqlite_requirement = ">=3.47.2"
  //            console.log({ coerced, version, sqlite_requirement })
              if (semver.satisfies(coerced, sqlite_requirement)) {
                console.log("semver satisfied")
                conda_check.sqlite = true
              } else {
                console.log("semver NOT satisfied")
              }
            }
          }
        } else {
          if (/.*name.*version.*build.*channel/i.test(line)) {
            start = true 
          }
        }
      }

      console.log({ conda_check })
      if (conda_check.conda && conda_check.mamba && conda_check.sqlite) {
        this.correct_conda = true
      }
    }
    this.installed.conda = conda
  }
  async refreshInstalled() {

    console.log("refreshInstalled start")


    /// A. installed packages detection

    this.installed_initialized = false

    //this.installed = {}

    console.log("## check conda")

    // 1. conda

    // check conda location and see if it exists. only run if it exists
    let conda_path = path.resolve(this.kernel.homedir, "bin", "miniconda")
    let conda_exists = await this.exists(conda_path)
    console.log({ conda_path, conda_exists })

    let start
    let res
    let lines
    this.installed.conda = new Set()
    if (conda_exists) {
      // Try 3 times, because sometimes conda just silently quits with no error message
      for(let i=0; i<5; i++) {
        await this.tryList()
//        console.log(`> conda list ${i}`, Array.from(this.installed.conda))
        if (this.installed.conda.size > 0) {
          break 
        }
      }
    }

//    // 2. pip
//    let pip = new Set()
//    if (conda_exists) {
//      // conda comes with pip
//      console.log("## check pip")
//      start = false
//      res = await this.exec({ message: `pip list` }, (stream) => {
////        console.log("pip list check", { stream })
//      })
//      console.log("PIP", res.response)
//      lines = res.response.split(/[\r\n]+/)
//      for(let line of lines) {
//        if (start) {
//          let chunks = line.split(/\s+/).filter(x => x)
//          if (chunks.length > 1) {
//            pip.add(chunks[0])
//          }
//        } else {
//          if (/-------.*/i.test(line)) {
//            start = true 
//          }
//        }
//      }
//    }
//    this.installed.pip = pip
    

    if (this.platform === "darwin") {
      // 3. brew
      console.log("## check brew")

      let brew_path = path.resolve(this.kernel.homedir, "bin", "homebrew")
      let brew_exists = await this.exists(brew_path)
      console.log({ brew_path, brew_exists })

      let brew = []
      if (brew_exists) {
        start = false
        res = await this.exec({ message: `brew list -1`, conda: { skip: true } }, (stream) => {
//          console.log("brew list check", { stream })
        })
        console.log("BREW", res.response)
        lines = res.response.split(/[\r\n]+/).slice(0, -1)  // ignore last line since it's the prompt
        let end = false
        for(let line of lines) {
          if (start) {
            if (/^\s*$/.test(line)) {
              end = true
            } else {
              if (!end) {
                let chunks = line.split(/\s+/).filter(x => x)
                brew = brew.concat(chunks)
              }
            }
          } else {
            if (/==>/.test(line)) {
              start = true
            }
          }
        }
      }
      this.installed.brew = new Set(brew)


      // check brew_installed
      console.log("checking brew installed")
      let e = await this.kernel.bin.exists("homebrew")
      let { stdout }= await this.exec({ message: "xcode-select -p", conda: { skip: true } }, (stream) => { })
      let e2 = /(.*Library.*Developer.*CommandLineTools.*|.*Xcode.*Developer.*)/gi.test(stdout)
      let e3 = await this.kernel.exists("/Library/Developer/CommandLineTools")

      // if xcode-select version exists
      // - if version is greater thatn 2349 => yes
      // - if version lower than 2349 => no
      // if xcode-select version doesn't match
      // - no

      let e4;
      let result = await this.exec({ message: "xcode-select --version", conda: { skip: true } }, (stream) => { })
      if (result && result.stdout) {
        e4 = /xcode-select version ([0-9]+)/gi.exec(result.stdout)
        if (e4 && e4.length > 1) {
          let version = Number(e4[1]) 
          console.log("xcode-select version", version)
          if (version >= 2349) {
            e4 = true
          } else {
            e4 = false
          }
        } else {
          e4 = false
        }
      } else {
        e4 = false
      }
      console.log("BREW CHECK", { e, e2, e3, e4 })
      this.brew_installed = e && e2 && e3 && e4

    }

    if (this.platform === "win32") {
      this.registry_installed = await this.kernel.bin.mod.registry.installed()
      console.log("initial registry_installed", this.registry_installed)
    }

//    /// B. base path initialization
//    let conda_meta_path = this.kernel.bin.path("miniconda", "conda-meta")
//    const metaFiles = await glob("*.json", {
//      cwd: conda_meta_path
//    })
//
//    let paths = new Set()
//    for(let file of metaFiles) {
//      let r = (await this.kernel.loader.load(path.resolve(conda_meta_path, file))).resolved
//      let files = r.files
//      for(let f of r.files) {
//        paths.add(path.dirname(f))
//      }
//    }
//
//    console.log("metaFiles", metaFiles)
//    console.log("paths", paths)


    this.installed_initialized = true

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
  //async install(name, options, ondata) {
  //  await this.mod(name).rm({}, ondata)
  //  await this.mod(name).install(options, ondata)
  //}
  async tryInstall(requirement, i, total, ondata) {
    let current_platform = os.platform()
    let current_arch = os.arch()
    let current_gpu = this.kernel.gpu
    let type = requirement.type
    let platform = requirement.platform
    let arch = requirement.arch
    let gpu = requirement.gpu
    let name = requirement.name

    // name := ["protobuf", "rust", "cmake"]
    //  => 'conda install protobuf rust cmake'
    if (Array.isArray(name)) {
      name = name.join(" ")
    }

    let install = requirement.install // custom install command
    let args = requirement.args || ""
//    if (requirement.installed) {
//      console.log("Already installed", requirement)
//    } else {
//      console.log("Not yet installed", requirement)
      /*
        {
          platform: win32|darwin|linux|<none>,
          arch: x64|arm64,
          gpu: nvidia|amd|null,
          type: conda|pip|brew|npm,
          name: <package name>,
          install: <custom install command>, // example: "brew install hashicorp/tap/vault"
          args: <install flags>
        }
      */
      console.log({ gpu, current_gpu })
      //let percent = Math.floor(( i / requirements.length ) * 100)
      let progress = `(${i}/${total})`
      if ( (!platform ||platform === current_platform || (Array.isArray(platform) && platform.includes(current_platform))) &&
            (!arch || arch === current_arch) &&
            (!gpu || gpu === current_gpu) ) {
        if (type === "conda") {
          const message = (install ? install : `conda install ${name} -y ${args}`)
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify")
          await this.exec({ message }, ondata)
        } else if (type === "pip") {
          const message = (install ? install : `pip install ${name} ${args}`)
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify")
          await this.exec({ message }, ondata)
        } else if (type === "brew") {
          const message = (install ? install : `brew install ${name} ${args}`)
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify")
          await this.exec({ message }, ondata)
        } else {
          // find the mod
          for(let m of this.mods) {
            if (m.name === name) {
              //await m.mod.install(this, ondata)
              const message = `${m.mod.description ? '<br>' + m.mod.description : ''}`
              ondata({ html: `<b><i class="fas fa-circle-notch fa-spin"></i> ${progress} Installing ${name}</b>${message}` }, "notify")
              console.log("## Before m.mod.install", requirement)
              await m.mod.install(requirement, ondata, this.kernel)

//                // 2 second delay to fix conda issue
//                await new Promise((resolve, reject) => {
//                  setTimeout(() => {
//                    resolve()
//                  }, 2000)
//                })
              console.log("## After m.mod.install", requirement)
              break
            }
          }
        }

      }
//    }
  }
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
    if (req.client) {
      this.client = req.client
    } else {
      this.client = null
    }

    let requirements = JSON.parse(req.params)

    for(let x=0; x<10; x++) {
      console.log(`## Install Attempt ${x}`)
      let i = 0;
      for(let requirement of requirements) {
        i++;
        // Retry at least 5 times until it succeeds
        let installed = await this._installed(requirement.name, requirement.type)
        console.log(`## [${x}] Install Step 1: Check installed before installing`, requirement.name, installed)
        if (installed) {
          // skip
          console.log("already installed. skip.")
        } else {
          console.log("not installed. install.")
          await this.tryInstall(requirement, i, requirements.length, ondata)
        }
      }

      // refresh installed
      await this.refreshInstalled()

      // check all requirements if they're installed

      let install_success = true
      for(let requirement of requirements) {
        let installed = await this._installed(requirement.name, requirement.type)
        console.log(`## [${x}] Install Step 2: Check installed after installing`, requirement.name, installed)
        if (installed) {
          console.log("already installed.")
        } else {
          console.log("not installed.")
          install_success = false
          break
        }
      }

      // if install successful, break.
      // otherwise repeat
      console.log(`## [${x}] Install Step 3: All Installed? ${install_success}`)
      if (install_success) {
        console.log("Successful. Break")
        break
      } else {
        console.log("Not Successful. Retry.")
      }
    }
    //for(let requirement of requirements) {
    //  i++;
    //  // Retry at least 5 times until it succeeds
    //  for(let x=0; x<10; x++) {
    //    console.log(`## Install Interation: ${x}`)
    //    console.log(`## [${x}] Install Step 1: Try Install`, requirement)
    //    await this.tryInstall(requirement, i, requirements.length, ondata)
    //    console.log(`## [${x}] Install Step 2: Refresh Installed`)
    //    await this.refreshInstalled()
    //    console.log(`## [${x}] Install Step 3: Check Installed`, requirement)
    //    let installed = await this._installed(requirement.name, requirement.type)
    //    if (installed) {
    //      console.log(`## [${x}] Install Step 4: Installed Successful. Break`, requirement)
    //      break;
    //    } else {
    //      console.log(`## [${x}] Install Step 4: Install Unsuccessful. Retrying in 2 seconds`, requirement)
    //      await new Promise((resolve, reject) => {
    //        setTimeout(()=> {
    //          resolve()
    //        }, 2000)
    //      })
    //    }
    //  }
    //}
    await this.init()
  }
  async _installed(name, type) {
    if (type === "conda") {
      return this.kernel.bin.installed.conda.has(name)
    } else if (type === "pip") {
      return this.kernel.bin.installed.pip && this.kernel.bin.installed.pip.has(name)
    } else if (type === "brew") {
      return this.kernel.bin.installed.brew.has(name)
    } else {
      // check kernel/bin/<module>.installed()
      let filepath = path.resolve(__dirname, "..", "kernel", "bin", name + ".js")
      let mod = this.kernel.bin.mod[name]
      let installed = false
      if (mod.installed) {
        installed = await mod.installed()
      }
      return installed
    }
  }
  async sh(params, ondata) {
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Bin
