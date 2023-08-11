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
//const memwatch = require('@airbnb/node-memwatch');
class Kernel {
  constructor(store) {
    this.fetch = fetch
    this.store = store
  }
  resumeprocess(uri) {
    let proc = this.procs[uri]
    if (proc && proc.resolve) {
      proc.resolve()
      this.procs[uri] = undefined
    }
  }
  status(uri) {
    let id = this.api.filePath(uri)
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
  async init() {

    this.homedir = this.store.get("home")
    let home = this.store.get("home")
    if (home) {
      this.homedir = home
    } else {
      this.homedir = path.resolve(os.homedir(), "pinokio")
    }
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
      let contents = await fs.promises.readdir(this.homedir)
      await this.bin.init()
      await this.api.init()
      await this.template.init()

      let PuppeteerPath = this.bin.path("puppet", "node_modules", "puppeteer")
      this.puppet = (await this.loader.load(PuppeteerPath)).resolved
      this.puppet.setGlobalOptions({
        userDataDir: this.bin.path("puppet")
      });

    } catch (e) {
    }
  }
}
module.exports = Kernel
