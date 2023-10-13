const fs = require('fs')
const os = require("os")
const path = require('path')
const fetch = require('cross-fetch');
const system = require('systeminformation');
const portfinder = require('portfinder');
const Loader = require("./loader")
const Bin = require('./bin')
const Api = require("./api")
const Template = require('./template')
const Shells = require("./shells")
const Config = require("./pinokio.json")
const VARS = {
  pip: {
    install: {
      torch: require("./vars/pip/install/torch")
    }
  }
}
//const memwatch = require('@airbnb/node-memwatch');
class Kernel {
  constructor(store) {
    this.fetch = fetch
    this.store = store
    this.arch = os.arch()
    this.platform = os.platform()
  }
  resumeprocess(uri) {
    let proc = this.procs[uri]
    if (proc && proc.resolve) {
      proc.resolve()
      this.procs[uri] = undefined
    }
  }
  status(uri, cwd) {
    let id = this.api.filePath(uri, cwd)
    return this.api.running[id]
  }
  port() {
    /**********************************************
    *
    *  let available_port = await kernel.port()
    *
    **********************************************/
    return portfinder.getPortPromise()
  }
  path(...args) {
    return path.resolve(this.homedir, ...args)
  }
  exists(...args) {
    let abspath = this.path(...args)
    return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
  }
  async init() {
    this.vars = {}
    for(let type in VARS) {
      let actions = VARS[type]
      if (!this.vars[type]) this.vars[type] = {}
      for(let action in actions) {
        if (!this.vars[type][action]) this.vars[type][action] = {}
        let Mods = actions[action]
        for(let modname in Mods) {
          if (!this.vars[type][action][modname]) this.vars[type][action][modname] = {}
          let mod = new Mods[modname]()
          this.vars[type][action][modname] = await mod.init()
        }
      }
    }
    console.log("this.vars", this.vars)

    let home = this.store.get("home")
    if (home) {
      this.homedir = home
    } else {
      this.homedir = path.resolve(os.homedir(), "pinokio")
    }
    console.log("homedir", this.homedir)
    this.loader = new Loader()
    this.bin = new Bin(this)
    this.api = new Api(this)
    this.shell = new Shells(this)
    this.system = system
    this.keys = {}
    this.memory = {
      local: {},
      global: {},
      key: (host) => {
        return this.keys[host]
      }
    }
    this.procs = {}
    this.template = new Template(this)
    try {
      await fs.promises.mkdir(this.homedir, { recursive: true }).catch((e) => {})
      await fs.promises.mkdir(path.resolve(this.homedir, "cache"), { recursive: true }).catch((e) => {})
      let contents = await fs.promises.readdir(this.homedir)
      await this.bin.init()
      await this.api.init()
      await this.template.init()

//      let PuppeteerPath = this.bin.path("puppet", "node_modules", "puppeteer")
//      this.puppet = (await this.loader.load(PuppeteerPath)).resolved
//      this.puppet.setGlobalOptions({
//        userDataDir: this.bin.path("puppet")
//      });

    } catch (e) {
      console.log("### ERROR", e)
    }
  }
}
module.exports = Kernel
