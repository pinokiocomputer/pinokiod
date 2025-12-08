const os = require('os')
const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const { rimraf } = require('rimraf')
const { DownloaderHelper } = require('node-downloader-helper');
const { ProxyAgent } = require('proxy-agent');

//const Cmake = require("./cmake")
const Python = require('./python')
const Git = require('./git')
const Node = require('./node')
const CLI = require('./cli')
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
const { detectCommandLineTools } = require('./xcode-tools')
const { buildCondaListFromMeta } = require('./conda-meta')
const { glob } = require('glob')
const fakeUa = require('fake-useragent');
const fse = require('fs-extra')
const semver = require('semver')
//const { bootstrap } = require('global-agent')
const Environment = require('../environment')
const Util = require("../util")
//const imageToAscii = require("image-to-ascii");

const Setup = require('./setup')


//const Puppet = require("./puppeteer")
class Bin {
  constructor(kernel) {
    this.kernel = kernel
    this.arch = os.arch()
    this.platform = os.platform()
  }
  async shell_kill(params, ondata) {
    console.log("shell_kill", params)
    this.kernel.shell.kill(params.params)
  }
  async shell_start(params, ondata) {
    params.path = params.path || this.path()
    if (this.client) {
      params.cols = this.client.cols
      params.rows = this.client.rows
    }
    let response = await this.kernel.shell.start(params, null, ondata)
    return response
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
//  img2Txt(imgPath, options) {
//    return new Promise((resolve, reject) => {
//      imageToAscii(imgPath, options, (err, converted) => {
//        console.log("ImgToAscii Error", err)
//        resolve(converted)
//      })
//    })
//  }
  async download(url, dest, ondata) {
    const agent = new ProxyAgent();
    const userAgent = fakeUa()
    const opts = {
      fileName: dest,
      override: true,
      headers: {
        "User-Agent": userAgent
      }
    }
    if (process.env.HTTP_PROXY && process.env.HTTP_PROXY.length > 0) {
      opts.httpRequestOptions = { agent }
      opts.httpsRequestOptions = { agent }
    }
    if (process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.length > 0) {
      opts.httpRequestOptions = { agent }
      opts.httpsRequestOptions = { agent }
    }
    const dl = new DownloaderHelper(url, this.path(), opts)
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
    this.requirements_cache = {}
    this.mods = []
    if (this.kernel.homedir) {
      const bin_folder = this.path()
      await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => { })
      if (this.platform !== "linux") {
        const playwright_folder = path.resolve(bin_folder, "playwright/browsers")
        process.env.PLAYWRIGHT_BROWSERS_PATH = playwright_folder
      }
//      await fs.promises.mkdir(playwright_folder, { recursive: true }).catch((e) => { })
      let system_env = await Environment.get(this.kernel.homedir, this.kernel)

      if (system_env.HTTP_PROXY) {
        process.env.HTTP_PROXY = system_env.HTTP_PROXY
      } else {
        if (process.env.HTTP_PROXY) {
          delete process.env.HTTP_PROXY
        }
      }
      if (system_env.HTTPS_PROXY) {
        process.env.HTTPS_PROXY = system_env.HTTPS_PROXY
      } else {
        if (process.env.HTTPS_PROXY) {
          delete process.env.HTTPS_PROXY
        }
      }
      if (system_env.NO_PROXY) {
        process.env.NO_PROXY = system_env.NO_PROXY
      } else {
        if (process.env.NO_PROXY) {
          delete process.env.NO_PROXY
        }
      }
    }


//    bootstrap();

    // ORDERING MATTERS.
    // General purpose package managers like conda, conda needs to come at the end

    let modfiles = (await fs.promises.readdir(__dirname)).filter((file) => {
      return file.endsWith(".js") && file !== "index.js" && file !== "cmake.js"
    })

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

      // initialize pipconfig
      let pipconfig_path = path.resolve(this.kernel.homedir, "pipconfig")
      let pipconfig_exists = await this.kernel.api.exists(pipconfig_path)
      // if not, create one
      if (!pipconfig_exists) {
        const pipconfigStr = `[global]
  timeout = 1000`
        await fs.promises.writeFile(pipconfig_path, pipconfigStr) 
      }

//      // add gitconfig => support git lfs, long path, etc.
//      let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
//      // check if gitconfig exists
//      await fs.promises.copyFile(
//        path.resolve(__dirname, "..", "gitconfig_template"),
//        gitconfig_path
//      )

      for(let mod of this.mods) {
        if (mod.mod.start) {
          await mod.mod.start()
        }
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
    let conda_versions = {}

    //////////////////////////////////////////////////////////////////
    // exception handling
    // if importlib_metadata || uvicorn || fastapi exist in the base environment, this.correct_conda = false
    let site_packages_path
    if (this.platform === "win32") {
      site_packages_path = path.resolve(this.kernel.homedir, "bin/miniconda/Lib/site-packages")
    } else {
      site_packages_path = path.resolve(this.kernel.homedir, "bin/miniconda/lib/python3.10/site-packages")
    }
//    // check if any of 'uvicorn', 'importlib_metadata', 'fastapi' exists
//    let module_paths = ["fastapi", "uvicorn", "importlib_metadata"].map((name) => {
//      return path.resolve(site_packages_path, name)
//    })
//    let to_reset_exists = false
//    for(let module_path of module_paths) {
//      let e = await this.kernel.exists(module_path)
//      console.log("checking kernel exists", { module_path, e })
//      if (e) {
//        to_reset_exists = true
//        break;
//      }
//    }
//    console.log("> to_reset_exists", to_reset_exists)

    let to_reset_exists = false

    if (to_reset_exists) {
      this.correct_conda = false
    } else {
      let res = await buildCondaListFromMeta(this.kernel.bin.path("miniconda"))
      let lines = res.response.split(/[\r\n]+/)
      for(let line of lines) {
        if (start) {
          let chunks = line.split(/\s+/).filter(x => x)
          if (chunks.length > 2) {
            let name = chunks[0]
            let version = chunks[1]
            conda.add(name)
            conda_versions[name] = version
            if (name === "conda") {
              conda_check.conda = true
            }
            if (name === "conda-libmamba-solver") {
              //if (String(version) === "24.7.0") {
              let channel = chunks[3]
              let coerced = semver.coerce(version)
              let mamba_requirement = ">=25.4.0"
              //if (semver.satisfies(coerced, mamba_requirement) && channel === "conda-forge") {
              if (semver.satisfies(coerced, mamba_requirement)) {
                conda_check.mamba = true
              }
            }
            // Use sqlite to check if `conda update -y --all` went through successfully
            // sometimes it just fails silently so need to check
            if (name === "sqlite") {
              if (String(version) === "3.47.2") {
                conda_check.sqlite = true
              }
            }
          }
        } else {
          if (/.*name.*version.*build.*channel/i.test(line)) {
            start = true 
          }
        }
      }

      if (conda_check.conda && conda_check.mamba && conda_check.sqlite) {
      //if (conda_check.conda && conda_check.mamba) {
        this.correct_conda = true
      }
    }
    this.installed.conda = conda
    this.installed.conda_versions = conda_versions
  }
  async refreshInstalled() {

    /// A. installed packages detection

    this.installed_initialized = false

    //this.installed = {}

    // 1. conda

    // check conda location and see if it exists. only run if it exists
    let conda_path = path.resolve(this.kernel.homedir, "bin", "miniconda")
    let conda_exists = await this.exists(conda_path)

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

    if (this.platform === "darwin") {
      // 3. brew

      let brew_path = path.resolve(this.kernel.homedir, "bin", "homebrew")
      let brew_exists = await this.exists(brew_path)

      let brew = []
      if (brew_exists) {
        const cellarPath = path.resolve(brew_path, "Cellar")
        let usedCellar = false
        try {
          const entries = await fs.promises.readdir(cellarPath, { withFileTypes: true })
          brew = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
          usedCellar = true
        } catch (err) {
          console.log("[brew] cellar scan failed, falling back to brew list -1", err)
        }

        if (!usedCellar) {
          start = false
          res = await this.exec({ message: `brew list -1`, conda: { skip: true } }, () => { })
          lines = res.response.split(/[\r\n]+/).slice(0, -1)  // ignore last line since it's the prompt
          const parsed = lines
            .map((raw) => raw.trim())
            .filter((line) => line.length > 0 && !/^==>/.test(line))
          for (const line of parsed) {
            brew = brew.concat(line.split(/\s+/).filter(Boolean))
          }
        }
      }
      this.installed.brew = new Set(brew)


      // check brew_installed
      let e = await this.kernel.bin.exists("homebrew")
      const cltStatus = await detectCommandLineTools({
        exec: (params) => this.exec(params, () => {})
      })
      console.log({ cltStatus })
      this.brew_installed = e && cltStatus.valid

      console.log("brew_installed", this.brew_installed)

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
  async tryInstall(id, requirement, x, i, total, ondata) {
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
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify2")
          await this.exec({ message }, ondata)
        } else if (type === "pip") {
          const message = (install ? install : `pip install ${name} ${args}`)
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify2")
          await this.exec({ message }, ondata)
        } else if (type === "brew") {
          const message = (install ? install : `brew install ${name} ${args}`)
          ondata({ html: `<b>${progress} Installing ${name}</b><br>${message}` }, "notify2")
          await this.exec({ message }, ondata)
        } else {
          // find the mod
          for(let m of this.mods) {
            if (m.name === name) {
              //await m.mod.install(this, ondata)
              const message = `${m.mod.description ? '<br>' + m.mod.description : ''}`
              ondata({ html: `<b><i class="fas fa-circle-notch fa-spin"></i> ${progress} Installing ${name}</b>${message}` }, "notify2")
              console.log("## Before m.mod.install", requirement)
              requirement._attempt = x
              await m.mod.install(requirement, ondata, this.kernel, id)

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
  async path_exists(req, ondata) {
    let abspath = this.kernel.api.resolvePath(this.kernel.api.userdir, req.params.uri)
    if (abspath) {
      console.log({ abspath })
      let exists = await new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
      return exists
    } else {
      return false
    }
  }
  async install2(req, ondata) {
    let { requirements, install_required, requirements_pending, error } = await this.check({
      bin: this.preset("dev")
    })
    req.params = JSON.stringify(requirements)
    if (this.install_required) {
      let res = await this.install(req, ondata)
      return res
    }
  }
  async resolveInstallRequirements(req, ondata) {
    let params = req.params
    let mode = req.mode
    if (typeof params === 'string') {
      let trimmed = params.trim()
      if (trimmed.length === 0) {
        params = null
      } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          params = JSON.parse(trimmed)
        } catch (e) {
          params = trimmed
        }
      } else {
        params = trimmed
      }
    }
    if (Array.isArray(params)) {
      return params
    }
    if (params && typeof params === 'object') {
      if (Array.isArray(params.requirements)) {
        return params.requirements
      }
      if (typeof params.mode === 'string' && params.mode.trim().length > 0) {
        mode = params.mode.trim()
      }
    }
    if (!mode && typeof params === 'string' && params.length > 0) {
      mode = params
    }
    if (!mode && req.params && typeof req.params.mode === 'string' && req.params.mode.trim().length > 0) {
      mode = req.params.mode.trim()
    }
    if (!mode && typeof req.mode === 'string' && req.mode.trim().length > 0) {
      mode = req.mode.trim()
    }
    if (!mode) {
      throw new Error('kernel.bin.install requires `requirements` array or `mode` string in params')
    }
    const preset = this.preset(mode)
    if (!preset) {
      const available = Object.keys(Setup).sort().join(', ')
      throw new Error(`Unknown setup mode "${mode}". Available modes: ${available}`)
    }
    if (ondata) {
      ondata({ html: `<b>Resolving setup preset "${mode}"</b>` }, 'notify2')
    }
    const { requirements } = await this.check({ bin: preset })
    return Array.isArray(requirements) ? requirements : []
  }
//  async init_launcher(req, ondata) {
//    console.log("init_launcher", req)
//    try {
//      let projectType = req.params.projectType
//      let startType = req.params.cliType || req.params.startType
//      console.log({ projectType, startType })
//
//      let cwd = req.cwd
//      let name = req.name
//      let payload = {}
//      payload.cwd = path.resolve(cwd, name)
//      payload.input = req.params
//
//      let mod_path = path.resolve(__dirname, "../proto", projectType, startType)
//      let mod = await this.kernel.require(mod_path)
//
//      await mod(payload, ondata, this.kernel)
//
//      // copy readme
//      let readme_path = path.resolve(__dirname, "../proto/PINOKIO.md")
//      console.log("copy to", readme_path, path.resolve(cwd, name, "PINOKIO.md"))
//      await fs.promises.cp(readme_path, path.resolve(cwd, name, "PINOKIO.md"))
//
//      // copy CLI.md
//      let cli_readme_path = 
//
//      return { success: "/p/" + name }
//    } catch (e) {
//      console.log("ERROR", e)
//      return { error: e.stack }
//    }
//  }
  async filepicker(req, ondata) {
    let res = await Util.filepicker(req, ondata, this.kernel)
    return res
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
    let requirements = await this.resolveInstallRequirements(req, ondata)
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
          await this.tryInstall(req.id, requirement, x, i, requirements.length, ondata)
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
    await this.kernel.proto.init()

    if (this.kernel.shell) {
      this.kernel.shell.reset()
    }

//    await this.init()
  }
  async check_installed(r, dependencies) {
    if (Array.isArray(r.name)) {
      for(let name of r.name) {
        let d = Date.now()
        let installed = await this._installed(name, r.type, dependencies)
        if (!installed) return false
      }
      return true
    } else {
      let installed = await this._installed(r.name, r.type, dependencies)
      return installed
    }
  }
  async _installed(name, type, dependencies) {
    if (type === "conda") {
      let conda_installed = this.installed.conda.has(name)
      let dependencies_installed = true
      for(let d of dependencies) {
        if(!this.installed.conda.has(d)) {
          dependencies_installed = false
          break
        }
      }
      return conda_installed && dependencies_installed
    } else if (type === "pip") {
      return this.installed.pip && this.installed.pip.has(name)
    } else if (type === "brew") {
      return this.installed.brew.has(name)
    } else {
      // check kernel/bin/<module>.installed()
      let filepath = path.resolve(__dirname, "..", "kernel", "bin", name + ".js")
      let mod = this.mod[name]
      let installed = false
      /*
      if (!this.cached_mod_installed) {
        this.cached_mod_installed = {}
      }
      if (this.cached_mod_installed[name] === true) {
        return true
      } else {
        if (mod.installed) {
          installed = await mod.installed()
          if (installed) {
            this.cached_mod_installed[name] = true
          }
        }
        return installed
      }
      */

      if (mod.installed) {
        installed = await mod.installed()
      }
      return installed
    }
  }
  preset(mode) {
    return Setup[mode](this.kernel)
  }
  requirements(config) {
    let requirements = config.bin.requirements
    if (config.script && config.script.requires && config.script.requires.length > 0) {
      /*********************************************************************

      {
        requires: [{
          platform,
          type,
          name,
          args
        }, {
          platform,
          type,
          name,
          args
        }],
        run: [{
          ...
        }]
      }

      syntax :=

        {
          platform: <win32|darwin|linux>,
          type: <conda|pip|brew|none>,
          name: <package name>,           (example: "ffmpeg", "git")
          args: <install command flags>   (example: "-c conda-forge")
        }


      1. pinokio native install: no need for specifying platforms since they are included

        {
          name: "conda"
        }


      2. non native install (conda, pip, brew)

        2.1. Same on all platforms 

        [{
          type: "conda",
          name: "ffmpeg",
          args: "-c conda-forge"
        }]

        2.2. Specify per platform


        [
          { name: "conda" },
          { platform: "darwin", type: "brew", name: "llvm" },
          { platform: "linux", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" },
          { platform: "win32", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" }
        ]

        [
          { name: "conda" },
          { platform: ["darwin", "linux"], type: "brew", name: "llvm" },
          { platform: "win32", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" }
        ]



      *********************************************************************/
      let type_name_set = new Set()
      for(let r of config.script.requires) {
        // if no platform specified, or if the specified platform matches the current platform
        if (!r.platform || platform === r.platform || Array.isArray(r.platform) && r.platform.includes(platform) ) {
          if (Array.isArray(r.name)) {
            // if array, just add it
            requirements.push(r)
          } else {
            let type_name = `${r.type ? r.type : ''}/${r.name}`
            if (!type_name_set.has(type_name)) {
              type_name_set.add(type_name)
              requirements.push(r)
            }
          }
        }
      }

    }
    return requirements
  }
  relevant(r) {
    /*
      single platform
      [
        { name: "conda" },
        { platform: "darwin", type: "brew", name: "llvm" },
        { platform: "linux", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" },
        { platform: "win32", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" }
      ]

      multiple platforms
      [
        { name: "conda" },
        { platform: ["darwin", "linux"], type: "brew", name: "llvm" },
        { platform: "win32", tyoe: "conda", name: "llvm", args: "-c conda-forge llvm" }
      ]


      platform & arch
      [
        { name: "conda" },
        { platform: "darwin", arch: ["arm64", "x64"], type: "brew", name: "llvm" },
      ]
    */

    let platform = os.platform()
    let arch = os.arch()
    let gpu = this.kernel.gpu
    let relevant = {
      platform: false,
      arch: false,
      gpu: false,
    }
    if (r.platform) {
      if (Array.isArray(r.platform)) {
        // multiple items
        if (r.platform.includes(platform)) {
          relevant.platform = true
        }
      } else {
        // one item
        if (r.platform === platform) {
          relevant.platform = true
        }
      }
    } else {
      // all platforms
      relevant.platform = true
    }
    if (r.arch) {
      if (Array.isArray(r.arch)) {
        // multiple items
        if (r.arch.includes(arch)) {
          relevant.arch = true
        }
      } else {
        // one item
        if (r.arch === arch) {
          relevant.arch = true
        }
      }
    } else {
      // all platforms
      relevant.arch = true
    }
    if (r.gpu) {
      if (Array.isArray(r.gpu)) {
        // multiple items
        if (r.gpu.includes(gpu)) {
          relevant.gpu = true
        }
      } else {
        // one item
        if (r.gpu === gpu) {
          relevant.gpu = true
        }
      }
    } else {
      // all platforms
      relevant.gpu = true
    }
    return relevant.platform && relevant.arch && relevant.gpu
  }
  async check(config) {
    if (typeof this.kernel.binCheckDepth !== 'number') {
      this.kernel.binCheckDepth = 0
    }
    this.kernel.binCheckDepth++
    let requirements = this.requirements(config)
    let requirements_pending = !this.installed_initialized
    let install_required = true
    if (!requirements_pending) {
      install_required = false
      for(let i=0; i<requirements.length; i++) {
        let r = requirements[i]
        let fingerprint = JSON.stringify(r)
        let installed
        if (fingerprint in this.requirements_cache) {
          let relevant = this.relevant(r)
          requirements[i].relevant = relevant
          if (relevant) {
            let dependencies
            if (r.name === "conda") {
              dependencies = config.bin.conda_requirements
              requirements[i].dependencies = dependencies
            }
            installed = this.requirements_cache[fingerprint]
            requirements[i].installed = this.requirements_cache[fingerprint]
          }
        } else {
          //let installed = await this.installed(r)
          //requirements[i].installed = installed
          //if (!installed) {
          //  install_required = true
          //}
          let relevant = this.relevant(r)
          requirements[i].relevant = relevant
          if (relevant) {
            let dependencies
            if (r.name === "conda") {
              dependencies = config.bin.conda_requirements
              requirements[i].dependencies = dependencies
            }
            installed = await this.check_installed(r, dependencies)
            this.requirements_cache[fingerprint] = installed
            //if (installed) {
            //  // cache if true
            //  this.requirements_cache[fingerprint] = true
            //}
            requirements[i].installed = installed
          }
        }
        if (!installed) {
          install_required = true
        }
      }
    }

    let error = null
    try {
      this.compatible()
    } catch (e) {
      error = e.message
      install_required = true
    }

    this.install_required = install_required
    this.requirements_pending = requirements_pending

    requirements = requirements.filter((r) => {
      return r.relevant
    })
    this.kernel.binCheckDepth--
    return {
      error,
      title: config.bin.title,
      description: config.bin.description,
      icon: config.bin.icon,
      requirements,
      install_required,
      requirements_pending
    }
  }
  winBuildNumber() {
    let osVersion = (/(\d+)\.(\d+)\.(\d+)/g).exec(os.release());
    let buildNumber = 0;
    if (osVersion && osVersion.length === 4) {
        buildNumber = parseInt(osVersion[3]);
    }
    return buildNumber;
  }
  compatible() {
    if (this.kernel.platform === "win32") {
      let buildNumber = this.winBuildNumber() 
      if (buildNumber < 18309) {
        // must use conpty for node-pty, and conpty is only supported in win>=18309
        console.log("Windows buildNumber", buildNumber)
        throw new Error(`Pinokio supports Windows release 18309 and up (current system: ${buildNumber}`)
      }

//      if (buildNumber > 25000) {
//        console.log("Windows buildNumber", buildNumber)
//        throw new Error(`Pinokio does not currently support Windows Canary (versions 25000 and up). The current system is ${buildNumber}`)
//        
//      }
    }
  }
  async sh(params, ondata) {
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Bin
