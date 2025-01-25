const fs = require('fs')
const os = require("os")
const jsdom = require("jsdom");
const randomUseragent = require('random-useragent');
const path = require('path')
const fastq = require('fastq')
const fetch = require('cross-fetch');
const waitOn = require('wait-on');
const system = require('systeminformation');
const Sysinfo = require('./sysinfo')
const portfinder = require('portfinder-cp');
const { execSync } = require('child_process')
const Loader = require("./loader")
const Bin = require('./bin')
const Api = require("./api")
const Python = require("./python")
//const Template = require('./template')
const Template = require('jimini')
const which = require('which')
const Shells = require("./shells")
const Key = require("./key")
const Script = require('./script')
const Environment = require("./environment")
const Util = require('./util')
const Config = require("./pinokio.json")
const Info = require('./info')
const Pipe = require("../pipe")
const Cloudflare = require('./api/cloudflare')
const VARS = {
  pip: {
    install: {
      torch: require("./vars/pip/install/torch")
    }
  }
}

//const memwatch = require('@airbnb/node-memwatch');
class Kernel {
  //schema = ">=1.0.0"
  //schema = "<=2.1.0"
  //schema = "<=3.2.0"
  schema = "<=3.3.20"
  constructor(store) {
    this.fetch = fetch
    this.store = store
    this.arch = os.arch()
    this.os = os
    this.platform = os.platform()
    this.key = new Key()
    this.jsdom = jsdom
    this.exposed = {}
    this.envs = {}
    this.info = new Info(this)
    this.pipe = new Pipe(this)
    this.cloudflare = new Cloudflare()
  }
  /*
    kernel.env() => return the system environment
    kernel.env("api/stablediffusion") => returns the full environment object
  */
  async stopCloudflare(option) {
    if (option.uri) {
    } else if (option.path) {
      let scriptPath = option.path
      if (this.memory.local[scriptPath] && this.memory.local[scriptPath].$share) {
        let cf = this.memory.local[scriptPath].$share.cloudflare
        if (cf) {
          let uris = Object.keys(cf)
          for(let uri of uris) {
            await this.cloudflare.stop({
              parent: {
                path: scriptPath
              },
              params: { uri }
            }, (e) => {
              process.stdout.write(e.raw)
            }, this)
          }
        }
      }
    }
  }
  async env(...args) {
    let folderpath
    if (args) {
      folderpath = path.resolve(this.homedir, ...args)
    } else {
      folderpath = this.homedir
    }
    return Environment.get2(folderpath, this)
  }
  userAgent(browser) {
    if (browser) {
      return randomUseragent.getRandom((ua) => {
        return ua.browserName === browser;
      });
    } else {
      return randomUseragent.getRandom()
    }
  }
  resumeprocess(uri) {
    let proc = this.procs[uri]
    if (proc && proc.resolve) {
      proc.resolve()
      this.procs[uri] = undefined
    }
  }
  import(type, params, cwd) {
    /*
      type := "local" | "global"
    */
    let o = {}
    for(let key in params) {
      // get memory for each uri
      let uri = params[key]
      let fpath = this.api.filePath(uri, cwd)
      o[key] = this.memory[type][fpath]
    }
    return o
  }
  local(...args) {
    // get local variables at path
    let filePath = this.api.filePath(path.resolve(...args))
    let v = this.memory.local[filePath]
    //let v = this.memory.local[path.resolve(...args)]
    if (v) {
      return  v
    } else {
      return {}
    }
  }
  global(...args) {
    // get local variables at path
    let filePath = this.api.filePath(path.resolve(...args))
    let v = this.memory.global[filePath]
//    let v = this.memory.global[path.resolve(...args)]
    if (v) {
      return  v
    } else {
      return {}
    }
  }
  running(...args) {
    return this.status(path.resolve(...args))
  }
  status(uri, cwd) {
    let id = this.api.filePath(uri, cwd)
    return this.api.running[id]
  }
  port(port) {
    // 1. if port is passed, check port
    // 2. if no port is passed, get the next available port
    /**********************************************
    *
    *  let available_port = await kernel.port()
    *
    **********************************************/
    if (port) {
      return portfinder.isAvailablePromise({ host: "0.0.0.0", port })
    } else {
      return portfinder.getPortPromise({ port: 42003 })
    }
  }
  path(...args) {
    return path.resolve(this.homedir, ...args)
  }
  exists(...args) {
    if (args) {
      let abspath = this.path(...args)
      return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
    } else {
      return false
    }
  }
  async load(...filepath) {
    let p = path.resolve(...filepath)
    let json = (await this.loader.load(p)).resolved
    return json
  }
  async require(...filepath) {
    let p = path.resolve(...filepath)
    let json = (await this.loader.load(p)).resolved
    return json
  }
  log(data, group, info) {
    this.log_queue.push({ data, group, info })
  }
  async clearLog(group) {
    let relativePath = path.relative(this.homedir, group)
    for(let type of ["info", "buf", "cleaned"]) {
    //for(let type of ["info", "cleaned"]) {
      let logPath = path.resolve(this.homedir, "logs", "shell", type, relativePath)
      let logFolder = path.dirname(logPath)
      let filename = path.basename(logPath)
      try {
        let files = await fs.promises.readdir(logFolder)
        for(let file of files) {
          if (file.startsWith(filename)) {
            let p = path.resolve(logFolder, file)
            await fs.promises.rm(p)
          }
        }
      } catch (e) {
//        console.log(e)
      }
    }
  }
  async _log(data, group, info) {
    if (group) {

      // 1. prepare data
      let relativePath = path.relative(this.homedir, group)

      if (!path.isAbsolute(relativePath)) {
        //for(let type of ["info", "buf", "cleaned"]) {
        for(let type of ["info", "cleaned"]) {
          let logPath = path.resolve(this.homedir, "logs", "shell", type, relativePath + "." + info.index + ".txt")
          let logFolder = path.dirname(logPath)
          await fs.promises.mkdir(logFolder, { recursive: true }).catch((e) => { })
          await fs.promises.appendFile(logPath, data[type])
        }
      }
    } else {
      //for(let type of ["info", "buf", "cleaned"]) {
      for(let type of ["info", "cleaned"]) {
        let logPath = path.resolve(this.homedir, "logs", "shell", type, "index.txt")
        let logFolder = path.dirname(logPath)
        await fs.promises.mkdir(logFolder, { recursive: true }).catch((e) => { })
        await fs.promises.appendFile(logPath, data[type])
      }
    }
  }

  async wait(options) {
    await waitOn(options)
  }
  async getInfo(){
    let info = this.sysinfo
    await this.update_sysinfo()
    let i = {
      version: this.version,
      platform: this.platform,
      arch: this.arch,
      home: this.homedir,
      scripts: [],
      shells: this.shell.shells.map(({ vts, stripAnsi, cols, rows, id, group, path, index, cmd, done }) => {
        let buf = vts.serialize()
        let state = stripAnsi(buf)
        return { cols, rows, id, group, path, index, cmd, done, state }
      }),
      proxies: [],
      api: [],
      bin: {},
      vars: this.vars,
      memory: this.memory,
      procs: this.procs,
      gpu: this.gpu,
      gpus: this.gpus,
      ...info
    }

    // user-friendly running
    /*
      running :- {
        <relative_path>: {
          step: <current_step>,
          path: <full_path>,
          app: <app_name>,
          args: <args>,
          local: {
            <key>: <val>
          }
        }
      }
    */
    let running = this.api.running
    for(let full_path in running) {
      let relative_path = path.relative(this.api.userdir, full_path)
      let app = relative_path.split(path.sep)[0]
      let app_path = path.resolve(this.api.userdir, app)
      let script_path = path.relative(app_path, full_path)
      let args = i.memory.args[full_path]
      let rpc = i.memory.rpc[full_path]
      let input = i.memory.input[full_path]
      let local = i.memory.local[full_path]
      i.scripts.push({
        path: relative_path, app, script_path, step: rpc, input, args, local, full_path,
      })
    }
    for(let full_path in this.api.proxies) {
      let relative_path = path.relative(this.api.userdir, full_path)
      let app = relative_path.split(path.sep)[0]
      let app_path = path.resolve(this.api.userdir, app)
      let script_path = path.relative(app_path, full_path)
      let proxies = this.api.proxies[full_path]
      for(let proxy of proxies) {
        i.proxies.push({
          path: relative_path,
          app,
          script_path,
          full_path,
          ...proxy
        })
      }
    }

    let files = await fs.promises.readdir(this.api.userdir, { withFileTypes: true })
    let folders = files.filter((f) => { return f.isDirectory() }).map((x) => { return x.name })
    let meta = {}
    for(let folder of folders) {
      let p = path.resolve(this.api.userdir, folder, "pinokio.js")
      let pinokio = (await this.loader.load(p)).resolved
      if (pinokio) {
        i.api.push({
          path: folder,
          title: pinokio.title,
          description: pinokio.description,
          icon: pinokio.icon ? `/api/${folder}/${pinokio.icon}?raw=true` : null
        })
      } else {
        i.api.push({
          path: folder,
        })
      }
    }
    for(let key in this.bin.installed) {
      let s = this.bin.installed[key]
      i.bin[key] = {
        installed: Array.from(s)
      }
    }
    this.i = i
  }

  async synchronize_proxies() {
    let proxy_registry_path = path.resolve(this.homedir, "proxy_registry")
    let exists = await this.exists(proxy_registry_path)
    if (exists) {
      await this.exec({
        message: "git pull",
        path: proxy_registry_path,
      }, (e) => {
        process.stdout.write(e.raw)
      })
    } else {
      await this.exec({
        message: "git clone https://github.com/pinokiocomputer/proxy_registry",
        path: this.homedir
      }, (e) => {
        process.stdout.write(e.raw)
      })
    }
  }

  async init(options) {
    let home = this.store.get("home")

    // reset shells if they exist
    if (this.shell) {
      this.shell.reset()
    }

    this.homedir = home

//    if (home) {
//      this.homedir = home
//    } else {
//      this.homedir = path.resolve(os.homedir(), "pinokio")
//    }
    if (this.log_queue) {
      this.log_queue.killAndDrain()
    }
    this.log_queue = fastq.promise(async ({ data, group, info }) => {
      await this._log(data, group, info)
    }, 1)

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

//    let keyfile = path.resolve(this.homedir, "keys.json")
//    await this.key.init(keyfile)

//    let home = this.store.get("home")
//    if (home) {
//      this.homedir = home
//    } else {
//      this.homedir = path.resolve(os.homedir(), "pinokio")
//    }
//    console.log("homedir", this.homedir)
    this.script = new Script(this)
    this.loader = new Loader()
    this.bin = new Bin(this)
    this.api = new Api(this)
    this.python = new Python(this)
    this.shell = new Shells(this)
    this.system = system
    this.keys = {}
    this.memory = {
      local: {},
      global: {},
      key: (host) => {
        return this.keys[host]
      },
      rpc: {},
      input: {},
      args: {},
    }
    this.procs = {}
    this.template = new Template()
    try {
      let grant_permission = false
      if (this.homedir) {

        // 0. create homedir
        let home_exists = await this.exists(this.homedir)
        console.log({ home_exists, homedir: this.homedir })
        if (!home_exists) {
          await fs.promises.mkdir(this.homedir, { recursive: true }).catch((e) => {})

          // If the homedir was newly created, give full permission to pinokio folder on windows
          grant_permission = true
        }



        // 1. check if ENVIRONMENT exists
        // if it doesn't exist, write to ~/pinokio/ENVIRONMENT
        let e = await this.exists(this.homedir, "ENVIRONMENT")
        if (!e) {
          let str = await Environment.ENV("system", this.homedir)
          await fs.promises.writeFile(path.resolve(this.homedir, "ENVIRONMENT"), str)
        }
        // 2. mkdir all the folders if not already created
        await Environment.init_folders(this.homedir)


//        // 3. check if Caddyfile exists
//        let e2 = await this.exists(this.homedir, "Caddyfile")
//        if (!e2) {
//          let str = `pinokio.local {
//  reverse_proxy localhost:${this.port}
//}`
//          await fs.promises.writeFile(path.resolve(this.homedir, "Caddyfile"), str)
//        }


      }

//      let contents = await fs.promises.readdir(this.homedir)
      //await this.bin.init()
      let ts = Date.now()
      this.bin.init().then(() => {
        console.log("bin init finished")
        if (this.homedir) {
          this.shell.init().then(async () => {
            if (this.envs) {
              this.template.update({
                env: this.envs,
                envs: this.envs,
                which: (name) => {
                  if (this.platform === "win32") {
                    try {
                      const result = execSync(`where ${name}`, { env: this.envs, encoding: "utf-8" })
                      const lines = result.trim().split("\r\n")
                      if (lines.length > 0) {
                        return lines[0]
                      } else {
                        return null
                      }
                    } catch (e) {
                      console.log(`>> which ${name}`, e)
                      return null
                    }
                  } else {
                    return which.sync(name, { nothrow: true, path: this.envs.PATH })
                  }
                }
              })

              // get env
              if (!this.launch_complete) {
                let interval = setInterval(async () => {
                  if (this.i) {
                    for(let api of this.i.api) {
                      console.log({ api })
                      let env_path = path.resolve(this.api.userdir, api.path)
                      let e = await Environment.get(env_path)
                      console.log(e)
                      if (e.PINOKIO_SCRIPT_AUTOLAUNCH && e.PINOKIO_SCRIPT_AUTOLAUNCH.trim().length > 0) {
                        let autolaunch_path = path.resolve(env_path, e.PINOKIO_SCRIPT_AUTOLAUNCH)
                        let exists = await this.exists(autolaunch_path)
                        console.log("ATTEMPTING AUTOLAUNCH", autolaunch_path)
                        if (exists) {
                          console.log("SCRIPT EXISTS. Starting...", autolaunch_path)
                          this.api.process({
                            uri: autolaunch_path,
                            input: {}
            //                client: req.client,
            //                caller: req.parent.path,
                          }, (r) => {
                            console.log({ autolaunch_path, r })
//                              resolve(r.input)
                          })
                        } else {
                          console.log("SCRIPT DOES NOT EXIST. Ignoring.", autolaunch_path)
                        }
                      }
                    }
                    console.log("clear Interval")
                    clearInterval(interval)
                    setTimeout(() => {
                      this.launch_complete = true
                      console.log("SETTING launch complete", this.launch_complete)
                    }, 2000)
                  }
                }, 1000)
              }
            }
//            console.log({ grant_permission })
//            if (grant_permission) {
//              if (this.platform === "win32") {
//                console.log("2 Give full permission")
//                await this.bin.exec({
//                  sudo: true,
//                  message: `icacls ${this.homedir} /grant Users:(OI)(CI)F /T`
//                }, (stream) => {
//                  ondata(stream)
//                })
//                console.log("2 Give full permission done")
//              }
//            }
          })
        }
      })
      let ts2 = Date.now()
      await this.api.init()

      //await this.shell.init()

      if (this.homedir) {
        await this.template.init({
          kernel: this,
          system,
          platform: this.platform,
          arch: this.arch,
          proxy: (port) => {
            return this.api.get_proxy_url("/proxy", port)
          },
        })
        this.sys = new Sysinfo()
        await this.sys.init(this)
        let info = this.sys.info

        this.sysinfo = info

        await this.getInfo()

        await fs.promises.mkdir(this.path("logs"), { recursive: true }).catch((e) => { })
        await fs.promises.writeFile(this.path("logs/system.json"), JSON.stringify(this.i, null, 2))

      /*
        this.sys = new Sysinfo()
        await this.sys.init(this)
        let info = this.sys.info
        await fs.promises.mkdir(this.path("logs"), { recursive: true }).catch((e) => { })
        await fs.promises.writeFile(this.path("logs/system.json"), JSON.stringify({
          platform: this.platform,
          arch: this.arch,
          home: this.homedir,
          ...info
        }, null, 2))
        this.sysinfo = info
        console.time("template.init")
        await this.template.init({
          kernel: this,
          system,
          platform: this.platform,
          arch: this.arch,
          proxy: (port) => {
            return this.api.get_proxy_url("/proxy", port)
          },
          ...info
        })
        console.timeEnd("template.init")
        console.time("update_sysinfo")
        await this.update_sysinfo()
        console.timeEnd("update_sysinfo")
        */
//        console.log("> 4")
//        this.shell.init().then(() => {
//          if (this.envs) {
//            this.template.update({
//              env: this.envs,
//              envs: this.envs
//            })
//          }
//        })
        //await this.shell.init()
      }

      //let pwpath = this.bin.path("playwright/js/node_modules/playwright")
      let pwpath = this.bin.path("playwright/node_modules/playwright")
      this.playwright = (await this.loader.load(pwpath)).resolved


//      let pwpath
//      if (this.platform === "win32") {
//        pwpath = this.bin.path("miniconda/node_modules/playwright")
//      } else {
//        pwpath = this.bin.path("miniconda/lib/node_modules/playwright")
//      }

//      await this.template.init()


//      let PuppeteerPath = this.bin.path("puppet", "node_modules", "puppeteer")
//      this.puppet = (await this.loader.load(PuppeteerPath)).resolved
//      this.puppet.setGlobalOptions({
//        userDataDir: this.bin.path("puppet")
//      });

    } catch (e) {
      console.log("### ERROR", e)
    }

//    await this.exec({
//      message: "caddy run",
//      path: this.homedir
//    }, (e) => {
//      process.stdout.write(e.raw)
//    })
  }
  async update_sysinfo() {
    try {
      await this.sys.refresh()
      let info = this.sys.info
      this.template.update(info)
      this.sysinfo = info
      this.gpu = info.gpu
      this.gpus = info.gpus
    } catch (e) {
      console.log("sysinfo error", e)
    }
  }
  async exec(params, ondata) {
//    params.path = this.path()
//    if (this.client) {
//      params.cols = this.client.cols
//      params.rows = this.client.rows
//    }
    let response = await this.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Kernel
