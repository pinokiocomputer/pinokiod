const fs = require('fs')
const os = require("os")
const jsdom = require("jsdom");
const randomUseragent = require('random-useragent');
const path = require('path')
const axios = require('axios')
const fastq = require('fastq')
const fetch = require('cross-fetch');
const waitOn = require('wait-on');
const system = require('systeminformation');
const shellPath = require('shell-path');
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
const KV = require('./kv')
const Script = require('./script')
const Environment = require("./environment")
const Util = require('./util')
const Config = require("./pinokio.json")
const Info = require('./info')
const Pipe = require("../pipe")
const Cloudflare = require('./api/cloudflare')
const Store = require('./store')
const Proto = require('./prototype')
const Plugin = require('./plugin')
const Router = require("./router")
const PinokioDomainRouter = require("./router/pinokio_domain_router")
const Procs = require('./procs')
const Peer = require('./peer')
const Git = require('./git')
const Connect = require('./connect')
const Favicon = require('./favicon')
const AppLauncher = require('./app_launcher')
const { DownloaderHelper } = require('node-downloader-helper');
const { ProxyAgent } = require('proxy-agent');
const fakeUa = require('fake-useragent');
//const kill = require('./tree-kill');
const kill = require('kill-sync')
const ejs = require('ejs');
const VARS = {
  pip: {
    install: {
      torch: require("./vars/pip/install/torch")
    }
  }
}

//const memwatch = require('@airbnb/node-memwatch');
class Kernel {
  schema = "<=5.0.0"
  constructor(store) {
    this.fetch = fetch

    // STORE
    // Previously custom STORE could be passed in. This was to support both electron and server based initialization
    // But this creates complexity because the store location is not fixed
    // Migrating it to ~/.pinokio/config.json
    //
    // 1. does ~/.pinokio exist?
    //  - load from that file
    // 2. does ~/.pinokio NOT exist?
    //  - save the passed in options to the `~/.pinokio`
    //  - load the config

    this.store = new Store()
    let exists = this.store.exists()
    if (!exists) {
      // clone the store to the new store
      this.store.clone(store.store)
      // load from the store (this will be the last time this is used, since the next time it loads, it will load from the new store)
    }

    this.arch = os.arch()
    this.os = os
    this.platform = os.platform()
    this.key = new Key()
    this.jsdom = jsdom
    this.exposed = {}
    this.envs = {}
    this.pinokio_configs = {}
    this.shellpath = shellPath.sync()
    this.favicon = new Favicon()
    this.vram = 0
    this.ram = 0
    this.sysReady = new Promise((resolve) => {
      this._resolveSysReady = resolve
    })


  }
  async renderFile(filepath, data) {
    let response = await new Promise((resolve, reject) => {
      ejs.renderFile(filepath, data, (err, rendered) => {
        if (err) {
          reject(err)
        } else {
          resolve(rendered)
        }
      })
    })
    return response
  }
  async dns(request) {
    let config
    let api_path
    let name

    let is_static_project   // is_static_project := no pinokio.js file
    if (request.path) {
      let relpath = path.relative(this.path("api"), request.path)
      // chunks: "comfy.git/start.js"
      let chunks = relpath.split(path.sep)
      // name: "comfy.git"
      name = chunks[0]
      let launcher = await this.api.launcher(name)
      config = launcher.script
      api_path = launcher.root
    } else {
      config = request.config
      name = request.name
      api_path = this.path("api", request.name)
    }
    if (!config) {
      is_static_project = true
    }
    let dns = {
      "@": [
        "$local.url@start",   // load local.url for "start" script 
        ".",                  // load ./index.html
        "dist",               // load ./dist/index.html
        "build",              // load ./build/index.html
        "docs"                // load ./docs/index.html
      ]
    }
    if (config) {
      if (config.dns) {
        for(let key in config.dns) {
          if (config.dns[key]) {
            config.dns[key] = config.dns[key].concat(dns[key])
          }
        }
      } else {
        config.dns = dns
      }
    } else {
      config = {
        dns
      }
    }

    for(let key in config.dns) {
      let filtered = []
      for(let item of config.dns[key]) {
        if (item.startsWith("$")) {
          if (is_static_project) {
            // do not add since there will be no local variables
          } else {
            filtered.push(item)
          }
        } else if (item.startsWith(":")) {
          // port
          filtered.push(item)
        } else {
          // file path => check if the <path>/index.html exists
          let exists = await this.exists(path.resolve(api_path, item, "index.html"))
          if (exists) {
            filtered.push(item)
          }
        }
      }
      if (!filtered.includes(".")) {
        filtered.push(".")
      }
      config.dns[key] = filtered
      
    }
    this.pinokio_configs[name] = config
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
  url (origin, _path, _type) {
    /*
    // get web url / asset / run URL
    type := "web" (default) | "asset" | "run"
    */
    let relative = path.relative(this.homedir, _path)
    let chunks = relative.split(path.sep)
    let type = _type || "web"
    let result
    if (type === "web") {
      if (chunks[0] === "api") {
        //result = "/pinokio/browser/" + chunks.slice(1).join("/")
        result = "/p/" + chunks.slice(1).join("/")
      }
    } else if (type === "browse" || type === "dev") {
      if (chunks[0] === "api") {
        //result = "/pinokio/browser/" + chunks.slice(1).join("/") + "/dev"
        result = "/p/" + chunks.slice(1).join("/") + "/dev"
      }
//    } else if (type === "web") {
//      result = "/" + chunks.join("/")
    } else if (type === "asset") {
      result = "/asset/" + chunks.join("/")
    } else if (type === "run") {
      result = "/run/" + chunks.join("/")
    }
    return origin + result
  }
  start_port () {
    if (this.router.port_mapping && Object.keys(this.router.port_mapping).length > 0) {
      let max_caddy_port = Math.max(...Object.values(this.router.port_mapping))
      let start_port = Math.max(42003, max_caddy_port + 1)
      return start_port
    } else {
      return 42003
    }
  }
  async symlink({ from, to }) {
    await Util.symlink({ from, to })
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
      return portfinder.getPortPromise({ port: this.start_port() })
    }
  }
  ports(count) {
    // get "count" number of available ports
    return new Promise((resolve, reject) => {
      portfinder.getPorts(count, { port: this.start_port() }, (err, ports) => {
        if (err) {
          reject(err)
        } else {
          resolve(ports)
        }
      })
    })
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
  async network_active() {
    await this.peer.check(this)
    return this.peer.active
  }
  async peer_active() {
    await this.peer.check(this)
    return this.peer.peer_active
  }
  async network_installed() {
    let installed = await this.bin.check_installed({ name: "caddy" })
    return installed
  }
  async network_running() {
    let installed = true
//    let installed = await this.network_installed()
    if (installed) {
      try {
        await axios.get(`http://127.0.0.1:2019/config/`, { timeout: 1000 });
        return true;
      } catch (err) {
        return false;
      }
    } else {
      return false
    }
  }
  async resolvePinokioDomain() {
    const envDomain = (process.env.PINOKIO_DOMAIN || '').trim()
    if (envDomain.length > 0) {
      return envDomain
    }
    if (!this.homedir) {
      return ''
    }
    try {
      const env = await Environment.get(this.homedir, this)
      const value = (env.PINOKIO_DOMAIN || '').trim()
      return value
    } catch (e) {
      return ''
    }
  }
  async ensureRouterMode() {
    const domain = await this.resolvePinokioDomain()
    const shouldUseCustom = domain.length > 0
    if (shouldUseCustom && this.router_kind !== 'custom-domain') {
      console.log('[router] switching to custom-domain router mode')
      this.router = new PinokioDomainRouter(this)
      this.router_kind = 'custom-domain'
    } else if (!shouldUseCustom && this.router_kind !== 'default') {
      console.log('[router] switching to default router mode')
      this.router = new Router(this)
      this.router_kind = 'default'
    }
    this.pinokio_domain_value = domain
  }
  async refresh(notify_peers) {
    const ts = Date.now()

    await this.peer.check(this)

    await this.ensureRouterMode()

    if (this.peer.peer_active) {
      // 1. get the process list
      await this.processes.refresh()

      // 2. refresh peer info to reflect the proc info
      //await this.peer.refresh()
      await this.peer.refresh_host(this.peer.host)
      
    }


//    let network_active = await this.network_active()
//    if (!network_active) {
//      return
//    }

    if (this.peer.https_active) {
      let network_running = await this.network_running()
      if (network_running) {
        let ts = Date.now()
        if (this.processes.refreshing) {
          // process list refreshing. try again later
          return
        }

        if (!this.peer.info) {
          return
        }

  //      // 1. get the process list
  //      await this.processes.refresh()
  //
  //      // 2. refresh peer info to reflect the proc info
  //      //await this.peer.refresh()
  //      console.log("peer refresh_host")
  //      await this.peer.refresh_host(this.peer.host)

        // 3. load custom routers from ~/pinokio/network
        await this.router.init()

        // 4. set current local host router info
        await this.router.local()

        // 7. update remote router
        await this.router.remote()

        await this.router.static()

        await this.router.custom_domain()


        this.router.fallback()

        // 8. update caddy config
        await this.router.update()

      }
    }
    // 6. tell peers to refresh
    let changed
    let new_config = JSON.stringify(await this.peer.current_host())
    if (this.old_config !== new_config) {
//      console.log("Proc config has changed. update router.")
      changed = true
    } else {
//        console.log("Proc config is the same")
      changed = false
    }
    this.old_config = new_config
    if (changed) {
      await this.peer.notify_refresh()
    }
    // 9. announce self to the peer network
    this.peer.announce()
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
  async download(options, ondata) {
    const agent = new ProxyAgent();
    const userAgent = fakeUa()
    let url = options.uri
    let cwd = options.path
    const opts = {
      override: true,
      headers: {
        "User-Agent": userAgent
      }
    }
    if (options.filename) {
      opts.fileName = options.filename
    }
    if (process.env.HTTP_PROXY && process.env.HTTP_PROXY.length > 0) {
      opts.httpRequestOptions = { agent }
      opts.httpsRequestOptions = { agent }
    }
    if (process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.length > 0) {
      opts.httpRequestOptions = { agent }
      opts.httpsRequestOptions = { agent }
    }
    const dl = new DownloaderHelper(url, cwd, opts)
    ondata({ raw: `\r\nDownloading ${url} to ${cwd}...\r\n` })
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
  async getInfo(refresh){
    let info = this.sysinfo
    if (refresh) {
      await this.update_sysinfo()
    }
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
//    let folders = files.filter((f) => { return f.isDirectory() }).map((x) => { return x.name })
    let folders = []
    for(let file of files) {
//    for(let folder of folders) {
      let file_path = this.path("api", file.name)
      let type = await Util.file_type(this.path("api"), file)
      if (type.directory) {
        folders.push(file.name)
        await this.dns({
          path: file_path
        })
      }
    }

    let meta = {}
    for(let folder of folders) {
      let pinokio = await this.api.meta(folder)
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
  _readWindowsPath(scope) {
    try {
      const cmd = `powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','${scope}')"`
      return execSync(cmd, { encoding: "utf-8" }).trim()
    } catch (e) {
      return ""
    }
  }
  refreshPath() {
    if (!this.envs) {
      return
    }
    let pathKey
    if (this.envs.Path) {
      pathKey = "Path"
    } else if (this.envs.PATH) {
      pathKey = "PATH"
    }
    if (!pathKey) {
      return
    }
    let refreshed
    if (this.platform === "win32") {
      const machinePath = this._readWindowsPath("Machine")
      const userPath = this._readWindowsPath("User")
      const segments = [machinePath, userPath].filter(Boolean)
      if (segments.length > 0) {
        refreshed = segments.join(path.delimiter)
      }
    } else {
      try {
        refreshed = shellPath.sync()
      } catch (e) {
        refreshed = null
      }
    }
    if (!refreshed) {
      return
    }
    const current = this.envs[pathKey] || ""
    if (this.shellpath && current.includes(this.shellpath)) {
      this.envs[pathKey] = current.replace(this.shellpath, refreshed)
    } else if (!current) {
      this.envs[pathKey] = refreshed
    } else {
      this.envs[pathKey] = `${refreshed}${path.delimiter}${current}`
    }
    this.shellpath = refreshed
  }
  which(name, pattern) {
    this.refreshPath()
    if (this.platform === "win32") {
      try {
        const result = execSync(`where ${name}`, { env: this.envs, encoding: "utf-8" })
        const lines = result.trim().split("\r\n")
        console.log({ result, lines })
        if (pattern) {
          let match = null
          for(let line of lines) {
            let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(pattern)
            if (!/g/.test(matches[2])) {
              matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
            }
            let re = new RegExp(matches[1], matches[2])
            console.log("testing", { line, pattern, re })
            if (re.test(line)) {
              match = line 
              console.log("matched", { line })
              break
            }
          }
          return match
        } else {
          if (lines.length > 0) {
            return lines[0]
          } else {
            return null
          }
        }
      } catch (e) {
        console.log("Error", e)
        return null
      }
    } else {
      return which.sync(name, { nothrow: true, path: this.envs.PATH })
    }
  }
  async initHome() {
    if (this.homedir) {
      await fs.promises.mkdir(this.homedir, { recursive: true }).catch((e) => {})
//      if (this.platform === "win32") {
//        console.log("[initHome] 1 Give full permission")
//        await this.bin.exec({
//          sudo: true,
//          message: `icacls ${this.homedir} /grant *S-1-1-0:(OI)(CI)F /T`
//        }, (stream) => {
//          process.stdout.write(stream.raw)
//        })
//        console.log("[initHome] 2 Give full permission done")
//      }
    }
  }
  kill() {
    process.kill(process.pid, "SIGTERM")
  }
///  async fileserver() {
///    await this.exec({
///      message: `npx -y filexplorer --serveDirectory ${this.homedir}`
///    }, (e) => {
///      process.stdout.write(e.raw)
///    }).then(() => {
///      console.log("DONE")
///    })
///  }
  async init(options) {

    let home = this.store.get("home") || process.env.PINOKIO_HOME
    this.homedir = home

    // reset shells if they exist
    if (this.shell) {
      this.shell.reset()
    }
    if (this.peer) {
      this.peer.stop()
    }

    this.info = new Info(this)
    this.pipe = new Pipe(this)
    this.proto = new Proto(this)
    this.plugin = new Plugin(this)
    this.processes = new Procs(this)
    this.kv = new KV(this)
    this.cloudflare = new Cloudflare()
    this.peer = new Peer(this)
    await this.peer.initialize(this)
    this.git = new Git(this)

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
    this.appLauncher = new AppLauncher(this)
    if (typeof this.appLauncher.init === 'function') {
      this.appLauncher.init().catch((error) => {
        console.warn('[Kernel] AppLauncher init failed:', error && error.message ? error.message : error)
      })
    }
    this.pinokio_domain_value = (process.env.PINOKIO_DOMAIN || '').trim()
    if (this.pinokio_domain_value) {
      this.router = new PinokioDomainRouter(this)
      this.router_kind = 'custom-domain'
    } else {
      this.router = new Router(this)
      this.router_kind = 'default'
    }
    this.connect = new Connect(this)
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
      if (this.homedir) {

        // 0. create homedir
        let home_exists = await this.exists(this.homedir)
        if (!home_exists) {
          // home didn't exist.
          // 1. mkdir
          await fs.promises.mkdir(this.homedir, { recursive: true }).catch((e) => {})
          // 2. and then add permission
          await this.initHome()
        }



        // 1. check if ENVIRONMENT exists
        // if it doesn't exist, write to ~/pinokio/ENVIRONMENT
        let e = await this.exists(this.homedir, "ENVIRONMENT")
        if (!e) {
          let str = await Environment.ENV("system", this.homedir, this)
          await fs.promises.writeFile(path.resolve(this.homedir, "ENVIRONMENT"), str)
        }

        const updated = {
          HTTP_PROXY: (this.store.get("HTTP_PROXY") || ""),
          HTTPS_PROXY: (this.store.get("HTTPS_PROXY") || ""),
          NO_PROXY: (this.store.get("NO_PROXY") || "")
        }
        let fullpath = path.resolve(this.homedir, "ENVIRONMENT")
        await Util.update_env(fullpath, updated)

        // 2. mkdir all the folders if not already created
        await Environment.init_folders(this.homedir, this)

        // if key.json doesn't exist, create an empty json file
        let ee = await this.exists(this.homedir, "key.json")
        if (!ee) {
          await fs.promises.writeFile(path.resolve(this.homedir, "key.json"), JSON.stringify({}))
        }

//        // 3. check if Caddyfile exists
//        let e2 = await this.exists(this.homedir, "Caddyfile")
//        if (!e2) {
//          let str = `pinokio.local {
//  reverse_proxy localhost:${this.port}
//}`
//          await fs.promises.writeFile(path.resolve(this.homedir, "Caddyfile"), str)
//        }


      }

      // Load git checkpoints as soon as homedir is ready so features depending on it
      // (like the Backups page) can see prior state immediately.
      console.time("git.loadCheckpoints")
      await this.git.loadCheckpoints()
      console.timeEnd("git.loadCheckpoints")

//      let contents = await fs.promises.readdir(this.homedir)
      //await this.bin.init()
      let ts = Date.now()
      // Initialize core tools
      this.bin.init().then(() => {
        if (this.homedir) {
          this.git.init().then(() => {
            this.git.index(this).then(() => {
              //console.log(this.git.mapping)
            }).catch((err) => {
              console.warn("Git index error:", err && err.message ? err.message : err)
            })
          }).catch((err) => {
            console.warn("Git init error:", err && err.message ? err.message : err)
          })
          this.shell.init().then(async () => {
            this.bin.check({
              bin: this.bin.preset("dev"),
            })
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
                      return null
                    }
                  } else {
                    return which.sync(name, { nothrow: true, path: this.envs.PATH })
                  }
                }
              })
              if (this.bin.installed && this.bin.installed.conda && this.bin.installed.conda.has("git")) {
                await Promise.all([
                  this.proto.init(),
                  this.plugin.init(),
                ])
              }

              this.sys = new Sysinfo()
              await this.sys.init(this)
              let info = this.sys.info

              this.sysinfo = info

              await this.getInfo(true)
              if (this._resolveSysReady) {
                this._resolveSysReady()
                this._resolveSysReady = null
              }

              await fs.promises.mkdir(this.path("logs"), { recursive: true }).catch((e) => { })
              await fs.promises.writeFile(this.path("logs/system.json"), JSON.stringify(this.i, null, 2))
              let pwpath = this.bin.path("playwright/node_modules/playwright")
              this.playwright = (await this.loader.load(pwpath)).resolved

              //await this.fileserver()

              // get env
              if (!this.launch_complete) {
                let interval = setInterval(async () => {
                  try {
                    if (this.i) {
                      for (let api of this.i.api) {
                        let env_path = path.resolve(this.api.userdir, api.path)
                        let e = await Environment.get(env_path, this)
                        if (e.PINOKIO_SCRIPT_AUTOLAUNCH && e.PINOKIO_SCRIPT_AUTOLAUNCH.trim().length > 0) {
                          let autolaunch_path = path.resolve(env_path, e.PINOKIO_SCRIPT_AUTOLAUNCH)
                          let exists = await this.exists(autolaunch_path)
                          if (exists) {
                            this.api.process({
                              uri: autolaunch_path,
                              input: {}
            //                client: req.client,
            //                caller: req.parent.path,
                            }, (r) => {
                              console.log({ autolaunch_path, r })
//                              resolve(r.input)
                            }).catch((err) => {
                              console.warn('[Kernel.init] autolaunch process failed:', err && err.message ? err.message : err)
                            })
                          } else {
                            console.log("SCRIPT DOES NOT EXIST. Ignoring.", autolaunch_path)
                          }
                        }
                      }
                      clearInterval(interval)
                      setTimeout(() => {
                        this.launch_complete = true
                        console.log("SETTING launch complete", this.launch_complete)
                      }, 2000)
                    }
                  } catch (err) {
                    console.warn('[Kernel.init] autolaunch loop failed:', err && err.message ? err.message : err)
                  }
                }, 1000)
              }
            }
          }).catch((err) => {
            console.warn("Shell init error:", err && err.message ? err.message : err)
          })
        }
      }).catch((err) => {
        console.warn("Bin init error:", err && err.message ? err.message : err)
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
          vram: this.vram,
          ram: this.ram,
          proxy: (port) => {
            return this.api.get_proxy_url("/proxy", port)
          },
        })
//        setTimeout(() => {
//          this.refresh()    
//        }, 3000)

        // refresh every 5 second
        const scheduleRefresh = () => {
          if (this.refresh_interval) {
            clearTimeout(this.refresh_interval)
          }
          this.refresh_interval = setTimeout(async () => {
            if (this.server_running) {
              try {
                await this.refresh(true)
              } catch (err) {
                console.warn('[Kernel.refresh] background refresh failed:', err && err.message ? err.message : err)
              }
            } else {
              console.log("server not running yet. retry network refresh in 5 secs")
            }
            scheduleRefresh()
          }, 5000)
        }
        scheduleRefresh()

      }

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
      if (this.sys) {
//        await this.sys.refresh()
        let info = this.sys.info
        this.template.update(info)
        this.sysinfo = info
        this.gpu = info.gpu
        this.gpu_model = info.gpu_model
        this.gpus = info.gpus
        this.vram = typeof info.vram === "number" ? info.vram : 0
        this.ram = typeof info.ram === "number" ? info.ram : 0
      }
    } catch (e) {
      console.log("sysinfo error", e)
    }
  }
  async exec(params, ondata) {
//    params.path = this.path()
    if (this.client) {
      params.cols = this.client.cols
      params.rows = this.client.rows
    } else if (this.bin.client) {
      params.cols = this.bin.client.cols
      params.rows = this.bin.client.rows
    }
    let response = await this.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Kernel
