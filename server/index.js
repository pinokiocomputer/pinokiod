const express = require('express');
const diff = require('diff')
const kill = require('kill-sync')
const { isBinaryFile } = require("isbinaryfile");
const { glob, sync, hasMagic } = require('glob-gitignore')
const portfinder = require('portfinder-cp');
const proxy = require('express-http-proxy-cp');
const sudo = require("sudo-prompt-programfiles-x86");
const compressing = require('compressing');
const { rimraf } = require('rimraf')
const { createHttpTerminator } = require('http-terminator')
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mime = require('mime-types')
const httpserver = require('http');
const cors = require('cors');
const path = require("path")
const fs = require('fs');
const os = require('os')
const { fork, exec } = require('child_process');
const semver = require('semver')
const fse = require('fs-extra')
const QRCode = require('qrcode')
const axios = require('axios')
const crypto = require('crypto')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const marked = require('marked')
const multer = require('multer');
const ini = require('ini')
//const localtunnel = require('localtunnel');
//const ngrok = require("@ngrok/ngrok");

const ejs = require('ejs');

const DEFAULT_PORT = 42000

const ex = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};




const Socket = require('./socket')
const Kernel = require("../kernel")
const packagejson = require("../package.json")
const Environment = require("../kernel/environment")
const Cloudflare = require("../kernel/api/cloudflare")
const Util = require("../kernel/util")
const Info = require("../kernel/info")

const Setup = require("../kernel/bin/setup")

function normalize(str) {
  if (!str) return '';
  return (str.endsWith('\n') ? str : str + '\n').replace(/\r\n/g, '\n');
}

class Server {
  constructor(config) {
    this.menu_hidden = {}
    this.selected = {}
    this.tabs = {}
    this.agent = config.agent
    this.port = DEFAULT_PORT
//    this.port = config.port
    this.kernel = new Kernel(config.store)
//    this.tunnels = {}
    this.version = {
      pinokiod: packagejson.version,
      pinokio: config.version
    }

    this.newsfeed = config.newsfeed
    this.profile = config.profile
    this.discover_dark = config.discover_dark
    this.discover_light = config.discover_light
    this.site = config.site
    this.portal = config.portal
    this.install = config.install
    this.kernel.version = this.version
    this.upload = multer();
    this.cf = new Cloudflare()

    // sometimes the C:\Windows\System32 is not in PATH, need to add
    let platform = os.platform()
    if (platform === 'win32') {
      let PATH_KEY;
      if (process.env.Path) {
        PATH_KEY = "Path"
      } else if (process.env.PATH) {
        PATH_KEY = "PATH"
      }
      process.env[PATH_KEY] = [
        "C:\\Windows\\System32",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        process.env[PATH_KEY]
      ].join(path.delimiter)
    }
    if (platform === "linux") {
      process.env.WEBKIT_DISABLE_DMABUF_RENDERER = 1
    }

      
//    process.env.CONDA_LIBMAMBA_SOLVER_DEBUG_LIBSOLV = 1
  }
  stop() {
    this.server.close()
  }
  exists (s) {
    return new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))
  }
  async updateMeta(formData, app_path) {
    // write title/description to pinokio.json
    let dirty
    let meta_path = this.kernel.path("api", app_path, "pinokio.json")
    let meta = (await this.kernel.loader.load(meta_path)).resolved
    if (!meta) meta = {}
    if (formData.title) {
      meta.title = formData.title
      dirty = true
    }
    if (formData.description) {
      meta.description = formData.description
      dirty = true
    }
    if (!meta.plugin) {
      meta.plugin = {
        menu: []
      }
    }

    if (formData.icon_dirty) {
      // 
      // write icon file
      let icon_path = this.kernel.path("api", formData.new_path, formData.icon_path)
      await fs.promises.writeFile(icon_path, formData.avatar)
      meta.icon = formData.icon_path
      dirty = true
    }
    if (dirty) {
      await fs.promises.writeFile(meta_path, JSON.stringify(meta, null, 2))
    }
  }
  running_dynamic (name, menu) {
    let cwd = this.kernel.path("api", name)
    let running_dynamic = []
    const traverse = (obj, indexPath) => {
      if (Array.isArray(obj)) {
        for(let i=0; i<obj.length; i++) {
          let item = obj[i]
          let newIndexPath
          if (indexPath) {
            newIndexPath = indexPath + "." + i
          } else {
            newIndexPath = "" + i
          }
          traverse(item, newIndexPath);
        }
      } else if (obj !== null && typeof obj === 'object') {
        for (const key in obj) {
          if (key === 'href') {
            let href = obj[key]
            if (href.startsWith("/api")) {
              let uri_path = new URL("http://localhost" + href).pathname
              let filepath = this.kernel.path(...uri_path.split("/"))

              let id = `${filepath}?cwd=${cwd}`
              //if (this.kernel.api.running[filepath]) {
              if (this.kernel.api.running[id]) {
                obj.running = true
                obj.display = "indent"
                running_dynamic.push(obj)
              }
            } else if (href.startsWith("/run")) {
              let uri_path = new URL("http://localhost" + href).pathname
              let _filepath = uri_path.split("/").filter(x=>x).slice(1)
              let filepath = this.kernel.path(..._filepath)
              let id = `${filepath}?cwd=${cwd}`
              obj.script_id = id
              //if (this.kernel.api.running[filepath]) {
              if (this.kernel.api.running[id]) {
                obj.running = true
                obj.display = "indent"
                running_dynamic.push(obj)
              }
            }
          } else if (key === "shell") {
            let unix_path = Util.p2u(this.kernel.path("api", name))
            let shell_id = this.get_shell_id(unix_path, indexPath, obj[key])
            let decoded_shell_id = decodeURIComponent(shell_id)
            if (this.kernel.api.running["shell/" + decoded_shell_id]) {
              obj.running = true
              obj.display = "indent"
              running_dynamic.push(obj)
            }
          }
          traverse(obj[key], indexPath);
        }
      }
    }
    traverse(menu)
    return running_dynamic
  }
  async createMeta(formData) {
    let _path = this.kernel.path("api", formData.path)
    await fs.promises.mkdir(_path, { recursive: true }).catch((e) => {})
    let icon_path = this.kernel.path("api", formData.path, "icon.png")
    await fs.promises.writeFile(icon_path, formData.avatar)

    // write title/description to pinokio.json
    let meta_path = this.kernel.path("api", formData.path, "pinokio.json")
    let meta = {
      title: formData.title,
      description: formData.description,
      icon: "icon.png",
      plugin: {
        menu: []
      }
    }
    await fs.promises.writeFile(meta_path, JSON.stringify(meta, null, 2))
  }
  getMemory(filepath) {
    let localMem = this.kernel.memory.local[filepath]
    let globalMem = this.kernel.memory.global[filepath]

    let mem = []
    let localhosts = ["localhost", "127.0.0.1", "0.0.0.0"]
    for(let key in localMem) {
      let val = localMem[key]
      // check for localhost url
//      let localhost = false
//      let tunnel
//      try {
//        let url = new URL(val)
//        if (localhosts.includes(url.hostname)) {
//          localhost = true
//          if (this.tunnels[val]) {
//            tunnel = this.tunnels[val].url()
//            //tunnel = this.tunnels[val].url
//          }
//        }
//      } catch (e) { }
      mem.push({
        type: "local",
        key,
        val,
//        tunnel,
//        localhost,
      })
    }
    return mem
  }
  getItems(items, meta, p) {
    return items.map((x) => {
      let name
      let description
      let icon = "/pinokio-black.png"
      let uri
      let iconpath
      let apipath
      if (meta) {
        let m = meta[x.name]
        name = (m && m.title ? m.title : x.name)
        description = (m && m.description ? m.description : "")
        if (m && m.icon) {
          icon = m.icon
        } else {
          icon = "/pinokio-black.png"
          //icon = null
        }
        if (m && m.iconpath) {
          iconpath = m.iconpath
        }
        if (m && m.path) {
          apipath = m.path
        }
        uri = x.name
      } else {
        if (x.isDirectory()) {
          icon = "fa-solid fa-folder"
        } else {
          icon = "fa-regular fa-file"
        }
        name = x.name
        description = ""
      }
      let browser_url 
      if (x.run) {
        browser_url = "/env/api/" + x.name
      } else {
        //browser_url = "/pinokio/browser/" + x.name
        browser_url = "/p/" + x.name
      }
      let browser_browse_url = browser_url + "/dev"
      return {
        filepath: this.kernel.path("api", x.name),
        icon,
        iconpath,
        path: apipath,
        running: x.running ? true : false,
        run: x.run,
        menu: x.menu,
        shortcuts: x.shortcuts,
        index: x.index,
        running_scripts: x.running_scripts,
        //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
        name,
        uri,
        //description: x.path,
        description,
        url: p + "/" + x.name,
        browser_url,
        url: browser_url,
        path: uri,
        browse_url: browser_browse_url,
      }
    })
  }
  async init_env(env_dir_path, options) {
    let current = this.kernel.path(env_dir_path, "ENVIRONMENT")
      // if environment.json doesn't exist, 
    let exists = await this.exists(current)
    if (exists) {
      // if ENVIRONMENT already exists, don't do anything
    } else {
      // if ENVIRONMENT doesn't exist, need to create one
      // 1. if _ENVIRONMENT exists, create ENVIRONMENT by appending _ENVIRONMENT to ENVIRONMENT
      // 2. if _ENVIRONMENT doesn't exist, just write ENVIRONMENT
      // if _ENVIRONMENT exists, 
      let _environment = this.kernel.path(env_dir_path, "_ENVIRONMENT")
      let _exists = await this.exists(_environment)
      if (options && options.no_inherit) {
        if (_exists) {
          let _environmentStr = await fs.promises.readFile(_environment, "utf8")
          await fs.promises.writeFile(current, _environmentStr)
        }
      } else {
        let content = await Environment.ENV("app", this.kernel.homedir)
        if (_exists) {
          let _environmentStr = await fs.promises.readFile(_environment, "utf8")
          await fs.promises.writeFile(current, _environmentStr + "\n\n\n" + content)
        } else {
          await fs.promises.writeFile(current, content)
        }
      }
    }
  }
  async get_github_hosts() {
    let hosts = ""
    let hosts_file = this.kernel.path("config/gh/hosts.yml")
    let e = await this.exists(hosts_file)
    console.log({ hosts_file, e })
    if (e) {
      hosts = await fs.promises.readFile(hosts_file, "utf8")
      console.log( { hosts: `#${hosts}#` })
      if (hosts.startsWith("{}")) {
        hosts = ""
      }
    }
    return hosts
  }
  async current_urls(current_path) {
    let router_running = await this.check_router_up()
    let u = new URL("http://localhost:42000")

    let current_urls = {}

    // http
    if (current_path) {
      u.pathname = current_path
    }
    current_urls.http = u.toString()

    // https
    if (router_running.success) {
      let u = new URL("https://pinokio.localhost")
      if (current_path) {
        u.pathname = current_path
      }
      current_urls.https = u.toString()
    }

    return current_urls
  }

  async chrome(req, res, type) {
    let d = Date.now()
    let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
      bin: this.kernel.bin.preset("dev"),
    })
    if (!requirements_pending && install_required) {
      res.redirect(`/setup/dev?callback=${req.originalUrl}`)
      return
    }

    if (req.query.autolaunch === "1") {
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, {
        PINOKIO_ONDEMAND_AUTOLAUNCH: "1"
      })
    } else if (req.query.autolaunch === "0") {
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, {
        PINOKIO_ONDEMAND_AUTOLAUNCH: "0"
      })
    }

    let name = req.params.name
    let config = await this.kernel.api.meta(name)

    let err = null
    if (config && config.version) {
      let coerced = semver.coerce(config.version)
      if (semver.satisfies(coerced, this.kernel.schema)) {
        console.log("semver satisfied", config.version, this.kernel.schema)
      } else {
        console.log("semver NOT satisfied", config.version, this.kernel.schema)
        err = `Please update to the latest Pinokio (current script version: ${config.version}, supported: ${this.kernel.schema})`
      }
    }



//    let requires_instantiation = false
//    console.log("## CONFIG", config)
//    if (config && config.pre) {
//      let env = await Environment.get2(app_path, this.kernel)
//      for(let item of config.pre) {
//        console.log("ITEM" , item)
//        if (item.env) {
//          if (env[item.env]) {
//            
//          } else {
//            requires_instantiation = true
//            break;
//          }
//        }
//      }
//    }
//    console.log({ requires_instantiation })
//    if (requires_instantiation) {
//      // redirect to pre
//      res.redirect("/required_env/api/" + name)
//      return
//    }


    let menu = config.menu || []
    try {
      if (typeof config.menu === "function") {
        if (config.menu.constructor.name === "AsyncFunction") {
          config.menu = await config.menu(this.kernel, this.kernel.info)
        } else {
          config.menu = config.menu(this.kernel, this.kernel.info)
        }
      }
    } catch (e) {
      err = e.stack
      config.menu = []
    }

    let uri = this.kernel.path("api")
    try {
      await this.renderMenu(req, uri, name, config, [])
    } catch(e) {
      config.menu = []
      err = e.stack
    }

    let platform = os.platform()

//    if (config.icon) {
//      //config.iconpath = this.kernel.path("api", name, config.icon)
//      config.iconpath = config.icon
//      config.icon = `${rawpath}/${config.icon}?raw=true`
//    } else {
//      //config.iconpath = this.kernel.path("api", name, "pinokio_icon.png")
//      config.iconpath = "pinokio.png"
//      config.icon = "/pinokio-black.png"
//    }


//    // get all memory variable stied to the current repository
//    let api_path = this.kernel.path("api", name)
//    let mem = {}
//    for(let type in this.kernel.memory) {
//      // type := local|global
//      let vars = this.kernel.memory[type]
//      for(let k in vars) {
//        if (k.includes(api_path)) {
//          if (mem[k]) {
//            mem[k][type] = vars[k]
//          } else {
//            mem[k] = {
//              [type]: vars[k]
//            }
//          }
//        }
//      }
//    }

//    console.time("2 chrome " + d)
    await this.init_env("api/" + name)

    // copy gitignore from ~pinokio/prototype/system/gitignore if it doesn't exist


    let gitignore_path = this.kernel.path("api/" + name + "/.gitignore")
    let gitignore_template_path = this.kernel.path("prototype/system/gitignore")
    let template_exists = await this.exists(gitignore_template_path)
    if (template_exists) {
      await Util.mergeLines(
        gitignore_path, // existing path
        gitignore_template_path // overwrite with template
      )
    }




//    console.timeEnd("2 chrome " + d)

//    console.time("3 chrome " + d)
    let mode = "run"
    if (req.query && req.query.mode) {
      mode = req.query.mode
    }
    const env = await this.kernel.env("api/" + name)
//    console.timeEnd("3 chrome " + d)

    // profile + feed
    const repositoryPath = path.resolve(this.kernel.api.userdir, name)

//    console.time("4 chrome " + d)
    try {
      await git.resolveRef({ fs, dir: repositoryPath, ref: 'HEAD' });
    } catch (err) {
      // repo doesn't exist. initialize.
      console.log(`repo doesn't exist at ${repositoryPath}. initialize`)
      await git.init({ fs, dir: repositoryPath });
    }

//    console.timeEnd("4 chrome " + d)

//    console.time("5 chrome " + d)
    let gitRemote = await git.getConfig({ fs, http, dir: repositoryPath, path: 'remote.origin.url' })
    let profile
    let feed
    if (gitRemote) {
      gitRemote = gitRemote.replace(/\.git$/i, '')

      let system_env = {}
      if (this.kernel.homedir) {
        system_env = await Environment.get(this.kernel.homedir)
      }
      profile = this.profile(gitRemote)
      feed = this.newsfeed(gitRemote)
    }
//    console.timeEnd("5 chrome " + d)

    // git

    let c = this.kernel.path("api", name)

//    console.time("6 chrome " + d)
//    await this.kernel.plugin.init()
//    console.timeEnd("6 chrome " + d)
//    console.time("7 chrome " + d)
//    let plugin = await this.getPlugin(name)
//    console.timeEnd("7 chrome " + d)
//    console.time("8 chrome " + d)
//    let plugin_menu = null
//    if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
//      let running_dynamic = this.running_dynamic(name, plugin.menu)
//      plugin_menu = plugin.menu.concat(running_dynamic)
//    }


    let current_urls = await this.current_urls(req.originalUrl.slice(1))

    let plugin_menu = null
    let plugin_config = structuredClone(this.kernel.plugin.config)
    let plugin = await this.getPlugin(req, plugin_config, name)
    if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
      plugin = structuredClone(plugin)
      plugin_menu = this.running_dynamic(name, plugin.menu)
    }
    let menu_hidden = false
    if (this.menu_hidden[name] && this.menu_hidden[name][type]) {
      menu_hidden = true
    }

    let posix_path = Util.p2u(this.kernel.path("api", name))
    let dev_link
    if (posix_path.startsWith("/")) {
      dev_link = "/d" + posix_path
    } else {
      dev_link = "/d/" + posix_path
    }

    const result = {
      dev_link,
      minimized: menu_hidden,
//      repos,
      current_urls,
      path: this.kernel.path("api", name),
      log_path: this.kernel.path("api", name, "logs"),
      plugin_menu: plugin_menu,
      portal: this.portal,
      install: this.install,
      error: err,
      env,
      mode,
      port: this.port,
//      mem,
      type,
      platform,
      running:this.kernel.api.running,
      memory: this.kernel.memory,
      sidebar: "/pinokio/sidebar/" + name,
      repos: "/pinokio/repos/" + name,
      ai: "/pinokio/ai/" + name,
      dynamic: "/pinokio/dynamic/" + name,
//      dynamic: "/pinokio/dynamic/" + name,
      dynamic_content: null,
      name,
      profile,
      feed,
      tabs: (this.tabs[name] || []),
      config,
//        sidebar_url: "/pinokio/sidebar/" + name,
      home: req.originalUrl,
//        paths,
      theme: this.theme,
      agent: this.agent,
      src: "/_api/" + name,
      logs: "/_api/" + name + "/logs",
      execUrl: "/api/" + name,
//      rawpath,
    }
//    console.timeEnd("8 chrome " + d)
//    console.time("9 chrome " + d)
//    if (!this.kernel.proto.config) {
//      await this.kernel.proto.init()
//    }
//    console.timeEnd("9 chrome " + d)
    res.render("app", result)
  }
  getVariationUrls(req) {
    let edu = new URL("http://localhost" + req.originalUrl)
    edu.searchParams.set("mode", "source")
    let editorUrl = edu.pathname + edu.search

    let referer = req.get("Referer")
    let prevUrl = null
    try {
      if (/\/env\/api\/.+/.test(new URL(referer).pathname)) {
        prevUrl = referer 
      }
    } catch (e) {
    }
    return { editorUrl, prevUrl }
  }
  get_shell_id(name, i, rendered) {
    let shell_id
    if (rendered.id) {
      shell_id = encodeURIComponent(`${name}_${rendered.id}`)
    } else {
      let hash = crypto.createHash('md5').update(JSON.stringify(rendered)).digest('hex')
      //shell_id = encodeURIComponent(`${name}_${i}_session_${hash}`)
      shell_id = encodeURIComponent(`${name}_session_${hash}`)
    }
    return shell_id
  }
  is_subpath(parent, child) {
    const relative = path.relative(parent, child);
    let check = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return check
  }
  async render(req, res, pathComponents, meta) {
    let base_path = req.base || this.kernel.path("api")
    let full_filepath = path.resolve(base_path, ...pathComponents)

    let re = /^(.+\..+)(#.*)$/
    let match = re.exec(full_filepath)

    let filepath
    let hash
    if (match && match.length > 0) {
      filepath = match[1]
      hash = match[2].slice(1)
    } else {
      filepath = full_filepath
    }

    // check if it's a folder or a file
    let p = "/api"    // run mode
    let _p = "/_api"   // edit mode
    let paths = [{
      name: "<img src='/pinokio-black.png'>",
      //name: '<i class="fa-solid fa-house"></i>',
      path: "/",
    }, {
      id: "back",
      name: '<i class="fa-solid fa-arrow-left"></i>',
      action: "history.back()"
    }, {
      id: "forward",
      name: '<i class="fa-solid fa-arrow-right"></i>',
      action: "history.forward()"
    }]
    paths = []
    for(let pathComponent of pathComponents) {
      //p = p + "/" + pathComponent
      _p = _p + "/" + pathComponent
      //let pn = (pathComponent.startsWith("0x") ? Buffer.from(pathComponent.slice(2), "hex").toString() : "/ " + pathComponent)
      let pn =  "/ " + pathComponent
      paths.push({
        //name: "/ " + pathComponent,
        name: pn,
        //path: p
        path: _p
      })
    }
    let gitRemote = ""
    if (pathComponents.length > 0) {
      try {
        //const repositoryPath = this.kernel.path(pathComponents[0], pathComponents[1])
        //const repositoryPath = this.kernel.path(pathComponents[0])
        const repositoryPath = path.resolve(this.kernel.api.userdir, pathComponents[0])
        gitRemote = await git.getConfig({
          fs,
          http,
          dir: repositoryPath,
          path: 'remote.origin.url'
        })
      } catch (e) {
//        console.log("ERROR", e)
      }

    }

//    if (pathComponents.length > 1) {
//      if (pathComponents[1] === 'web') {
//        let filepath = this.kernel.path("api", ...pathComponents)
//        console.log("filepath", filepath)
//        try {
//          console.log("testing")
//          let stat = await fs.promises.stat(filepath)
//          console.log("stat", stat)
//          // if it's a folder
//          if (stat.isDirectory()) {
//            //  if the current folder has "index.html", send that file
//            //  otherwise 404
//            let indexFile = path.resolve(filepath, "index.html")
//            let exists = await this.exists(indexFile)
//            if (exists) {
//              res.sendFile(indexFile)
//            } else {
//            //  res.redirect("/api/" + pathComponents[0])
//              res.status(404).render("404", {
//                message: "index.html not found"
//              })
//            }
//          } else if (stat.isFile()) {
//            res.sendFile(filepath)
//          }
//          return
//        } catch (e) {
//          console.log("E", e)
//          res.redirect("/api/" + pathComponents[0])
//          return
//          /*
//          res.status(404).render("404", {
//            message: e.message
//          })
//          */
//        }
//      }
//    }

    if (path.basename(filepath) === "ENVIRONMENT") {
      // if environment.json doesn't exist, 
      let exists = await this.exists(filepath)
      if (!exists) {
        let content = await Environment.ENV("app", this.kernel.homedir)
        await fs.promises.writeFile(filepath, content)
      }
    }

    let stat = await fs.promises.stat(filepath)
    if (pathComponents.length === 0 && req.query.mode === "explore") {
      res.render("explore", {
        discover_dark: this.discover_dark,
        discover_light: this.discover_light,
        portal: this.portal,
        version: this.version,
        schema: this.kernel.schema,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        stars_selected: (req.query.sort === "stars" || !req.query.sort ? "selected" : ""),
        forks_selected: (req.query.sort === "forks" ? "selected" : ""),
        updated_selected: (req.query.sort === "updated" ? "selected" : ""),
        sort: (req.query.sort ? req.query.sort : "stars"),
        direction: "desc",
        paths,
        display: ["form"]
      })
    } else if (pathComponents.length === 0 && req.query.mode === "download") {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("ai"),
      })
      res.render("download", {
        portal: this.portal,
        error,
        current: req.originalUrl,
        install_required,
        requirements,
        requirements_pending,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        userdir: this.kernel.api.userdir,
        display: ["form"],
        query: req.query
      })
    } else if (pathComponents.length === 0 && req.query.mode === "settings") {
      let system_env = {}
      if (this.kernel.homedir) {
        system_env = await Environment.get(this.kernel.homedir)
      }
      let configArray = [{
        key: "home",
        description: [
          "* NO white spaces (' ')",
          "* NO exFAT drives",
        ],
        val: this.kernel.homedir,
        placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
//      }, {
//        key: "drive",
//        val: path.resolve(this.kernel.homedir, "drive"),
//        placeholder: "Pinokio virtual drives folder"
      }, {
        key: "theme",
        val: this.theme,
        options: ["light", "dark"]
      }, {
        key: "mode",
        val: this.mode,
        options: ["desktop", "background"]
      }, {
        key: "HTTP_PROXY",
        val: (system_env.HTTP_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }, {
        key: "HTTPS_PROXY",
        val: (system_env.HTTPS_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }, {
        key: "NO_PROXY",
        val: (system_env.NO_PROXY || ""),
        show_on_click: "#proxy",
        placeholder: "(Advanced) Only set if you are behind a proxy"
      }]
      let folders = {}
      if (this.kernel.homedir) {
        folders = {
          bin: path.resolve(this.kernel.homedir, "bin"),
          cache: path.resolve(this.kernel.homedir, "cache"),
          drive: path.resolve(this.kernel.homedir, "drive"),
        }
      }
      let list = this.getPeers()
      res.render("settings", {
        list,
        current_host: this.kernel.peer.host,
        platform,
        version: this.version,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        paths,
        config: configArray,
        query: req.query,
        ...folders
      })
    } else if (stat.isFile()) {
      if (req.query && req.query.raw) {
        try {
//          res.setHeader('Content-Disposition', 'inline');
          if (req.query.frame) {
            let m = mime.lookup(filepath)
            res.type("text/plain")
          }
          res.sendFile(filepath)
        } catch (e) {
          res.status(404).send(e.message);
        }
        return
      }

      // if js or json, editor
      // otherwise, stream the file


//      let filename = pathComponents[pathComponents.length-1]

      // try loading json
      let mod;
      let json
      let js

      if (filepath.endsWith(".json")) {
        try {
          json = (await this.kernel.loader.load(filepath)).resolved
          mod = true
        } catch (e) {
          console.log("######### load error", filepath, e)
        }
      }
      if (filepath.endsWith(".js")) {
        try {
          js = (await this.kernel.loader.load(filepath)).resolved
          mod = true
        } catch (e) {
          console.log("######### load error", filepath, e)
        }
      }

      let editmode = false

      let m = mime.lookup(filepath)
      if (json || js) {
        editmode = true
      } else if (!m) {
        editmode = true
      } else if (m.startsWith("audio") || m.startsWith("video") || m.startsWith("image")) {
        editmode = false
      } else {
        editmode = true
      }

      let runner = json || js

      let rawpath = `/raw/${pathComponents.join('/')}` + "?frame=true"
      if (editmode) {
        let content
        try {
          content = await fs.promises.readFile(filepath, "utf8")
        } catch (e) {
          content = ""
          console.log(">>>>>>>>>> Error", e)
        }

        /********************************************************************
        *
        *   uri :=
        *     | <http uri>
        *     | <relative path in relation to ~/pinokio/api>
        *
        ********************************************************************/

        let uri
        //if (gitRemote) {
        //  uri = `${gitRemote}/${pathComponents.slice(1).join("/")}`
        //} else {
        //  uri = path.resolve(this.kernel.api.userdir, ...pathComponents)
        //}


        //uri = path.resolve(this.kernel.api.userdir, ...pathComponents)
        uri = full_filepath

        let pinokioPath
        if (gitRemote) {
          pinokioPath = `pinokio://?uri=${gitRemote}/${pathComponents.slice(1).join("/")}`
        }

        let filename = pathComponents[pathComponents.length-1]
        let schemaPath



        //if (filename.endsWith(".json") || filename.endsWith(".js")) {
        //  schemaPath = pathComponents.slice(0,-1).join("/") + "/_" + filename
        //  const schemaFullPath = path.resolve(this.kernel.api.userdir, schemaPath)
        //  let exists = await this.exists(schemaFullPath)
        //  if (!exists) {
        //    schemaPath = "" 
        //  }
        //} else {
        //  schemaPath = ""
        //}


        if (filename.endsWith(".json") || filename.endsWith(".js")) {
          let stem = filename.replace(/\.(json|js)$/, "")
          let stempath = pathComponents.slice(0,-1).join("/") + "/_" + stem
          for(let p of [stempath + ".json", stempath + ".js"]) {
            //const schemaFullPath = path.resolve(this.kernel.api.userdir, p)
            const schemaFullPath = path.resolve(this.kernel.api.userdir, p)
            let exists = await this.exists(schemaFullPath)
            if (exists) {
              schemaPath = p
              break;
            }
          }
          if (!schemaPath) schemaPath = ""
        } else {
          schemaPath = ""
        }

        let runnable
        let resolved
        if (typeof runner === "function") {
          if (runner.constructor.name === "AsyncFunction") {
            resolved = await runner(this.kernel, this.kernel.info)
          } else {
            resolved = runner(this.kernel, this.kernel.info)
          }
          runnable = resolved && resolved.run ? true : false
        } else {
          runnable = runner && runner.run ? true : false
          resolved = runner
        }

        let template = "terminal"
        if (req.query && req.query.mode === "source") {
          template = "editor"
        }

        console.log("check requirements")
        let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
          //bin: this.kernel.bin.preset("ai"),
          bin: this.kernel.bin.preset("dev"),
          script: resolved
        })

        //let requirements = this.kernel.bin.requirements(resolved)
        //let requirements_pending = !this.kernel.bin.installed_initialized
        //let install_required = true
        //if (!requirements_pending) {
        //  install_required = false
        //  for(let i=0; i<requirements.length; i++) {
        //    let r = requirements[i]

        //    let relevant = this.relevant(r)
        //    requirements[i].relevant = relevant
        //    if (relevant) {
        //      let installed = await this.installed(r)
        //      requirements[i].installed = installed
        //      if (!installed) {
        //        install_required = true
        //      }
        //    }
        //  }
        //}

        //let error = null
        //try {
        //  this.kernel.bin.compatible()
        //} catch (e) {
        //  error = e.message
        //  install_required = true
        //}

        //requirements = requirements.filter((r) => {
        //  return r.relevant
        //})


        let mem = this.getMemory(filepath)

        let { editorUrl, prevUrl } = this.getVariationUrls(req)


        //let cwd = req.query.cwd ? req.query.cwd : path.dirname(filepath)
        let cwd = req.query.cwd ? req.query.cwd : filepath
        let env_requirements = await Environment.requirements(resolved, cwd, this.kernel)
        if (env_requirements.requires_instantiation) {
          //let p = Util.api_path(filepath, this.kernel)
          let p = Util.api_path(cwd, this.kernel)
          let platform = os.platform()
          if (platform === "win32") {
            p = p.replace(/\\/g, '\\\\')
          }
          console.log({ p, cwd })
          res.render("required_env_editor", {
            portal: this.portal,
            agent: this.agent,
            theme: this.theme,
            filename,
            filepath: p,
            items: env_requirements.items
          })
        } else {
          console.log("req.query.callback", req.query.callback)

          // check if it's a prototype script
          let kill_message
          let callback
          let callback_target
          if (req.query.callback) {
            callback = req.query.callback
//            kill_message = "Done! Click to go to the project"
          }
          if (req.query.callback_target) {
            callback_target = req.query.callback_target
          }

          let logpath = encodeURIComponent(Util.log_path(filepath, this.kernel))
          const result = {
            portal: this.portal,
            kill_message,
            callback,
            callback_target,
            prev: prevUrl,
            error,
            memory: mem,
  //          memory: mem,
            logo: this.logo,
            theme: this.theme,
            //run: (req.query && req.query.run ? true : false),
            //run: true,    // run mode by default
            run: (req.query && req.query.mode === "source" ? false : true),
            stop: (req.query && req.query.stop ? true : false),
            pinokioPath,
            runnable,
            agent: this.agent,
            rawpath,
            gitRemote,
            filename,
            filepath,
            logpath,
            encodedFilePath: encodeURIComponent(filepath),
            schemaPath,
            uri,
            mod,
            json,
            js,
            content,
            paths,
            requirements,
            requirements_pending,
            install_required,
            //current: encodeURIComponent(req.originalUrl),
            current: req.originalUrl,
            editorUrl,
            execUrl: "~" + req.originalUrl.replace(/^\/_api/, "\/api"),
            proxies: this.kernel.api.proxies[filepath],
            cwd: req.query.cwd,
            script_id: (req.base ? `${full_filepath}?cwd=${req.query.cwd}` : null),
            script_path: (req.base ? full_filepath : null),
          }

          res.render(template, result)
        }






      } else {
        res.render("frame", {
          portal: this.portal,
          logo: this.logo,
          theme: this.theme,
          agent: this.agent,
          rawpath: rawpath + "?frame=true",
          paths,
          filepath
        })
      }
    } else if (stat.isDirectory()) {

      if (req.query && req.query.mode === "browser") {
        return
      }


      let error
      let items
      let readme
//      if (pathComponents.length === 0) {
//        let files = await fs.promises.readdir(filepath, { withFileTypes: true })
//        items = files
//        //items = files.filter((f) => {
//        //  return f.name === "api"
//        //})
//      } else {
        let files = await fs.promises.readdir(filepath, { withFileTypes: true })
        let f = {
          files: [],
          folders: []
        }

        for(let file of files) {
          if (!file.name.startsWith(".")) {
            if (file.isDirectory()) {
              f.folders.push(file)
            } else {
              f.files.push(file)
            }
          }
        }

        // look for README.md

        let config
        for(let file of f.files) {
          if (file.name.toLowerCase() === "readme.md") {
            let p = path.resolve(filepath, file.name)
            let md = await fs.promises.readFile(p, "utf8")
            readme = marked.parse(md, {
              baseUrl: req._parsedUrl.pathname.replace(/^\/_api/, "/raw/") + "/"
              //baseUrl: req.originalUrl + "/"
            })
          }
          if (file.name === "pinokio.js") {
            let p = path.resolve(filepath, file.name)
            config  = (await this.kernel.loader.load(p)).resolved



            if (config && config.menu) {
              if (typeof config.menu === "function") {
                if (config.menu.constructor.name === "AsyncFunction") {
                  config.menu = await config.menu(this.kernel, this.kernel.info)
                } else {
                  config.menu = config.menu(this.kernel, this.kernel.info)
                }
              }

              await this.renderMenu(req, filepath.replace("/" + pathComponents[0], ""), pathComponents[0], config, pathComponents.slice(1))
              //for(let i=0; i<config.menu.length; i++) {
              //  let item = config.menu[i]
              //  if (item.href && !item.href.startsWith("http")) {
              //    let absolute = path.resolve(__dirname, ...pathComponents, item.href)
              //    let seed = path.resolve(__dirname)
              //    let p = absolute.replace(seed, "")
              //    let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              //    config.menu[i].href = "/api/" + link
              //  }
              //}

            }
            if (config && config.update) {
              if (typeof config.update === "function") {
                if (config.update.constructor.name === "AsyncFunction") {
                  config.update = await config.update(this.kernel, this.kernel.info)
                } else {
                  config.update = config.update(this.kernel, this.kernel.info)
                }
              }
              let absolute = path.resolve(__dirname, ...pathComponents, config.update)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              config.update = "/api/" + link
            }
          }

          // override config
          if (file.name === "pinokio_meta.json" || file.name === "pinokio.json") {
            let p = path.resolve(filepath, file.name)
            let c  = (await this.kernel.loader.load(p)).resolved
            if (c.title) {
              if (!config) config = {}
              config.title = c.title
            }
            if (c.description) {
              if (!config) config = {}
              config.description = c.description
            }
            if (c.icon) {
              if (!config) config = {}
              config.icon = c.icon
            }
          }
        }
        if (!config) config = {}


  //      let folder = pathComponents[pathComponents.length - 1]

        items = f.folders.concat(f.files)
//      }
      let display = pathComponents.length === 0 ? ["form", "explore"] : []
      //let display = ["form"]

      if (pathComponents.length === 0 && items.length === 0) {
        display.push("onboarding")
      }

      if (gitRemote && pathComponents.length === 1) {
        display.push("pull")
      }

      if (config.install) {
        display.push("install")
      }
      if (config.menu) {
        display.push("menu")
      }


      if (config.dependencies && config.dependencies.length > 0) {
        // check if already installed 
        // 'downloaded' is null if the git_uri does not exist on the file system yet (kernel.api.gitPath)
        config.dependencies = config.dependencies.map((git_uri) => {
          let gitPath = this.kernel.api.gitPath[git_uri]
          let downloaded
          if (gitPath) {
            downloaded = path.basename(gitPath)
          } else {
            downloaded = null
          }
          return {
            uri: git_uri,
            //downloaded: (this.kernel.api.gitPath[git_uri] ? "0x" + Buffer.from(git_uri).toString("hex") : null)
            downloaded: downloaded
          }
        })
        display.push("dependencies")
      }

      let uri = path.resolve(this.kernel.api.userdir, ...pathComponents)

      let pinokioPath
      if (gitRemote) {
        pinokioPath = `pinokio://?uri=${gitRemote}/${pathComponents.slice(1).join("/")}`
      }

      let running = []
      let notRunning = []
      if (pathComponents.length === 0) {


        let index = 0
        for(let i=0; i<items.length; i++) {
          let item = items[i]
          let p = path.resolve(uri, item.name, "pinokio.js")
          let config  = (await this.kernel.loader.load(p)).resolved
          if (config) {
            if (config.shortcuts) {
              if (typeof config.shortcuts === "function") {
                if (config.shortcuts.constructor.name === "AsyncFunction") {
                  config.shortcuts = await config.shortcuts(this.kernel, this.kernel.info)
                } else {
                  config.shortcuts = config.shortcuts(this.kernel, this.kernel.info)
                }
              }
              await this.renderShortcuts(uri, item.name, config, pathComponents)
              items[i].shortcuts = config.shortcuts
            }
          }

          // lib types should not be displayed on the home page
          if (config && config.type === "lib") {
            continue
          }
          // check if there is a running process with this folder name
          let runningApps = new Set()
          for(let key in this.kernel.api.running) {
            //let p = this.kernel.path("api", items[i].name) + path.sep
            let p = this.kernel.path("api", items[i].name)

            // not only should include the pattern, but also end with it (otherwise can include similar patterns such as /api/qqqa, /api/qqqaaa, etc.

            let is_running
            let api_path = this.kernel.path("api")
            if (this.is_subpath(api_path, key)) {
              // normal api script at path p
              if (this.is_subpath(p, key)) {
                is_running = true
              }
            } else {
              if (key.endsWith(p)) {
                // global scripts that run in the path p
                is_running = true
              } else {
                // shell sessions
                if (key.startsWith("shell/")) {
                  let unix_path = key.slice(6)
                  let native_path = Util.u2p(unix_path)
                  let chunks = native_path.split("_")
                  if (chunks.length > 1) {
                    let folder = chunks[0]
                    /// if the folder name matches, it's running
                    let item_path = this.kernel.path("api", items[i].name)
                    if (item_path === folder) {
                      is_running = true
                    }
                  }
                }
              }
            }
            // 1. if the script path starts with api path => api script
            //    => check includes and startsWith

            // 2. if the script path starts with anything else => other scripts (prototype, plugin ,etc.)
            //    => check inlcludes and endsWith

            //if (key.includes(p) && key.endsWith(p)) {
            if (is_running) {
              // add to running
              running.push(items[i]) 
              if (!items[i].running_scripts) {
                items[i].running_scripts = []
              }
              items[i].running = true
              items[i].index = index

              // add the running script to running_scripts array
              // 1. normal api script
              if (path.isAbsolute(key)) {
                // script
                if (this.is_subpath(api_path, key)) {
                  // scripts inside api folder
                  if (this.is_subpath(p, key)) {
                    items[i].running_scripts.push({ path: path.relative(this.kernel.homedir, key), name: path.relative(p, key) })
                  }
                } else {
                  // other global scripts
                  let chunks = key.split("?")
                  let dev = chunks[0]
                  let relpath = path.relative(this.kernel.homedir, dev)
                  let name_chunks = relpath.split(path.sep)
                  let name = "/" + relpath
                  items[i].running_scripts.push({ id: key, name })
                }
              } else {
                let shell = this.kernel.shell.find({
                  filter: (shell) => {
                    let item_path = this.kernel.path("api", items[i].name)
                    let unix_item_path = Util.p2u(item_path)
                    return shell.id.startsWith("shell/" + unix_item_path + "_")
                  }
                })
                if (shell.length > 0) {
                  items[i].running = true
                  items[i].index = index
                  for(let sh of shell) {
                    items[i].running_scripts.push({ id: sh.id, name: "Terminal", type: "shell" })
                  }
                }
              }
              index++;
            }
          }
          if (!items[i].running) {
            items[i].index = index
            index++;
            notRunning.push(items[i])
          }
        }
      }

      running = this.getItems(running, meta, p)
      notRunning = this.getItems(notRunning, meta, p)

      // check running for each
      // running_items
      items = items.map((x) => {
        //let name = (x.name.startsWith("0x") ? Buffer.from(x.name.slice(2), "hex").toString() : x.name)
        let name
        let description
        let icon = "/pinokio-black.png"
        let iconpath
        let apipath
        let uri
        if (meta) {
          let m = meta[x.name]
          name = (m && m.title ? m.title : x.name)
          description = (m && m.description ? m.description : "")
          if (m && m.icon) {
            icon = m.icon
          } else {
            //icon = null
            icon = "/pinokio-black.png"
          }
          if (m && m.iconpath) {
            iconpath = m.iconpath
          }
          if (m && m.path) {
            apipath = m.path
          }
          uri = x.name
        } else {
          if (x.isDirectory()) {
            icon = "fa-solid fa-folder"
          } else {
            icon = "fa-regular fa-file"
          }
          name = x.name
          description = ""
        }
        return {
          icon,
          iconpath,
          path: apipath,
          menu: x.menu,
          run: x.run,
          shortcuts: x.shortcuts,
          //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
          name,
          uri,
          //description: x.path,
          description,
          //url: p + "/" + x.name,
          url: _p + "/" + x.name,
//            url: `${U}/${x.name}`,
          //browser_url: "/pinokio/browser/" + x.name
          browser_url: "/p/" + x.name
        }
      })


//      if (req.query && req.query.mode === "task") {
//        running = running.filter((x) => {
//          return x.run && Array.isArray(x.run)
//        })
//        notRunning = notRunning.filter((x) => {
//          return x.run && Array.isArray(x.run)
//        })
//      } else {
//        running = running.filter((x) => {
//          return !(x.run && Array.isArray(x.run))
//        })
//        notRunning = notRunning.filter((x) => {
//          return !(x.run && Array.isArray(x.run))
//        })
//      }


 //     let U = `${_p}/${pathComponents.join("/")}`
 //     console.log("*******", { filepath, pathComponents, U })

      let pinokio_proxy = this.kernel.api.proxies["/"]
      let pinokio_cloudflare = this.cloudflare_pub

      let qr = null
      let qr_cloudflare = null
      let home_proxy = null
      if (pinokio_proxy && pinokio_proxy.length > 0) {
        qr = await QRCode.toDataURL(pinokio_proxy[0].proxy)
        home_proxy = pinokio_proxy[0]
      }

      if (this.cloudflare_pub) {
        qr_cloudflare = await QRCode.toDataURL(this.cloudflare_pub)
      }

      // custom theme
      let exists = await fse.pathExists(this.kernel.path("web"))
      if (exists) {
        let config_exists = await fse.pathExists(this.kernel.path("web/config.json"))
        if (config_exists) {
          let config = (await this.kernel.loader.load(this.kernel.path("web/config.json"))).resolved
          if (config) {
            if (this.colors) {
              if (config.color) this.colors.color = config.color
              if (config.symbolColor) this.colors.symbolColor = config.symbolColor
            }
            if (config.xterm) {
              this.xterm = config.xterm
            }
          }
        }
      }

      await this.kernel.peer.check_peers()
      let current_urls = await this.current_urls()

//      let list = this.getPeerInfo()
      let list = this.getPeers()

      if (meta) {
        items = running.concat(notRunning)
        res.render("index", {
          list,
          current_host: this.kernel.peer.host,
          current_urls,
          portal: this.portal,
          install: this.install,
          folders: null,
          launch_complete: this.kernel.launch_complete,
          home_url: `http://localhost:${this.port}`,
          proxy: home_proxy,
          cloudflare_pub: this.cloudflare_pub,
          qr,
          qr_cloudflare,
          error: error,
          logo: this.logo,
  //        memory: mem,
          theme: this.theme,
          pinokioPath,
          config,
          display,
          agent: this.agent,
  //        folder,
          paths,
          uri,
          gitRemote,
          userdir: this.kernel.api.userdir,
          ishome: meta,
          running,
          notRunning,
          readme,
          filepath,
          mode: null,
          kernel: this.kernel,
          //mode: (req.query && req.query.mode ? req.query.mode : null),
          items
        })
      } else {
        res.render("file_explorer", {
          docs: this.docs, 
          portal: this.portal,
          home_url: `http://localhost:${this.port}`,
          proxy: home_proxy,
          cloudflare_pub: this.cloudflare_pub,
          qr,
          qr_cloudflare,
          error: error,
          logo: this.logo,
  //        memory: mem,
          theme: this.theme,
          pinokioPath,
          config,
          display,
          agent: this.agent,
  //        folder,
          paths,
          uri,
          gitRemote,
          userdir: this.kernel.api.userdir,
          ishome: meta,
          running,
          notRunning,
          readme,
          filepath,
          mode: null,
          kernel: this.kernel,
          //mode: (req.query && req.query.mode ? req.query.mode : null),
          items
        })
      }

    }
  }
  async renderShortcuts(uri, name, config, pathComponents) {
    if (config.shortcuts) {
      for(let i=0; i<config.shortcuts.length; i++) {
        let shortcut = config.shortcuts[i]
        if (shortcut.action) {
          if (shortcut.action.method === "stop") {
            if (shortcut.action.uri) {
              let absolute = path.resolve(__dirname, ...pathComponents, shortcut.action.uri)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              let uri = "~/api/" + name + "/" + link

              config.shortcuts[i].action.uri = uri


              if (shortcut.hasOwnProperty("text")) {
                if (shortcut.hasOwnProperty("icon")) {
                  config.shortcuts[i].html = `<i class="${shortcut.icon}"></i> ${shortcut.text}` 
                } else {
                  config.shortcuts[i].html = `${shortcut.text}` 
                }
                config.shortcuts[i].btn = shortcut.html
              }

            }
          }
        }
      }
    }
  }


  renderMenu2(config, base, keypath) {
    // when the config has not loaded yet
    if (!config) {
      return { menu: [] }
    }
    if (config.menu) {
      for(let i=0; i<config.menu.length; i++) {
        let item = config.menu[i]
        let new_keypath
        if (keypath) {
          new_keypath = keypath.concat(i)
        } else {
          new_keypath = [i]
        }
        let c = this.renderMenu2(item, base, new_keypath)
        config.menu[i] = c
      }
    }
    if (config.text) {
      if (config.hasOwnProperty("icon")) {
        config.html = `<i class="${config.icon}"></i> ${config.text}` 
      } else if (config.hasOwnProperty("image")) {
        let imagePath = `${base.web_path}/${config.image}`
        config.html = `<img class='menu-item-image' src='${imagePath}' /> ${config.text}`
      } else {
        config.html = `${config.text}` 
      }
      config.btn = config.html
      config.arrow = true
    }
    /*
    if (config.href && !config.href.startsWith("/")) {
      if (base.href) {
        config.href = base.href + "/" + config.href
      }
    }
    */
    if (keypath) {
      config.href = base.href + "/" + keypath.join("/") + "?path=" + base.cwd
      //config.script_id = this.kernel.path(keypath) + "?cwd=" + base.cwd
      config.script_id = path.resolve(base.path, config.href) + "?cwd=" + base.cwd
    }
    return config
  }
  renderShell(cwd, indexPath, subIndexPath, menuitem) {
    if (menuitem.shell) {
      /*
        shell :- {
          id (optional),
          path (required),    // api, bin, quick, network, api/
          message (optional), // if not specified, start an empty shell
          venv,
          input,              // input mode if true
          callback,           // callback url after shutting down
          kill,               // when to kill (regular expression)
        }
      */

      let rendered = this.kernel.template.render(menuitem.shell, {})
      let params = new URLSearchParams()
//          if (rendered.id) {
//            params.set("id", encodeURIComponent(rendered.id))
//          } else {
//            let shell_id = "sh_" + name + "_" + i
//            params.set("id", encodeURIComponent(shell_id))
//          }
      if (rendered.path) {
        params.set("path", encodeURIComponent(this.kernel.api.filePath(rendered.path, cwd)))
      } else {
        params.set("path", encodeURIComponent(cwd))
      }
      if (rendered.message) params.set("message", encodeURIComponent(rendered.message))
      if (rendered.venv) params.set("venv", encodeURIComponent(rendered.venv))
      if (rendered.input) params.set("input", true)
      if (rendered.callback) params.set("callback", encodeURIComponent(rendered.callback))
      if (rendered.callback_target) params.set("callback_target", rendered_callback_target)
      if (rendered.kill) params.set("kill", encodeURIComponent(rendered.kill))
      if (rendered.done) params.set("done", encodeURIComponent(rendered.done))
      if (rendered.env) {
        for(let key in rendered.env) {
          let env_key = "env." + key
          params.set(env_key, rendered.env[key])
        }
      }
      if (rendered.conda) {
        for(let key in rendered.conda) {
          let conda_key = "conda." + key
          params.set(conda_key, rendered.conda[key])
        }
      }

      // deterministic shell id generation
      // `${api_path}_${i}_${hash}`
      let currentIndexPath
      if (indexPath) {
        currentIndexPath = indexPath + "." + subIndexPath
      } else {
        currentIndexPath = "" + subIndexPath
      }
      let unix_path = Util.p2u(cwd)
      let shell_id = this.get_shell_id(unix_path, currentIndexPath, rendered)

//          let hash = crypto.createHash('md5').update(JSON.stringify(rendered)).digest('hex')
//          let shell_id
//          if (rendered.id) {
//            shell_id = encodeURIComponent(`${name}_${rendered.id}`)
//          } else {
//            shell_id = encodeURIComponent(`${name}_${i}_${hash}`)
//          }
      menuitem.href = "/shell/" + shell_id + "?" + params.toString()
      let decoded_shell_id = decodeURIComponent(shell_id)
      let shell = this.kernel.shell.get(decoded_shell_id)
      menuitem.shell_id = "shell/" + decoded_shell_id
      if (shell) {
        menuitem.running = true
      } else {
        let shell = this.kernel.shell.get(decoded_shell_id)
        if (shell) {
          menuitem.running = true
        }
      }
    }
    return menuitem
  }

  async renderMenu(req, uri, name, config, pathComponents, indexPath) {
    console.log("renderMenu", { req, uri, name, config, pathComponents, indexPath })
    if (config.menu) {

//      config.menu = [{
//        base: "/",
//        text: "Configure",
//        href: `env/api/${name}/ENVIRONMENT`,
//        icon: "fa-solid fa-gear",
//        mode: "refresh"
////      }, {
////        base: "/",
////        text: "Public Share",
////        action: {
////          method: "env.set",
////          params: {
////            "PINOKIO_SHARE_CLOUDFLARE": true,
////            "PINOKIO_SHARE_LOCAL": true
////          }
////        },
////        href: `env/api/${name}/ENVIRONMENT`,
////        icon: "fa-solid fa-gear"
//      }].concat(config.menu)

      for(let i=0; i<config.menu.length; i++) {
        let menuitem = config.menu[i]

        console.log("MENU ITEM", JSON.stringify(menuitem, null, 2))

        if (menuitem.menu) {
          let newIndexPath
          if (indexPath) {
            newIndexPath = indexPath + "." + i
          } else {
            newIndexPath = "" + i
          }
          let m = await this.renderMenu(req, uri, name, { menu: menuitem.menu }, pathComponents, newIndexPath)
          menuitem.menu = m.menu
        }

        if (menuitem.base && menuitem.base.startsWith("/")) {
          config.menu[i].href = menuitem.base + menuitem.href
        } else {
          if (menuitem.href && !menuitem.href.startsWith("http")) {

            // href resolution
            if (menuitem.fs) {
              // file explorer
              config.menu[i].href = path.resolve(this.kernel.homedir, "api", name, menuitem.href)
            } else if (menuitem.command) {
              // file explorer
              config.menu[i].href = path.resolve(this.kernel.homedir, "api", name, menuitem.href)
            } else {
              if (menuitem.href.startsWith("/")) {
                config.menu[i].href = menuitem.href
              } else {
                let absolute = path.resolve(__dirname, ...pathComponents, menuitem.href)
                let seed = path.resolve(__dirname)
                let p = absolute.replace(seed, "")
                let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
                config.menu[i].href = "/api/" + name + "/" + link
              }
            }
          } else if (menuitem.run) {
            let rendered = this.kernel.template.render(menuitem, {})
            // file explorer
            if (typeof rendered.run === "object") {
              let run = rendered.run
              config.menu[i].run = run.message
              config.menu[i].cwd = run.path ? path.resolve(this.kernel.homedir, "api", name, run.path) : path.resolve(this.kernel.homedir, "api", name)
              config.menu[i].href = "/api/" + name
            } else {
              config.menu[i].run = rendered.run
              config.menu[i].cwd = path.resolve(this.kernel.homedir, "api", name)
              config.menu[i].href = "/api/" + name
            }
          }
        }

        if (menuitem.href && menuitem.params) {
          menuitem.href = menuitem.href + "?" + new URLSearchParams(menuitem.params).toString();
        }


        if (menuitem.shell) {
          let basePath = this.kernel.path("api", name)
          this.renderShell(basePath, indexPath, i, menuitem)
        }

        if (menuitem.href) {
          let u
          let cwd
          if (menuitem.href.startsWith("http")) {
            menuitem.src = menuitem.href
          } else if (menuitem.href.startsWith("/")) {
            let run_path = "/run"
            if (menuitem.href.startsWith(run_path)) {
              u = new URL("http://localhost" + menuitem.href.slice(run_path.length))
              cwd = u.searchParams.get("cwd")
              u.search = ""
              menuitem.src = u.pathname
            } else {
              u = new URL("http://localhost" + menuitem.href)
              cwd = u.searchParams.get("cwd")
              u.search = ""
              menuitem.src = u.pathname
            }
          } else {
            u = new URL("http://localhost/" + menuitem.href)
            cwd = u.searchParams.get("cwd")
            u.search = ""
            menuitem.src = u.pathname
          }

          // check running
          let fullpath = this.kernel.path(menuitem.src.slice(1))
          let relpath = path.relative(this.kernel.homedir, fullpath)
          if (relpath.startsWith("api")) {
            // api script
            if (this.kernel.api.running[fullpath]) {
              menuitem.running = true
            }
          } else {
            // prototype script
            let api_path = this.kernel.path("api", name)
            let id = `${fullpath}?cwd=${api_path}`
            if (this.kernel.api.running[id]) {
              menuitem.running = true
            }
          }

        }

        if (menuitem.action) {
          if (menuitem.action.method === "stop") {
            if (menuitem.action.uri) {
              let absolute = path.resolve(__dirname, ...pathComponents, menuitem.action.uri)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              let uri = "~/api/" + name + "/" + link

              config.menu[i].action.uri = uri
            }
          }
        }






//        if (menuitem.href && menuitem.params) {
//          menuitem.href = menuitem.href + "?" + new URLSearchParams(menuitem.params).toString();
//        }



        // check on/off: if on/off exists => assume that it's a script
        // 1. check if the script is running
        if (menuitem.when) {
          let scriptPath = path.resolve(uri, name, menuitem.when)
          let filepath = scriptPath.replace(/\?.+/, "")
          let check = this.kernel.status(filepath)
          if (check) {
            // 2. if it's running, display the "on" HTML. If "on" doesn't exist, don't display anything
            if (menuitem.on) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.on
              } else {
                config.menu[i].btn = menuitem.on
              }
            }
          } else {
            // 3. If it's NOT running, display the "off" HTML, If "off" doesn't exist, don't display anything
            if (menuitem.off) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.off
              } else {
                config.menu[i].btn = menuitem.off
              }
            }
          }
        } else if (menuitem.filter) {
          if (menuitem.filter()) {
            if (menuitem.hasOwnProperty("html")) {
              if (menuitem.type === "label") {
                config.menu[i].label = menuitem.html
              } else {
                config.menu[i].btn = menuitem.html
              }
            }
          }
        } else {
          if (menuitem.hasOwnProperty("html")) {
            if (menuitem.type === "label") {
              config.menu[i].label = menuitem.html
            } else {
              config.menu[i].btn = menuitem.html
            }
          } else if (menuitem.hasOwnProperty("text")) {
            if (menuitem.hasOwnProperty("image")) {
              let imagePath
              if (menuitem.image.startsWith("/")) {
                imagePath = menuitem.image
              } else {
                imagePath = `/api/${name}/${menuitem.image}?raw=true`
              }
              menuitem.html = `<img class='menu-item-image' src='${imagePath}' /> ${menuitem.text}`
            } else if (menuitem.hasOwnProperty("icon")) {
              menuitem.html = `<i class="${menuitem.icon}"></i> ${menuitem.text}` 
            } else {
              menuitem.html = `${menuitem.text}` 
            }

            if (menuitem.href) {
              // button
              config.menu[i].btn = menuitem.html
            } else if (menuitem.action) {
              config.menu[i].btn = menuitem.html
            } else if (menuitem.menu) {
              config.menu[i].btn = menuitem.html
            } else {
              // label
              config.menu[i].label = menuitem.html
            }
          }
        }
        if (config.menu[i].popout) {
          config.menu[i].target = "_blank"
        } else {
          config.menu[i].target = "@" + (config.menu[i].id || config.menu[i].src)
        }


        if (config.menu[i].href && config.menu[i].href.startsWith("http")) {
          if (this.agent !== "electron") {
            config.menu[i].target = "_blank"
          }
        }

        if (menuitem.shell_id) {
          config.menu[i].shell_id = menuitem.shell_id
        }


      }


      config.menu = config.menu.filter((item) => {
        return item.btn
      })


//      // get all proxies that belong to this repository
//      let childProxies = []
//      for(let scriptPath in this.kernel.api.proxies) {
//        let proxies = this.kernel.api.proxies[scriptPath]
//        for(let proxy of proxies) {
//          if (scriptPath.startsWith(this.kernel.path("api", name))) {
//            childProxies.push(proxy) 
//          }
//        }
//      }
//
//      let proxyMenu = []
//      for(let proxy of childProxies) {
//        proxyMenu.push({
//          btn: `<i class="fa-solid fa-wifi"></i> <strong>WiFi</strong>&nbsp;-&nbsp;${proxy.name}`,
//          target: "_blank",
//          href: proxy.proxy
//        })
//      }
//      config.menu = proxyMenu.concat(config.menu)
//
//      console.log("MENU", JSON.stringify(config.menu, null, 2))

//      if (!config.icon) {
//        if (this.theme === "light") {
//          config.icon = "/pinokio-black.png"
//        } else {
//          config.icon = "/pinokio-white.png"
//        }
//      }
      console.log("############## config", JSON.stringify(config, null, 2))

      config = Util.rewrite_localhost(this.kernel, config, req.$source)

      return config
    } else {
      return config
    }
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
  async installed(r) {
    if (Array.isArray(r.name)) {
      for(let name of r.name) {
        let installed = await this._installed(name, r.type)
        if (!installed) return false
      }
      return true
    } else {
      let installed = await this._installed(r.name, r.type)
      return installed
    }
  }
  async sudo_exec(message, homedir) {
    // sudo-prompt uses TEMP
//    let TEMP = path.resolve(homedir, "cache", "TEMP")
//    await fs.promises.mkdir(TEMP, { recursive: true }).catch((e) => { })
    let response = await new Promise((resolve, reject) => {
//      let env = { TEMP }
      let env = {}
      if (process.env.path) env.path = process.env.path
      if (process.env.Path) env.Path = process.env.Path
      if (process.env.PATH) env.PATH = process.env.PATH
      sudo.exec(message, {
        name: "Pinokio",
        env,
      }, (err, stdout, stderr) => {
        if (err) {
          reject(err)
//        } else if (stderr) {
//          reject(stderr)
        } else {
          resolve(stdout)
        }
      });
    })
    return response
  }
  async mv(existing_home, new_home) {
    //// Next, empty the bin folder => need to reinitialize because of symlinks, etc. with the package managers
    console.log("RUNNING RM BIN")
    const path_to_delete = path.resolve(existing_home, "bin")
    let del_cmd
    if (this.kernel.platform === "win32") {
      del_cmd = `rd /s /q ${path_to_delete}`
    } else {
      del_cmd = `rm -rf ${path_to_delete}`
    }
    console.log("del_cmd", del_cmd)

    await this.sudo_exec(del_cmd, new_home)
    console.log("FINISHED RM BIN")

    console.log("RUNNING MV")
    let mv_cmd
    if (this.kernel.platform === "win32") {
      // robocoyp returns 1 when successful
      //mv_cmd = `start /wait (robocopy ${existing_home} ${new_home} /E /MOVE /NFL /NDL) ^& IF %ERRORLEVEL% LEQ 1 exit 0`
      //mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL /NDL`
      mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL`
      //mv_cmd = `start /wait robocopy ${existing_home} ${new_home} /E /MOVE /NFL`
    } else {
      mv_cmd = `mv ${existing_home} ${new_home}`
    }
    try {
      await this.sudo_exec(mv_cmd, existing_home)
    } catch (e) {
      console.log("ROBOCOPY RESULT", e)
    }
    console.log("FINISHED MV")
  }
  getPeerInfo() {
    let list = []
    let peers_info = {}
    if (this.kernel.peer.info) {
      peers_info = this.kernel.peer.info
      let remote_peers = Object.keys(this.kernel.peer.info).filter(x => x !== this.kernel.peer.host)
      let nodes = [this.kernel.peer.host].concat(remote_peers)
      for(let host of nodes) {
        let processes = []
        try {
          let procs = this.kernel.peer.info[host].proc
          let router = this.kernel.peer.info[host].router
          let port_mapping = this.kernel.peer.info[host].port_mapping
          for(let proc of procs) {
            let chunks = proc.ip.split(":")
            let internal_port = chunks[chunks.length-1]
            let internal_host = chunks.slice(0, chunks.length-1).join(":")
            let external_port = port_mapping[internal_port]

            let merged
            let external_ip
            if (external_port) {
              external_ip = `${host}:${external_port}`
//              merged = Array.from(new Set(router[external_ip].concat(router[proc.ip])))
            } else {
//              merged = router[proc.ip]
            }
            processes.push({
              external_router: router[external_ip] || [],
              internal_router: router[proc.ip] || [],
              //router: merged || [],
              external_ip,
              external_port: parseInt(external_port),
              internal_port: parseInt(internal_port),
              ...proc
            })
            //if (external_port) {
            //  let external_ip = `${host}:${external_port}`
            //  // merge router
            //  let merged = Array.from(new Set(router[external_ip].concat(router[proc.ip))
            //  processes.push({
            //    //proxy: this.kernel.caddy.mapping[item.ip] || [],
            //    //router: router[external_ip] || [],
            //    router: merged || [],
            //    external_ip,
            //    external_port: parseInt(external_port),
            //    internal_port: parseInt(internal_port),
            //    ...proc
            //  })
            //} else {
            //  processes.push({
            //    router: [],
            //    external_port: parseInt(external_port),
            //    internal_port: parseInt(internal_port),
            //    ...proc
            //  })
            //}
          }
          // merge processes
          // 1. 
          processes.sort((a, b) => {
            return b.external_port-a.external_port
          })
          list.push({
            host,
            name: this.kernel.peer.info[host].name,
            platform: this.kernel.peer.info[host].platform,
            processes
          })
        } catch (e) {
          console.log(">>e", e)
          console.log({ host, info: this.kernel.peer.info })
        }
      }
//      console.log("Loaded yet?", nodes.length, Object.keys(peers_info).length, nodes.length === Object.keys(peers_info).length)
    }
    return list
  }


  async syncConfig() {

    // 1. THEME
    this.theme = this.kernel.store.get("theme") || "light"
    this.mode = this.kernel.store.get("mode") || "desktop"

    // when loaded in electron but in minimal mode,
    // the app is loaded in the web so the agent should be "web"
    if (this.agent === "electron") {
      if (this.mode === "minimal" || this.mode === "background") {
        this.agent = "web"
      }
    }

    if (this.theme === "dark") {
      this.colors = {
        color: "rgb(27, 28, 29)",
        symbolColor: "white"
//        color: "rgb(31, 29, 39)",
//        symbolColor: "#b7a1ff"
      }
    } else {
      this.colors = {
        color: "white",
//        color: "#F5F4FA",
        symbolColor: "black",
      }
    }
    //this.logo = (this.theme === 'dark' ?  "<img class='icon' src='/pinokio-white.png'>" : "<img class='icon' src='/pinokio-black.png'>")
    //this.logo = '<i class="fa-solid fa-house"></i>'
    this.logo = "<img src='/pinokio-black.png' class='icon'>"

    // 4. existing home is set + new home is set + existing home does NOT exist => delete the "home" field and DO NOT go through with the move command
    // 5. existing home is NOT set + new home is set => go through with the "home" setting procedure
    // 6. existing home is NOT set + new home is NOT set => don't touch anything => the homedir will be the default home

//    // 2. HOME
//    // 2.1. Check if the config includes NEW_HOME => if so,
//    //    - move the HOME folder to NEW_HOME
//    //    - set HOME=NEW_HOME
//    //    - remove NEW_HOME
//    let existing_home = this.kernel.store.get("home")
//    let new_home = this.kernel.store.get("new_home")
//
//    if (existing_home) {
//      let exists = await fse.pathExists(existing_home)
//      if (exists) {
//        if (new_home) {
//          let new_home_exists = await fse.pathExists(new_home)
//          if (new_home_exists) {
//            // - existing home is set
//            // - existing home exists
//            // - new home is set
//            // - new home exists already
//            //    => delete store.new_home ==> will load at store.home
//            this.kernel.store.delete("new_home")
//          } else {
//            // - existing home is set
//            // - existing home exists
//            // - new home is set
//            // - new home does not exist
//            //    => run mv()
//            //    => update store.home
//            //    => delete store.new_home
//            await this.mv(existing_home, new_home)
//            this.kernel.store.set("home", new_home)
//            this.kernel.store.delete("new_home")
//          }
//        } else {
//          // - existing home is set
//          // - existing home exists
//          // - new home is not set
//          //    => This is most typical scenario => don't touch anything => the homedir will be the existing home
//        }
//      } else {
//        if (new_home) {
//          // - existing home is set
//          // - but the existing home path DOES NOT exist
//          // - new home is set
//          //    => This is an invalid scenario => Just to avoid disaster, just delete store.home and delete store.new_home
//          //    => the app will load at ~/pinokio
//          this.kernel.store.delete("home")
//          this.kernel.store.delete("new_home")
//        } else {
//          // - existing home is set
//          // - but the existing home path DOES NOT exist
//          // - new home is NOT set
//          //    => This is an invalid scenario => just delete store.home
//          //    => the app will load at ~/pinokio
//          this.kernel.store.delete("home")
//        }
//      }
//    } else {
//      if (new_home) {
//        // - existing home is NOT set
//        // - new home is set
//        //    => update store.home
//        //    => delete store.new_home
//        this.kernel.store.set("home", new_home)
//        this.kernel.store.delete("new_home")
//      } else {
//        // - existing home is NOT set
//        // - new home is NOT set
//        //    => don't touch anything => will load at ~/pinokio
//      }
//    }
  }
  async setConfig(config) {
    let home = this.kernel.store.get("home")
    let theme = this.kernel.store.get("theme")
    let mode = this.kernel.store.get("mode")
//    let drive = this.kernel.store.get("drive")

    // 1. Handle THEME
    if (config.theme) {
      this.kernel.store.set("theme", config.theme)
      //this.theme = config.theme
    }
    // 2. Handle HOME
    if (config.home) {
      // set "new_home"

      // if the home is different from the existing home, go forward
      if (config.home !== home) {
        const basename = path.basename(config.home)
        // check for invalid path
        let isValidPath = (basename !== '' && basename !== config.home)
        if (!isValidPath) {
          throw new Error("Invalid path: " + config.home)
        }

//        // check if the destination already exists => throw error
//        let exists = await fse.pathExists(config.home)
//        if (exists) {
//          throw new Error(`The path ${config.home} already exists. Please remove the folder and retry`)
//        }

        //this.kernel.store.set("new_home", config.home)
        this.kernel.store.set("home", config.home)
      }

    }

    let mode_changed = false
    if (config.mode) {
      if (config.mode !== mode) {
        mode_changed = true
      }
      this.kernel.store.set("mode", config.mode)
    }
//    // 3. Handle Drive
//    if (config.drive) {
//      // if the home is different from the existing home, go forward
//      if (config.drive !== drive) {
//        const basename = path.basename(config.drive)
//        // check for invalid path
//        let isValidPath = (basename !== '' && basename !== config.drive)
//        if (!isValidPath) {
//          throw new Error("Invalid path: " + config.home)
//        }
//
//        // check if the destination already exists => throw error
//        let exists = await fse.pathExists(config.drive)
//        if (exists) {
//          throw new Error(`The path ${config.drive} already exists. Please remove the folder and retry`)
//        }
//
//        this.kernel.store.set("drive", config.drive)
//      }
//
//    }


    home = this.kernel.store.get("home")
    theme = this.kernel.store.get("theme")
    let new_home = this.kernel.store.get("new_home")

    // Handle environment variables
    // HTTP_PROXY
    // HTTPS_PROXY
//    const updated = { }
//    if (config.HTTP_PROXY) {
//      updated.HTTP_PROXY = config.HTTP_PROXY
//    }
//    if (config.HTTPS_PROXY) {
//      updated.HTTPS_PROXY = config.HTTPS_PROXY
//    }
    if (this.kernel.homedir) {
      const updated = {
        HTTP_PROXY: config.HTTP_PROXY,
        HTTPS_PROXY: config.HTTPS_PROXY,
        NO_PROXY: config.NO_PROXY,
      }
      let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      await Util.update_env(fullpath, updated)
    }

    this.kernel.store.set("HTTP_PROXY", config.HTTP_PROXY)
    this.kernel.store.set("HTTPS_PROXY", config.HTTPS_PROXY)
    this.kernel.store.set("NO_PROXY", config.NO_PROXY)

    if (mode_changed) {
      return {
        title: "Restart Required",
        text: "Please restart the app"
      }
    }
  }
  async startLogging(homedir) {
    if (!this.debug) {
      if (this.logInterval) {
        clearInterval(this.logInterval)
      }
      if (homedir) {
        let logsdir = path.resolve(homedir, "logs")
        await fs.promises.mkdir(logsdir, { recursive: true }).catch((e) => { console.log(e) })
        if (!this.log) {
          this.log = fs.createWriteStream(path.resolve(homedir, "logs/stdout.txt"))
          process.stdout.write = process.stderr.write = this.log.write.bind(this.log)
          process.on('uncaughtException', (err) => {
            console.error((err && err.stack) ? err.stack : err);
          });
          this.logInterval = setInterval(async () => {
            try {
              let file = path.resolve(homedir, "logs/stdout.txt")
              let data = await fs.promises.readFile(file, 'utf8')
              let lines = data.split('\n')
              if (lines.length > 100000) {
                let str = lines.slice(-100000).join("\n")
                await fs.promises.writeFile(file, str)
              }
            } catch (e) {
              console.log("Log Error", e)
            }
          }, 1000 * 60 * 10)  // 10 minutes
        }
      }
    }
  }
  async running(port) {
    let p = port || DEFAULT_PORT
    const available = await Util.is_port_available(p)
    if (available) {
      return false
    } else {
      return true
    }
  }
  async terminals(filepath) {
    let venvs = await Util.find_venv(filepath)
    let terminal
    if (venvs.length > 0) {
      let terminals = []
      try {
        for(let i=0; i<venvs.length; i++) {
          let venv = venvs[i]
          let parsed = path.parse(venv)
          terminals.push(this.renderShell(filepath, i, 0, {
            icon: "fa-brands fa-python",
            title: "Python virtual environment",
            subtitle: this.kernel.path("api", parsed.name),
            text: `[venv] ${parsed.name}`,
            type: "Start",
            shell: {
              venv: venv,
              input: true,
            }
          }))
        }
      } catch (e) {
        console.log(e)
      }
      terminal = {
        icon: "fa-solid fa-terminal",
        title: "Web Terminal",
        subtitle: "Open the terminal in the browser",
        menu: terminals
      }
    } else {
      terminal = {
        icon: "fa-solid fa-terminal",
        title: "Web terminal",
        subtitle: "Work with the terminal directly in the browser",
        menu: [this.renderShell(filepath, 0, 0, {
          icon: "fa-solid fa-terminal",
          title: "Terminal",
          subtitle: filepath,
          text: `Terminal`,
          type: "Start",
          shell: {
            input: true
          }
        })]
      }
    }
    return terminal
  }
  async getPluginGlobal(req, config, terminal, filepath) {
//    if (!this.kernel.plugin.config) {
//      await this.kernel.plugin.init()
//    }
    if (config) {
      
      let c = structuredClone(config)
      let menu = structuredClone(terminal.menu)
      c.menu = c.menu.concat(menu)
      try {
        let info = new Info(this.kernel)
        info.cwd = () => {
          return filepath
        }
        let menu = c.menu.map((item) => {
          return {
            params: {
              cwd: filepath
            },
            ...item
          }
        })
//        let menu = await this.kernel.plugin.config.menu(this.kernel, info)
        let plugin = { menu }
        let uri = filepath
        await this.renderMenu(req, uri, filepath, plugin, [])

        function setOnlineIfRunning(obj) {
          if (Array.isArray(obj)) {
            for (const item of obj) setOnlineIfRunning(item);
          } else if (obj && typeof obj === 'object') {
            if (obj.running === true) obj.online = true;
            for (const key in obj) setOnlineIfRunning(obj[key]);
          }
        }

        setOnlineIfRunning(plugin)

        return plugin
      } catch (e) {
        console.log("getPlugin ERROR", e)
        return null
      }
    } else {
      return null
    }
  }
  async getPlugin(req, config, name) {
    if (config) {
      let c = structuredClone(config)
      try {
//          let info = new Info(this.kernel)
//          info.caller = () => {
//            return this.kernel.path("api", name, "pinokio.js")
//          }
//          let menu = await this.kernel.plugin.config.menu(this.kernel, info)

        let filepath = this.kernel.path("api", name)
        let terminal = await this.terminals(filepath)
        console.log("TERMINALS", { filepath, terminal })
        c.menu = c.menu.concat(terminal.menu)

        let menu = c.menu.map((item) => {
          return {
            params: {
              //cwd: this.kernel.path("api", name, "pinokio.js")
              cwd: filepath,
            },
            ...item
          }
        })
        let plugin = { menu }
        let uri = this.kernel.path("api")
        await this.renderMenu(req, uri, name, plugin, [])
        return plugin
      } catch (e) {
        console.log("getPlugin ERROR", e)
        return null
      }
    } else {
      return null
    }
  }
  getPeers() {
    let list = []
    for(let key in this.kernel.peer.info) {
      if (key !== this.kernel.peer.host) {
        let info = this.kernel.peer.info[key]
        list.push(info)
      }
    }
    return list
  }
  async check_router_up() {
    // check if caddy is runnign properly
    //    try https://pinokio.localhost
    //    if it works, proceed
    //    if not, redirect
    let https_running = false
    try {
      let res = await axios.get(`http://127.0.0.1:2019/config/`, {
        timeout: 2000
      })
      let test = /pinokio\.localhost/.test(JSON.stringify(res.data))
      if (test) {
        https_running = true
      }
    } catch (e) {
//      console.log(e)
    }
//    console.log({ https_running })
    if (!https_running) {
      return { error: "pinokio.host not yet available" }
    }


    // check if pinokio.localhost router is running
    let router_running = false
    let router = this.kernel.router.published()
    for(let ip in router) {
      let domains = router[ip]
      if (domains.includes("pinokio.localhost")) {
        router_running = true
        break
      }
    }
    if (!router_running) {
      return { error: "pinokio.localhost not yet available" }
    }

    return { success: true }
  }

  async start(options) {
    this.debug = false
    if (options) {
      this.debug = options.debug
      this.browser = options.browser
      this.onrestart = options.onrestart
      this.onquit = options.onquit
    }

    if (this.listening) {
      // stop proxies
      for(let scriptPath in this.kernel.api.proxies) {
        try {
          // Turn off local sharing
          await this.kernel.api.stopProxy({
            script: scriptPath
          })

          // Turn off cloudflare sharing
          await this.kernel.stopCloudflare({
            path: scriptPath
          })
        } catch (e) {
        }
      }
      try {
        await this.httpTerminator.terminate();
      } catch (e) {
      }
//      try {
//        await this.exposeTerminator.terminate();
//      } catch (e) {
//      }
    }

    // configure from kernel.store
    await this.syncConfig()

    try {
      let _home = this.kernel.store.get("home")
      if (_home) {
        await this.startLogging(_home)
      }
    } catch (e) {
      console.log("start logging attempt", e)
    }

    // determine port if port is not passed in

    if (!this.port) {
      this.port = DEFAULT_PORT
//      let platform = os.platform()
//      if (platform === 'linux') {
//        // on linux you are not allowed to listen on ports below 1024
//        this.port = 42000
//      } else {
//        const primary_port = 80
//        const secondary_port = 42000
//        const available = await Util.is_port_available(primary_port)
//        //const running = await Util.is_port_running(primary_port)
////        const running1 = await Util.port_running("localhost", primary_port)
////        const running2 = await Util.port_running("127.0.0.1", primary_port)
////        const running = running1 || running2
////        const available = !running
//        //const available = await portfinder.isAvailablePromise({ host: "0.0.0.0", port: primary_port })
//        console.log("check available", { primary_port, available })
//        if (available) {
//          this.port = primary_port
//        } else {
//          this.port = secondary_port 
//        }
//      }
    }

    let version = this.kernel.store.get("version")
    let home = this.kernel.store.get("home")

    let needInitHome = false
    if (home) {
      if (version === this.version.pinokiod) {
        console.log("version up to date")
      } else {
        // For every update, this gets triggered exactly once.
        // 1. first mkdir if it doesn't exist (this step is irrelevant since at this point the home dir will exist)

        needInitHome = true
        console.log("not up to date. update py.")
        // remove ~/bin/miniconda/py
        let p = path.resolve(home, "bin/py")
        console.log(`[TRY] reset ${p}`)
        await fse.remove(p)
        console.log(`[DONE] reset ${p}`)

        let p2 = path.resolve(home, "prototype/system")
        await fse.remove(p2)

        let p3 = path.resolve(home, "plugin")
        await fse.remove(p3)

        let p4 = path.resolve(home, "network/system")
        await fse.remove(p4)

        let gitconfig = path.resolve(home, "gitconfig")
        await fse.remove(gitconfig)
        await fs.promises.copyFile(
          path.resolve(__dirname, "..", "kernel", "gitconfig_template"),
          gitconfig
        )

        let prototype_path = path.resolve(home, "prototype")
        await fse.remove(prototype_path)
        

        console.log("[TRY] Updating to the new version")
        this.kernel.store.set("version", this.version.pinokiod)
        console.log("[DONE] Updating to the new version")


      }
    }
    // initialize kernel


    await this.kernel.init({ port: this.port})
    this.kernel.peer.start(this.kernel)


    if (needInitHome) {
      await this.kernel.initHome()
    }

    if (this.kernel.homedir) {
      let ex = await this.kernel.exists(this.kernel.homedir, "ENVIRONMENT")
      if (!ex) {
        let str = await Environment.ENV("system", this.kernel.homedir)
        await fs.promises.writeFile(path.resolve(this.kernel.homedir, "ENVIRONMENT"), str)
      }
    }



    // start proxy for Pinokio itself
//    await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/")

//    if (!debug) {
//      let logsdir = path.resolve(this.kernel.homedir, "logs")
//      await fs.promises.mkdir(logsdir, { recursive: true }).catch((e) => { })
//      if (!this.log) {
//        this.log = fs.createWriteStream(path.resolve(this.kernel.homedir, "logs/stdout.txt"))
//        process.stdout.write = process.stderr.write = this.log.write.bind(this.log)
//        process.on('uncaughtException', (err) => {
//          console.error((err && err.stack) ? err.stack : err);
//        });
//      }
//    }



//    await this.startLogging()

//    // check version from this.store
//    //let version = this.kernel.store.get("version")
//    // if the version is different from package.json version, run update logic
//    console.log({_homedir: this.kernel.homedir, version, pinokiod: this.version.pinokiod })
//    if (this.kernel.homedir) {
//      if (version === this.version.pinokiod) {
//        console.log("version up to date")
//      } else {
//      // update the py module if it's already installed
//        console.log("not up to date")
//
////        // give full permission to pinokio folder on windows
////        if (this.kernel.platform === "win32") {
////          console.log("1 Give full permission")
////          await this.kernel.bin.exec({
////            sudo: true,
////            message: `icacls ${this.kernel.homedir} /grant Users:(OI)(CI)F /T`
////          }, (stream) => {
////            console.log({ stream })
////          })
////          console.log("1 Give full permission done")
////        }
//
//
//        await new Promise((resolve, reject) => {
//          let interval = setInterval(async () => {
//            console.log("checking mod.py")
//            if (this.kernel.bin.mod && this.kernel.bin.mod.py) {
//              console.log("mod.py initialized!")
//              let installed = await this.kernel.bin.mod.py.installed()
//              console.log("py installed", installed)
//              if (installed) {
//                // update
//                console.log("update py")
//                await this.kernel.exec({
//                  message: "git pull",
//                  path: this.kernel.path("bin/py")
//                }, (e) => {
//                  console.log(e)
//                })
//              }
//              // after updating, set the version
//              console.log("set the version", this.version.pinokiod)
//              this.kernel.store.set("version", this.version.pinokiod)
//              console.log("RESTART")
//              clearInterval(interval)
//              resolve()
//            } else {
//              console.log("mod.py not initialized yet")
//            }
//          }, 1000)
//        })
//        this.listening = true   // set this.listening = true so all http connections get reset when restarting
//        await this.start(options)
//        console.log("RESTARTED")
//        return
//      }
//    }

    

    //await this.configure()

    this.started = false
    this.app = express();
    this.app.use(cors({
      origin: '*'
    }));

    if (this.kernel.homedir) {
      this.app.use(express.static(this.kernel.path("web/public")))
      this.app.use('/prototype', express.static(this.kernel.path("prototype")))
    }
    this.app.use(express.static(path.resolve(__dirname, 'public')));
    this.app.use("/web", express.static(path.resolve(__dirname, "..", "..", "web")))
    this.app.set('view engine', 'ejs');
    if (this.kernel.homedir) {
      this.app.set("views", [
        this.kernel.path("web/views"),
        path.resolve(__dirname, "views")
      ])
    } else {
      this.app.set("views", [
        path.resolve(__dirname, "views")
      ])
    }
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(session({secret: "secret" }))
    this.app.use((req, res, next) => {
      const originalRedirect = res.redirect;
      res.redirect = function (url) {
        console.log(`Redirect triggered: ${req.method} ${req.originalUrl} -> ${url}`);
        return originalRedirect.call(this, url);
      };
      next();
    });
    this.app.use((req, res, next) => {
      let protocol = req.get('X-Forwarded-Proto') || "http"
      req.$source = {
        protocol,
        host: req.get("host")
      }
      next()
    })


    //let home = this.kernel.homedir
    //let home = this.kernel.store.get("home")
    this.app.get("/launch", ex(async (req, res) => {
      // parse the url
      /*
      is it https://<name>.localhost ?
        - is <name> already installed?
          - yes: display
          - no: 404
      else: 404
      */
      let url = req.query.url
      let u = new URL(url)
      let host = u.host
      let env = await Environment.get(this.kernel.homedir)
      let autolaunch = false
      if (env && env.PINOKIO_ONDEMAND_AUTOLAUNCH === "1") {
        autolaunch = true
      }
      let chunks = host.split(".")
      console.log("GET /launch", { url, host, chunks })
      if (chunks[chunks.length-1] === "localhost") {
        // if <...>.<kernel.peer.name>.localhost
        let nameChunks


        // if <app_name>.<host_name>.localhost
        // if <app_name>.localhost
        // otherwise => redirect


        if (chunks.length > 2) {

          let apipath = this.kernel.path("api")
          let files = await fs.promises.readdir(apipath, { withFileTypes: true })
          let folders = files.filter((f) => {
            return f.isDirectory()
          }).map((x) => {
            return x.name
          })

          console.log({ folders })
            

          let matched = false
          for(let folder of folders) {
            let pattern1 = `${folder}.${this.kernel.peer.name}.localhost`
            let pattern2 = `${folder}.localhost`
            console.log("checking", { pattern1, pattern2, chunks: chunks.join(".") })
            if (pattern1 === chunks.join(".")) {
              matched = true
              nameChunks = chunks.slice(0, -2)
              break
            } else if (pattern2 === chunks.join(".")) {
              matched = true
              nameChunks = chunks.slice(0, -1)
              break
            }
          }
          if (!matched) {
            let peer_names = Array.from(this.kernel.peer.peers).filter((host) => {
              return host !== this.kernel.peer.host
            }).map((host) => {
              return this.kernel.peer.info[host].name
            })

            // look for any matching peer names
            // if exists, redirect to that host
            for(let name of peer_names) {
              console.log({ host, name })
              if (host.endsWith(`.${name}.localhost`)) {
                console.log("matched. redirecting")
                res.redirect(`https://pinokio.${name}.localhost/launch?url=${url}`)
                return
              }
            }
          }
        } else {
          console.log("> 3")
          nameChunks = chunks
        }
        let name = nameChunks.join(".")
        console.log({ nameChunks, chunks, name })
        let api_path = this.kernel.path("api", name)
        let exists = await this.exists(api_path)
        if (exists) {
          let meta = await this.kernel.api.meta(name)
          res.render("start", {
            autolaunch,
            logo: this.logo,
            theme: this.theme,
            agent: this.agent,
            name: meta.title,
            image: meta.icon,
            link: `/p/${name}?autolaunch=${autolaunch ? "1" : "0"}`,
          })
          return
        }
      }
      res.render("start", {
        autolaunch,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        name: "Does not exist",
        image: "/pinokio-black.png",
        link: null
      })
    }))
    this.app.get("/", ex(async (req, res) => {
      // check bin folder
//      let bin_path = this.kernel.path("bin/miniconda")
//      let bin_exists = await this.exists(bin_path)
//      if (!bin_exists) {
//        res.redirect("/setup")
//        return
//      }
      
//      if (!this.kernel.proto.config) {
//        await this.kernel.proto.init()
//      }
      if (!this.kernel.plugin.config) {
        await this.kernel.plugin.init()
      }

      if (req.query.mode !== "settings" && !home) {
        res.redirect("/?mode=settings")
        return
      }
      if (req.query.mode === "help") {
        let folders = {}
        if (this.kernel.homedir) {
          folders = {
            bin: path.resolve(this.kernel.homedir, "bin"),
            cache: path.resolve(this.kernel.homedir, "cache"),
            drive: path.resolve(this.kernel.homedir, "drive"),
          }
        }
        res.render("help", {
          version: this.version,
          logo: this.logo,
          theme: this.theme,
          agent: this.agent,
          ...folders
        })
        return
      }


      if (req.query.mode === 'settings') {

        let platform = os.platform()
        let _home
        if (platform === "win32") {
          _home = path.resolve(path.parse(os.homedir()).root, "pinokio");
        } else {
          _home = path.resolve(os.homedir(), "pinokio")
        }
        let system_env = {}
        if (this.kernel.homedir) {
          system_env = await Environment.get(this.kernel.homedir)
        }
        let configArray = [{
          key: "home",
          description: [
            "* NO white spaces (' ')",
            "* NO exFAT drives",
          ],
          val: this.kernel.homedir ? this.kernel.homedir : _home,
          placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
//        }, {
//          key: "drive",
//          val: path.resolve(this.kernel.homedir, "drive"),
//          description: ["Virtual drive folder (Don't change it unless you know what you're doing)"],
//          placeholder: "Pinokio virtual drives folder"
        }, {
          key: "theme",
          val: this.theme,
          options: ["light", "dark"]
        }, {
          key: "mode",
          val: this.mode,
          options: ["desktop", "background"]
        }, {
          key: "HTTP_PROXY",
          val: (system_env.HTTP_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }, {
          key: "HTTPS_PROXY",
          val: (system_env.HTTPS_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }, {
          key: "NO_PROXY",
          val: (system_env.NO_PROXY || ""),
          show_on_click: "#proxy",
          placeholder: "(Advanced) Only set if you are behind a proxy"
        }]
        let folders = {}
        if (this.kernel.homedir) {
          folders = {
            bin: path.resolve(this.kernel.homedir, "bin"),
            cache: path.resolve(this.kernel.homedir, "cache"),
            env: path.resolve(this.kernel.homedir, "ENVIRONMENT"),
            drive: path.resolve(this.kernel.homedir, "drive"),
          }
        }
        let list = this.getPeers()
        res.render("settings", {
          current_host: this.kernel.peer.host,
          list,
          platform,
          version: this.version,
          portal: this.portal,
          logo: this.logo,
          theme: this.theme,
          agent: this.agent,
          paths: [],
          config: configArray,
          query: req.query,
          ...folders
        })

        return
      }

      let apipath = this.kernel.path("api")
      let files = await fs.promises.readdir(apipath, { withFileTypes: true })
      let folders = files.filter((f) => {
        return f.isDirectory()
      }).map((x) => {
        return x.name
      })
      let meta = {}
      for(let folder of folders) {
        meta[folder] = await this.kernel.api.meta(folder)
//        let p = path.resolve(apipath, folder, "pinokio.js")
//        let pinokio = (await this.kernel.loader.load(p)).resolved
//        let p2 = path.resolve(apipath, folder, "pinokio_meta.json")
//        let pinokio2 = (await this.kernel.loader.load(p2)).resolved
//
//        meta[folder] = Object.assign({}, pinokio, pinokio2)
//        meta[folder].iconpath = meta[folder].icon ? path.resolve(apipath, folder, meta[folder].icon) : null
//        meta[folder].icon = meta[folder].icon ? `/api/${folder}/${meta[folder].icon}?raw=true` : null
//        meta[folder].path = path.resolve(apipath, folder)


//        if (pinokio) {
//          meta[folder] = {
//            title: pinokio.title,
//            description: pinokio.description,
//            icon: pinokio.icon ? `/api/${folder}/${pinokio.icon}?raw=true` : null
//          }
//        }
//        if (pinokio2) {
//          if (pinokio2.title) meta[folder].title = pinokio2.title
//          if (pinokio2.description) meta[folder].description = pinokio2.description
//          if (pinokio2.icon) meta[folder].icon = pinokio2.icon
//        }
      }
      await this.render(req, res, [], meta)
//      if (this.kernel.bin.all_installed) {
//        this.started = true
//        let apipath = this.kernel.path("api")
//        let files = await fs.promises.readdir(apipath, { withFileTypes: true })
//        let folders = files.filter((f) => {
//          return f.isDirectory()
//        }).map((x) => {
//          return x.name
//        })
//        let meta = {}
//        for(let folder of folders) {
//          let p = path.resolve(apipath, folder, "pinokio.js")
//          let pinokio = (await this.kernel.loader.load(p)).resolved
//          if (pinokio) {
//            meta[folder] = {
//              title: pinokio.title,
//              description: pinokio.description,
//              icon: pinokio.icon ? `/api/${folder}/${pinokio.icon}?raw=true` : null
//            }
//          }
//        }
//        await this.render(req, res, [], meta)
//      } else {
//        // get all the "start" scripts from pinokio.json
//        // render installer page
//        this.started = true
//        let home = this.kernel.homedir ? this.kernel.homedir : path.resolve(os.homedir(), "pinokio")
//        res.render("bootstrap", {
//          home,
//          agent: this.agent,
//        })
//      }
    }))

//    this.app.get("/init/:name", ex(async (req, res) => {
//      console.log("Rnder init", req.params.name)
    this.app.get("/init", ex(async (req, res) => {
      /*
        option 1: new vs. clone
        - new|clone
        
        option 2: type
          - empty
          - cli app
          - documentation
          - nodejs project
          - python project
            - gradio + torch

        option 3: ai vs. empty
          - prompt

      */

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }

//      console.log("this.kernel.proto.init")
//      await this.kernel.proto.init()
      //let list = this.getPeerInfo()
      let list = this.getPeers()
      let ai = await this.kernel.proto.ai()
      ai = [{
        title: "Use your own AI recipe",
        description: "Enter your own markdown instruction for AI",
        placeholder: "(example: 'build a launcher for https://github.com/comfyanonymous/ComfyUI)",
        meta: {},
        content: ""
      }].concat(ai)
      res.render("init/index", {
        list,
        ai,
        current_host: this.kernel.peer.host,
        cwd: this.kernel.path("api"),
        name: null,
//        name: req.params.name,
        portal: this.portal,
//        items,
        logo: this.logo,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: this.agent,
        kernel: this.kernel,
      })
      /*
      let config = structuredClone(this.kernel.proto.config)
      console.log(config)
      config = this.renderMenu2(config, {
        cwd: req.query.path,
        href: "/prototype/show",
        path: this.kernel.path("prototype/system"),
        web_path: "/asset/prototype/system"
      })
      res.render("prototype/index", {
        config,
        path: req.query.path,
        portal: this.portal,
//        items,
        logo: this.logo,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: this.agent,
        kernel: this.kernel,
      })
      */
    }))
    this.app.get("/check_router_up", ex(async (req, res) => {
      let response = await this.check_router_up()
      res.json(response)
    }))

    /*
    GET /connect => display connection options
    - github
    - x
    */
    this.app.get("/connect", ex(async (req, res) => {
      let list = this.getPeers()
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let items = [{
        icon: "fa-brands fa-square-x-twitter",
        name: "x",
        title: "x.com",
        description: "Connect with X.com",
        url: "/connect/x"
      }, {
        emoji: "🤗",
        name: "huggingface",
        title: "huggingface.co",
        description: "Connect with huggingface.co",
        url: "/connect/huggingface"
      }, {
        icon: "fa-brands fa-github",
        name: "github",
        title: "github.com",
        description: "Connect with GitHub.com",
        url: "/github"
      }]
      let github_hosts = await this.get_github_hosts()
      for(let i=0; i<items.length; i++) {
        try {
          if (items[i].name === "github") {
            if (github_hosts.length > 0) {
              items[i].profile = {
                icon: "fa-brands fa-github",
                items: [{
                  key: "config",
                  val: github_hosts
                }]
              }
              items[i].description = `<i class="fa-solid fa-circle-check"></i> Connected with ${items[i].title}`
              items[i].connected = true
            }
          } else {
            const config = this.kernel.connect.config[items[i].name]
            if (config) {
              let profile = await this.kernel.connect.profile(items[i].name)
              if (profile) {
                items[i].profile = profile 
                items[i].description = `<i class="fa-solid fa-circle-check"></i> Connected with ${items[i].title}`
                items[i].connected = true
              }
            }
          }
        } catch (e) {
        }
      }
      res.render(`connect`, {
        current_urls,
        current_host: this.kernel.peer.host,
        list,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        items,
      })
    }))
    /*
    *  GET /connect/x
    *  GET /connect/discord
    */
    this.app.get("/connect/:provider", ex(async (req, res) => {

      // check if all the connect related modules are installed
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("connect"),
      })
      if (!requirements_pending && install_required) {
        console.log("REDIRECT", req.params.provider)
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }

      let https_running = false
      try {
        let res = await axios.get(`http://127.0.0.1:2019/config/`, {
          timeout: 2000
        })
        let test = /pinokio\.localhost/.test(JSON.stringify(res.data))
        if (test) {
          https_running = true
        }
      } catch (e) {
        console.log(e)
      }
      console.log({ https_running })
      if (!https_running) {
//        res.json({ error: "pinokio.host not yet available" })
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }


      // check if pinokio.localhost router is running
      let router_running = false
      let router = this.kernel.router.published()
      for(let ip in router) {
        let domains = router[ip]
        if (domains.includes("pinokio.localhost")) {
          router_running = true
          break
        }
      }
      console.log({ router_running })
      if (!router_running) {
//        res.json({ error: "pinokio.localhost not yet available" })
        res.redirect("/setup/connect?callback=/connect/" + req.params.provider)
        return
      }


      let readme = ""
      let id = ""
      try {
        readme = await this.kernel.connect[req.params.provider].readme()
        id = this.kernel.connect[req.params.provider].id
      } catch (e) {
      }
      //res.render(`connect/${req.params.provider}`, {
      const config = this.kernel.connect.config[req.params.provider]
      console.log("CONFIG", config)
      res.render(`connect/index`, {
        protocol: req.$source.protocol,
        name: req.params.provider,
        config,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        id,
        readme
      })
    }))

    this.app.get("/connect/:provider/profile", ex(async (req, res) => {
      let response = await this.kernel.connect.profile(req.params.provider, req.body)
      res.send(response)
    }))
    /*
    *  POST /connect/x/login    => login and acquire auth token
    *  POST /connect/x/logout   => loout
    *  POST /connect/x/keys     => return the up-to-date token
    *  POST /connect/x/api      => make request
    *
    */
    this.app.post("/connect/:provider/login", ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.login(req.params.provider, req.body)
        res.json(response)
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/logout", ex(async (req, res) => {
      try {
        await this.kernel.connect.logout(req.params.provider, req.body)
        res.json({ success: true })
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/keys", ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.keys(req.params.provider)
        res.json(response)
      } catch (e) {
        res.json({ error: e.message })
      }
    }))
    this.app.post("/connect/:provider/api/:method", this.upload.any(), ex(async (req, res) => {
      try {
        let response = await this.kernel.connect.request(req.params.provider, req.params.method, req)
        res.json(response)
      } catch (e) {
        console.log("ERROR", e)
        res.json({ error: e.message })
      }
    }))
    this.app.post("/clipboard", ex(async (req, res) => {
      try {
        let r = await Util.clipboard(req.body)
        if (r) {
          res.json({ text: r })
        } else {
          res.json({ success: true })
        }
      } catch (e) {
        res.json({ error: e.stack })
      }
    }))
    this.app.post("/push", ex(async (req, res) => {
      console.log("Push", req.body)
      try {
        Util.push(req.body)
        res.json({ success: true })
      } catch (e) {
        res.json({ error: e.stack })
      }
    }))
    this.app.post("/runcmd", ex(async (req, res) => {
      //Util.openfs(req.body.path, req.body.mode)
      let cwd = req.body.cwd
      let cmd = req.body.run
      Util.run(cmd, cwd, this.kernel)
      res.json({ success: true })
    }))
    this.app.post("/go", ex(async (req, res) => {
      console.log("GO", req.body)
      Util.openURL(req.body.url)
      res.json({ success: true })
    }))
    this.app.post("/openfs", ex(async (req, res) => {
      //Util.openfs(req.body.path, req.body.mode)
      Util.openfs(req.body.path, req.body, this.kernel)
      res.json({ success: true })
    }))
    this.app.post("/keys", ex(async (req, res) => {
      let p = this.kernel.path("key.json")
      let keys  = (await this.kernel.loader.load(p)).resolved
      console.log("update", req.body)
      for(let host in req.body) {
        let updated = req.body[host]
        for(let indexStr in updated) {
          let index = parseInt(indexStr)
          keys[host][index] = updated[indexStr]
        }
      }
      await fs.promises.writeFile(p, JSON.stringify(keys, null, 2))
      res.json({ success: true })
    }))
    this.app.get("/keys", ex(async (req, res) => {
      let p = this.kernel.path("key.json")
      let keys  = (await this.kernel.loader.load(p)).resolved
      let items = []
      if (keys) {
        let sorted_keys = Object.keys(keys)
        sorted_keys.sort((a, b) => { return a > b })
        for(let key of sorted_keys) {
          items.push({
            host: key,
            vals: keys[key]
          })
        }
      }
      res.render("keys", {
        filepath: p,
        theme: this.theme,
        agent: this.agent,
        items
      })
    }))
    this.app.get("/docs", ex(async (req, res) => {
      let url = req.query.url
      const possiblePaths = [
        '/openapi.json',
        '/swagger.json',
        '/v1/openapi.json',
        '/v1/swagger.json',
        '/docs/openapi.json',
        '/api-docs',
        '/api-docs.json',
      ];
      let selected = null
      if (req.query.url) {
        const localHosts = ['localhost', '127.0.0.1', '::1'];
        const urlObj = new URL(req.query.url)
        const baseOrigins = [urlObj.origin];
        if (urlObj.hostname === 'localhost' || urlObj.hostname === '::1' || urlObj.hostname.startsWith('127.')) {
          for (const host of localHosts) {
            const origin = urlObj.origin.replace(urlObj.hostname, host);
            if (!baseOrigins.includes(origin)) {
              baseOrigins.push(origin);
            }
          }
        }

        for (const origin of baseOrigins) {
          for (const possiblePath of possiblePaths) {
            try {
              const url = new URL(possiblePath, origin).href;
              const res = await axios.get(url, { timeout: 500 });
              const contentType = res.headers['content-type'];
              if (contentType?.includes('application/json')) {
                const json = res.data;
                if (json.openapi || json.swagger) {
                  selected = json
                  break
                }
              }
            } catch (e) {
              console.log("error", e)
              // ignore errors
            }
          }
          if (selected) break
        }
      }
      let type = "redoc" // "swaggerui"
      if (req.query.type) {
        type = req.query.type
      }
      if (selected) {
        res.render(type, {
          spec: JSON.stringify(selected)
        })
      } else {
        res.render(type, {
          spec: null
        })
      }
    }))
    this.app.get("/github", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("connect"),
      })
      if (!requirements_pending && install_required) {
        res.redirect("/setup/connect?callback=/github")
        return
      }
      let md = await fs.promises.readFile(path.resolve(__dirname, "..", "kernel/connect/providers/github/README.md"), "utf8")
      let readme = marked.parse(md)

      let hosts = await this.get_github_hosts()

      console.log("hosts", hosts)

      let items
      if (hosts.length > 0) {
        // logged in => display logout
        items = [{
          icon: "fa-solid fa-circle-xmark",
          title: "Logout",
          description: "Log out of Github",
          url: "/github/logout"
        }]
      } else {
        // logged out => display login
        items = [{
          icon: "fa-solid fa-key",
          title: "Login",
          description: "Log into Github",
          url: "/github/login"
        }]
      }

      const gitConfigPath = this.kernel.path("gitconfig")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      res.render("github", {
        gitconfig,
        hosts,
        readme,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        items
//        items: [{
//          icon: "fa-solid fa-key",
//          title: "Login",
//          description: "Log into Github",
//          url: "/github/login"
////        }, {
////          icon: "fa-solid fa-check",
////          title: "Status",
////          description: "Check Github login status",
////          url: "/github/status"
//        }, {
//          icon: "fa-solid fa-circle-xmark",
//          title: "Logout",
//          description: "Log out of Github",
//          url: "/github/logout"
//        }]
      })
    }))
    this.app.post("/github/config", ex(async (req, res) => {
      const gitConfigPath = this.kernel.path("gitconfig")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      function set(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i];
          if (!(k in current) || typeof current[k] !== 'object') {
            current[k] = {};
          }
          current = current[k];
        }
        current[keys[keys.length - 1]] = value;
      }
      for(let key in req.body) {
        set(gitconfig, key, req.body[key])
      }
      let text = ini.stringify(gitconfig)
      await fs.promises.writeFile(gitConfigPath, text)
      res.json({ success: true })

    }))
    this.app.get("/github/status", ex(async (req, res) => {
      let id = "gh_status"
      let params = new URLSearchParams()
      let message = "gh auth status"
      params.set("message", encodeURIComponent(message))
      params.set("path", this.kernel.homedir)
//      params.set("kill", "/Logged in/i")
      params.set("kill_message", "Click to return home")
      params.set("callback", encodeURIComponent("/github"))
      params.set("target", "_top")
      params.set("id", id)
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/github/logout", ex(async (req, res) => {
      let id = "gh_logout"
      let params = new URLSearchParams()
      let message = "gh auth logout"
      params.set("message", encodeURIComponent(message))
      params.set("path", this.kernel.homedir)
//      params.set("kill", "/Logged in/i")
//      params.set("kill_message", "Click to return home")
      params.set("callback", encodeURIComponent("/github"))
      params.set("id", id)
      params.set("target", "_top")
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/github/login", ex(async (req, res) => {
      let id = "gh_login"
      let params = new URLSearchParams()
      let delimiter
      if (this.kernel.platform === "win32") {
        delimiter = " && "; // must use &&. & doesn't necessariliy wait until the curruent command finishes
      } else {
        delimiter = " ; ";
      }
      let message = [
        "gh auth setup-git --hostname github.com --force",
        "gh auth login --web --git-protocol https"
      ].join(delimiter)
      params.set("message", encodeURIComponent(message))
      params.set("input", true)
      params.set("path", this.kernel.homedir)
      params.set("kill", "/Logged in/i")
//      params.set("kill_message", "Your Github account is now connected.")
      params.set("callback", encodeURIComponent("/github"))
      params.set("id", id)
      params.set("target", "_top")
      let url = `/shell/${id}?${params.toString()}`
      res.redirect(url)
    }))
    this.app.get("/shell/:id", ex(async (req, res) => {
      /*
        req.query := {
          path (required),    // api, bin, prototype, network, api/
          message (optional), // if not specified, start an empty shell
          venv,
          callback,
          kill,               // regex for killing
          on.<regex1>: <key>,
          on.<regex2>: <key>,
          env.<key1>,
          env.<key2>,
          ...
        }
      */

      // create a new term from cwd

      /*
      GET /shell/:unix_path => shell id: 'shell/:unix_path'
      */

      let id = "shell/" + decodeURIComponent(req.params.id)
      let target = req.query.target ? req.query.target : null
      let cwd = this.kernel.path(this.kernel.api.filePath(decodeURIComponent(req.query.path)))
      let message = req.query.message ? decodeURIComponent(req.query.message) : null
      //let message = req.query.message ? req.query.message : null
      let venv = req.query.venv ? decodeURIComponent(req.query.venv) : null
      let input = req.query.input ? true : false
      let callback = req.query.callback ? decodeURIComponent(req.query.callback) : null
      let callback_target = req.query.callback_target ? decodeURIComponent(req.query.callback_target) : null
      let kill_message = req.query.kill_message ? decodeURIComponent(req.query.kill_message) : null
      let done_message = req.query.done_message ? decodeURIComponent(req.query.done_message) : null
      let kill = req.query.kill ? decodeURIComponent(req.query.kill) : null
      let done = req.query.done ? decodeURIComponent(req.query.done) : null
      let env = {}
      for(let env_key in req.query) {
        if (env_key.startsWith("env.")) {
          let chunks = env_key.split(".")
          let key = chunks.slice(1).join(".")
          env[key] = req.query[env_key]
        }
      }
      let conda = {}
      let conda_exists = false
      for(let conda_key in req.query) {
        if (conda_key.startsWith("conda.")) {
          let chunks = conda_key.split(".")
          let key = chunks.slice(1).join(".")
          conda[key] = req.query[conda_key]
          conda_exists = true
        }
      }
//      let pattern = {}
//      for(let pattern_key in req.query) {
//        if (pattern_key.startsWith("pattern.")) {
//          let chunks = pattern_key.split(".")
//          let key = chunks.slice(1).join(".")
//          pattern[key] = req.query[pattern_key]
//        }
//      }

      let shell = this.kernel.shell.get(id)
      res.render("shell", {
        target,
        filepath: cwd,
        theme: this.theme,
        agent: this.agent,
        id,
        cwd,
        message,
        venv,
        conda: (conda_exists ? conda: null),
        env,
//        pattern,
        input,
        kill,
        kill_message,
        done,
        done_message,
        callback,
        callback_target,
        running: (shell ? true : false)
      })
    }))
//    this.app.get("/terminal/:api/:id", ex(async (req, res) => {
//      res.render("shell", {
//        theme: this.theme,
//        agent: this.agent,
//        cwd: this.kernel.path("api/" + req.params.api),
//        id: req.params.id
//      })
//    }))
    this.app.get("/peer_check", ex(async (req, res) => {
      if (this.kernel.peer.refreshing) {
        res.json({ updated: false })
      } else {
        let list = this.getPeerInfo()
        if (JSON.stringify(this.last_list) !== JSON.stringify(list)) {
          this.last_list = list
          res.json({ updated: true })
        } else {
          res.json({ updated: false })
        }
      }
    }))
    this.app.get("/setup", ex(async (req, res) => {
      let items = []
      for(let id in Setup) {
        let item = Setup[id](this.kernel)
        items.push({
          id,
          ...item
        })
      }
      res.render("setup_home", {
        filepath: path.resolve(this.kernel.homedir, "api"),
        items,
        portal: this.portal,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
      })
    }))
    this.app.get("/setup/:mode", ex(async (req, res) => {
      /*
      1. mode:ai => all
      2. mode:coding => conda, nodejs, git
      3. mode:network => conda, git, caddy
      4. mode:connect => conda, git, caddy
      */

      let bin = this.kernel.bin.preset(req.params.mode)

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin
      })
      // set dependencies for conda
      let cr = new Set()
      for(let i=0; i<requirements.length; i++) {
        let r = requirements[i]
        if (r.name === "conda") {
          requirements[i].dependencies = bin.conda_requirements
          if (bin.conda_requirements) {
            for(let r of bin.conda_requirements) {
              cr.add(r)
            }
          }
        }
      }

      // if the setup mode includes caddy, wait
      let wait = null
      if (cr.has("caddy")) {
        wait = "caddy"
      }
      console.log({ wait, cr })

      let current = req.query.callback || req.originalUrl

//      console.log("2", { requirements_pending, install_required })
//      if (!requirements_pending && !install_required) {
//        console.log("redirect", current)
//        res.redirect(current)
//        return
//      }
//
      res.render("setup", {
        wait,
        error,
        current,
        install_required,
        requirements,
        requirements_pending,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
      })
    }))
    this.app.post("/plugin/update_spec", ex(async (req, res) => {
      try {
        let filepath = req.body.filepath
        let content = req.body.spec
        let spec_path = path.resolve(filepath, "SPEC.md")
        await fs.promises.writeFile(spec_path, content)
        res.json({
          success: true
        })
      } catch (e) {
        res.error({
          error: e.stack
        })
      }
    }))
    this.app.post("/plugin/update", ex(async (req, res) => {
      console.time("/plugin/update")
      try {
        await this.kernel.exec({
          message: "git pull",
          path: this.kernel.path("plugin/code")
        }, (e) => {
          console.log(e)
        })
        console.timeEnd("/plugin/update")
        res.json({
          success: true
        })
      } catch (e) {
        res.json({
          error: e.stack
        })
      }
    }))
    this.app.post("/network/reset", ex(async (req, res) => {
      let caddy_path = this.kernel.path("cache/XDG_DATA_HOME/caddy")
      await rimraf(caddy_path)
      let caddy_path2 = this.kernel.path("cache/XDG_CONFIG_HOME/caddy")
      await rimraf(caddy_path2)

      let custom_network_path = path.resolve(home, "network/system")
      await fse.remove(custom_network_path)

      res.json({ success: true })
    }))
    this.app.get("/requirements_check/:name", ex(async (req, res) => {
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset(req.params.name)
      })
      res.json({
        requirements,
        install_required,
        requirements_pending,
      })
    }))
    this.app.get("/net/:name", ex(async (req, res) => {
      let protocol = req.get('X-Forwarded-Proto') || "http"
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("network"),
      })

      if (!requirements_pending && install_required) {
        console.log("redirect to /setup/network")
        res.redirect("/setup/network?callback=/network")
        return
      }

      await this.kernel.peer.check_peers()

      let list = this.getPeers()

//      let list = this.getPeerInfo()
      let processes = []
      let host
      let peer
      for(let item of list) {
        if (item.name === req.params.name) {
          processes = item.processes
          host = item.host
          peer = item
        }
      }
      try {
        processes = this.kernel.peer.info[host].router_info
        for(let i=0; i<processes.length; i++) {
          if (!processes[i].icon) {
            if (protocol === "https") {
              processes[i].icon = processes[i].https_icon
            } else {
              // http
              processes[i].icon = processes[i].http_icon
            }
          }
        }
      } catch (e) {
      }

      let installed = this.kernel.peer.info[host].installed
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      res.render("net", {
        selected_name: req.params.name,
        current_urls,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        agent: this.agent,
        theme: this.theme,
        processes,
        installed,
        error: null,
        list,
        host,
        peer,
        protocol,
        current_host: this.kernel.peer.host,
      })
    }))
    this.app.get("/network", ex(async (req, res) => {
      let protocol = req.get('X-Forwarded-Proto')
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("network"),
      })

      if (!requirements_pending && install_required) {
        console.log("redirect to /setup/network")
        res.redirect("/setup/network?callback=/network")
        return
      }


//      let list = this.getPeerInfo()
//      console.log("peeerInfo", JSON.stringify(list, null, 2))
      await this.kernel.peer.check_peers()


      let peers = []
      for(let host in this.kernel.peer.info) {
        let peer_info = this.kernel.peer.info[host]
        peers.push({
          host,
          name: peer_info.name,
          domain: `https://pinokio.${peer_info.name}.localhost`,
          router: `https://pinokio.${peer_info.name}.localhost/proxy`
        })
      }

//      if (peers.length === 0) {
//        console.log("network not yet ready")
//        res.redirect("/")
//        return
//      }


      let live_proxies = this.kernel.api.proxies["/proxy"]
      if (!live_proxies) live_proxies = []
      let proxies = []
//      let proxies = [{
//        icon: "ollama.webp",
//        name: "Ollama",
//        target: 'http://127.0.0.1:11434',
//        port: 44002
//      }, {
//        icon: "lmstudio.jpg",
//        name: "LMStudio",
//        target: 'http://127.0.0.1:1234',
//        port: 44003
//      }]
      for(let i=0; i<proxies.length; i++) {
        proxies[i].running = false
        for(let live_proxy of live_proxies) {
          if (live_proxy.name === proxies[i].name) {
            proxies[i].running = true 
            proxies[i].proxy = live_proxy.proxy
            proxies[i].qr = await QRCode.toDataURL(live_proxy.proxy)
          }
        }
      }

      let pinokio_proxy = this.kernel.api.proxies["/"]
      let pinokio_cloudflare = this.cloudflare_pub

      let qr = null
      let qr_cloudflare = null
      let home_proxy = null
      if (pinokio_proxy && pinokio_proxy.length > 0) {
        qr = await QRCode.toDataURL(pinokio_proxy[0].proxy)
        home_proxy = pinokio_proxy[0]
      }

      let icon
      if (this.theme === "dark") {
        icon = "pinokio-white.png"
      } else {
        icon = "pinokio-black.png"
      }


      // App sharing
      let apipath = this.kernel.path("api")
      let files = await fs.promises.readdir(apipath, { withFileTypes: true })
      let folders = files.filter((f) => {
        return f.isDirectory()
      }).map((x) => {
        return x.name
      })
      let apps = []
      for(let folder of folders) {
        let meta = await this.kernel.api.meta(folder)
//        meta.link = `/pinokio/browser/${folder}/browse#n1`,
//        meta.icon = meta.icon ? `/api/${folder}/${meta.icon}?raw=true` : null
//        meta.name = meta.title
        apps.push(meta)
      }


      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let current_peer = this.kernel.peer.info ? this.kernel.peer.info[this.kernel.peer.host] : null
      let host = null
      if (current_peer) {
        host = current_peer.host
      }
      let peer = current_peer

      let processes = []
      try {
        processes = current_peer.router_info
        for(let i=0; i<processes.length; i++) {
          if (!processes[i].icon) {
            if (protocol === "https") {
              processes[i].icon = processes[i].https_icon
            } else {
              // http
              processes[i].icon = processes[i].http_icon
            }
          }
        }
      } catch (e) {
        console.log("ERROR", e)
      }

  //      let processes = current_peer.processes

      let favicons = {}
      let titles = {}
      let descriptions = {}


      let list = this.getPeers()
      let installed = this.kernel.peer.info && this.kernel.peer.info[host] ? this.kernel.peer.info[host].installed : []
      res.render("network", {

        host,
        favicons,
        titles,
        descriptions,
        processes,
        installed,
        error: null,


        current_urls,
        requirements_pending,
        install_required,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        current_host: this.kernel.peer.host,
        peers,
        list,
        name: this.kernel.peer.name,
        https_active: this.kernel.router.active,
        peer_active: this.kernel.peer.active,
        port_mapping: this.kernel.router.port_mapping,
//        port_mapping: this.kernel.caddy.port_mapping,
//        ip_mapping: this.kernel.caddy.ip_mapping,
        lan: this.kernel.router.local_network_mapping,
        agent: this.agent,
        theme: this.theme,
        items: proxies,
        qr,
        proxy: home_proxy,
        localhost: `http://localhost:${this.port}`,
        icon,
        apps
      })
    }))
    this.app.get("/getlog", ex(async (req, res) => {
      let str = await fs.promises.readFile(req.query.logpath, "utf8")
      res.send(str)
    }))
    this.app.get("/state/:type/:name", ex(async (req,res) => {
      let selected = null
      try {
        selected = this.selected[req.params.name][req.params.type]
      } catch (e) {
      }
      res.json({
        selected,
      })
    }))
    this.app.post("/state", ex(async (req, res) => {
      /*
      req.body := {
        name: <name>, 
        type: "browse"|"run",
        method: "toggleMenu"|"select",
        params: {
          <url>,
        }
      }
      */
      if (req.body.method === "select") {
        if (!this.selected[req.body.name]) {
          this.selected[req.body.name] = {}
        }
        this.selected[req.body.name][req.body.type] = req.body.params.url
      } else if (req.body.method === "toggleMenu") {
        if (!this.menu_hidden[req.body.name]) {
          this.menu_hidden[req.body.name] = {}
        }
        if (this.menu_hidden[req.body.name][req.body.type]) {
          this.menu_hidden[req.body.name][req.body.type] = false
        } else {
          this.menu_hidden[req.body.name][req.body.type] = true
        }
      }
      res.json({
        success: true
      })
    }))
    this.app.post("/mkdir", ex(async (req, res) => {
      let folder = req.body.folder
      let folder_path = path.resolve(this.kernel.api.userdir, req.body.folder)
      try {
        // mkdir
        await fs.promises.mkdir(folder_path)

        // create basic pinokio.json

        // add default icon

        let default_icon_path = path.resolve(__dirname, "public/pinokio-black.png")
        let icon_path = path.resolve(folder_path, "icon.png")
        await fs.promises.cp(default_icon_path, icon_path)


        // write title/description to pinokio.json
//        let meta_path = path.resolve(folder_path, "pinokio.json")
//        let meta = {
//          title: "No title",
//          description: "",
//          icon: "icon.png",
//          plugin: {
//            menu: []
//          }
//        }
//        console.log({ folder_path, default_icon_path, icon_path, meta_path, meta })
//        await fs.promises.writeFile(meta_path, JSON.stringify(meta, null, 2))

        res.json({
          //success: "/pinokio/browser/"+folder
          //success: "/p/"+folder
          success: "/init/"+folder
        })
      } catch (e) {
        res.json({
          error: e.message
        })
      }
    }))
    this.app.post("/copy", ex(async (req, res) => {
      let src_path = path.resolve(this.kernel.api.userdir, req.body.src)
      let dest_path = path.resolve(this.kernel.api.userdir, req.body.dest)
      try {
        await fs.promises.cp(src_path, dest_path, { recursive: true })
        res.json({
          //success: "/pinokio/browser/"+ req.body.dest + "/dev"
          success: "/p/"+ req.body.dest + "/dev"
        })
      } catch (e) {
        res.json({
          error: e.message
        })
      }
    }))
    this.app.post("/proxy", ex(async (req, res) => {
      /*
        req.body := {
          action: "start"|"stop",
          name: <name>,
          target: <target url>,
          port: <proxy port>
        }
      */
      if (req.body && req.body.target && req.body.action && req.body.name) {
        //let port = new URL(req.body.target).port
        //let port = await this.kernel.port()
        if (req.body.action === "start") {
          let port = req.body.port
          console.log("start proxy")
          await this.kernel.api.startProxy("/proxy", req.body.target, req.body.name, { port })
          console.log(this.kernel.api.proxies)
        } else if (req.body.action === "stop") {
          await this.kernel.api.stopProxy({
            uri: req.body.target
          })
        }
      }
      res.json({ success: true })
    }))
    this.app.post("/unpublish", ex(async (req, res) => {
      /*
        req.body := {
          type: "local"|"cloudflare"
        }
      */
      if (req.body.type) {
        if (req.body.type === "local") {
          await this.kernel.api.stopProxy({
            uri: `http://127.0.0.1:${this.port}`
          })
        } else if (req.body.type === "cloudflare") {
          await this.cf.stop({
            params: {
              uri: `http://127.0.0.1:${this.port}`
            }
          }, (e) => {
            process.stdout.write(e.raw)
          }, this.kernel)
          this.cloudflare_pub = null
        }
        res.json({ success: true })
      } else {
        res.json({ error: "type must be 'local' or 'cloudflare'" })
      }
    }))
    this.app.post("/publish", ex(async (req, res) => {
      /*
        req.body := {
          type: "local"|"cloudflare"
        }
      */
      if (req.body.type) {
        if (req.body.type === "local") {
          let env = await Environment.get(this.kernel.homedir)
          if (env && env.PINOKIO_SHARE_LOCAL_PORT) {
            let port = env.PINOKIO_SHARE_LOCAL_PORT.trim()
            if (port.length > 0) {
              await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port })
            } else {
              await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/")
            }
          } else {
            //await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port: 44001 })
            await this.kernel.api.startProxy("/", `http://127.0.0.1:${this.port}`, "/", { port: 42002 })
          }
          console.log("started proxy")
        } else if (req.body.type === "cloudflare") {
          let { uri } = await this.cf.tunnel({
            params: {
              uri: `http://127.0.0.1:${this.port}`
            }
          }, (e) => {
            process.stdout.write(e.raw)
          }, this.kernel)
          console.log("cloudflare started at " + uri)
          this.cloudflare_pub = uri
        }
        res.json({ success: true })
      } else {
        res.json({ error: "type must be 'local' or 'cloudflare'" })
      }
    }))
    this.app.get("/prototype/run/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/").concat("pinokio.js")
      let config = await this.kernel.api.meta({ path: req.query.path })
      let pinokiojson_path = path.resolve(req.query.path, "pinokio.json")
      let pinokiojson = await this.kernel.require(pinokiojson_path)
      if (pinokiojson) {
        if (pinokiojson.plugin) {
          if (pinokiojson.plugin.menu) {
          } else {
            pinokiojson.plugin.menu = []
            await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
          }
        } else {
          pinokiojson.plugin = { menu: [] }
          await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
        }
      } else {
        pinokiojson = {
          plugin: {
            menu: []
          }
        }
        await fs.promises.writeFile(pinokiojson_path, JSON.stringify(pinokiojson, null, 2))
      }
      req.base = this.kernel.path("prototype")
      req.query.callback = config.ui
      //req.query.callback = config.browse
      req.query.cwd = req.query.path
      await this.render(req, res, pathComponents, null)
    }))
    this.app.get("/prototype/show/*", ex(async (req, res) => {
      let name = req.params[0].split("/").filter((x) => { return x }).join("/")

      // print readme

      


      let paths = req.params[0].split("/")
      let item
      let config = this.kernel.proto.config
      for(let key of paths) {
        config = config.menu[key] 
      }
      console.log("config.shell", config.shell)
      if (config.shell) {

        let rendered = this.kernel.template.render(config.shell, {})
        let params = new URLSearchParams()
        if (rendered.path) params.set("path", encodeURIComponent(rendered.path))
        if (rendered.message) params.set("message", encodeURIComponent(rendered.message))
        if (rendered.venv) params.set("venv", encodeURIComponent(rendered.venv))
        if (rendered.input) params.set("input", true)
        if (rendered.callback) params.set("callback", encodeURIComponent(rendered.callback))
        if (rendered.kill) params.set("kill", encodeURIComponent(rendered.kill))
        if (rendered.done) params.set("done", encodeURIComponent(rendered.done))
        if (rendered.env) {
          for(let key in rendered.env) {
            let env_key = "env." + key
            params.set(env_key, rendered.env[key])
          }
        }
        if (rendered.conda) {
          for(let key in rendered.conda) {
            let conda_key = "conda." + key
            params.set(conda_key, rendered.conda[key])
          }
        }
        let shell_id = Math.floor("SH_" + 1000000000000 * Math.random())
        let href = "/shell/" + shell_id + "?" + params.toString()
        res.redirect(href)
      } else {
        let run_path = "/run/prototype/system/" + config.href + "?cwd=" + req.query.path
        let readme_path = this.kernel.path("prototype/system", config.readme)
        let md = await fs.promises.readFile(readme_path, "utf8")
        let baseUrl = "/asset/prototype/system/" + (config.readme.split("/").slice(0, -1).join("/")) + "/"
        let readme = marked.parse(md, {
          baseUrl
        })
        res.render("prototype/show", {
          run_path,
          portal: this.portal,
          readme,
          logo: this.logo,
          theme: this.theme,
          agent: this.agent,
          kernel: this.kernel,
        })
      }

    }))
    this.app.get("/prototype", ex(async (req, res) => {
      // load meta
//      let config = await this.kernel.api.meta({ path: req.query.path })
//      let items = this.kernel.proto.items
//      if (req.query.type) {
//        items = this.kernel.proto.items.filter(item => item.type === req.query.type)
//      }
      let title
      let description
      if (req.query.type === "init") {
        title = "Initialize"
        description = "Select an option to intitialize the project with. This may overwrite the folder if you already have existing files"
      } else if (req.query.type === "extension") {
        title = "Extensions"
        description = "Add extension modules to the current folder"
      }

      let config = structuredClone(this.kernel.proto.config)
      config = this.renderMenu2(config, {
        cwd: req.query.path,
        href: "/prototype/show",
        path: this.kernel.path("prototype/system"),
        web_path: "/asset/prototype/system"
      })

//    {
//      "icon": "fa-solid fa-power-off",
//      "text": "Run Default",
//      "href": "/api/facefusion-pinokio.git/run.js?run=true&fullscreen=true&mode=Default",
//      "params": {
//        "run": true,
//        "fullscreen": true,
//        "mode": "Default"
//      },
//      "src": "/api/facefusion-pinokio.git/run.js",
//      "html": "<i class=\"fa-solid fa-power-off\"></i> Run Default",
//      "btn": "<i class=\"fa-solid fa-power-off\"></i> Run Default",
//      "target": "@/api/facefusion-pinokio.git/run.js"
//    },
//
      res.render("prototype/index", {
        title,
        description,
        config,
        path: req.query.path,
        portal: this.portal,
//        items,
        logo: this.logo,
        platform: this.kernel.platform,
        theme: this.theme,
        agent: this.agent,
        kernel: this.kernel,
      })
    }))
    this.app.post("/prototype", this.upload.any(), ex(async (req, res) => {
      try {
        /*
          {
            title,
            description,
            path,
            id
          }
        */
        let formData = req.body
        for(let key in req.files) {
          let file = req.files[key]
          formData[file.fieldname] = file.buffer
        }
        console.log({ formData })


        // check if the path exists. if it does, return error
        let api_path = this.kernel.path("api", formData.path)
        let e = await this.exists(api_path)
        if (e) {
          console.log("e", e)
          console.log("e.message", e.message)
          res.status(500).json({ error: `The path ${api_path} already exists` })
        } else {
          await this.createMeta(formData)

          // run 

          res.json({ success: true })
        }
      } catch (e) {
        console.log("e", e)
        console.log("e.message", e.message)
        res.status(500).json({ error: e.message })
      }
    }))
    this.app.post("/new", this.upload.any(), ex(async (req, res) => {
      try {
        /*
          {
            title,
            description,
            path,
            id
          }
        */
        let formData = req.body
        for(let key in req.files) {
          let file = req.files[key]
          formData[file.fieldname] = file.buffer
        }
        console.log({ formData })


        // check if the path exists. if it does, return error
        let api_path = this.kernel.path("api", formData.path)
        let e = await this.exists(api_path)
        if (e) {
          console.log("e", e)
          console.log("e.message", e.message)
          res.status(500).json({ error: `The path ${api_path} already exists` })
        } else {
          await this.createMeta(formData)
          res.json({ success: true })
        }
      } catch (e) {
        console.log("e", e)
        console.log("e.message", e.message)
        res.status(500).json({ error: e.message })
      }
    }))
    this.app.post("/env", ex(async (req, res) => {
      let fullpath = path.resolve(this.kernel.homedir, req.body.filepath, "ENVIRONMENT")
      let updated = req.body.vals
      let hosts = req.body.hosts
      console.log("Util.update_env", { fullpath, filepath: req.body.filepath, updated })
      await Util.update_env(fullpath, updated)
      // for all environment variables that have hosts, save the key as well
      // hosts := { env_key: host }
      for(let env in hosts) {
        let host = hosts[env]
        let val = updated[env]
        console.log({ hosts, updated, host, val })
        await this.kernel.kv.set(host.value, val, host.index)
      }
      res.json({})
    }))
    this.app.get("/env", ex(async (req, res) => {
      let env_path = path.resolve(this.kernel.homedir)
      await this.init_env(env_path)

      let filepath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
      let editorpath = "/edit/ENVIRONMENT"

      const items = await Util.parse_env_detail(filepath)

      res.render("env_editor", {
        home: true,
        config: null,
        name: null,
        init: null,
        editorpath,
        items,
        theme: this.theme,
        filepath,
        agent: this.agent,
      })
    }))
    this.app.get("/env/*", ex(async (req, res) => {

      let env_path = req.params[0]
//      let p = path.resolve(this.kernel.homedir, env_path, "pinokio.js")
//      let config  = (await this.kernel.loader.load(p)).resolved
      let api_path
      if (env_path.startsWith("api/")) {
        api_path = env_path.slice(4) 
      }
      let config = await this.kernel.api.meta(api_path)
      if (config.run) {
        await this.init_env(env_path, { no_inherit: true })
      } else {
        await this.init_env(env_path)
      }

      let pathComponents = req.params[0].split("/")
      let filepath = path.resolve(this.kernel.homedir, req.params[0], "ENVIRONMENT")

      let items = []
      let e = await this.exists(filepath)
      if (e) {
        items = await Util.parse_env_detail(filepath)
      }
//      if (config.icon) {
//        config.icon = `/${env_path}/${config.icon}?raw=true`
//      } else {
//        config.icon = "/pinokio-black.png"
//      }

      let name
      if (env_path.startsWith("api")) {
        name = env_path.split("/")[1]
      }
      let editorpath = "/edit/" + req.params[0] + "/ENVIRONMENT"

      if (config.run) {
        let configStr = await fs.promises.readFile(p, "utf8")
        res.render("task", {
          home: null,
          config,
          name,
          init: true,
//          init: req.query ? req.query.init : null,
          editorpath,
          items,
          theme: this.theme,
          filepath,
          agent: this.agent,
          path: "/api/" + name + "/pinokio.js",
          _path: "/_api/" + name,
          str: configStr
        })
      } else {

        let gitRemote = null
        try {
          //const repositoryPath = this.kernel.path(pathComponents[0], pathComponents[1])
          //const repositoryPath = this.kernel.path(pathComponents[0])
          const repositoryPath = path.resolve(this.kernel.api.userdir, api_path)
          console.log({ repositoryPath })
          gitRemote = await git.getConfig({
            fs,
            http,
            dir: repositoryPath,
            path: 'remote.origin.url'
          })
        } catch (e) {
          console.log("ERROR", e)
        }
        res.render("env_editor", {
          gitRemote,
          home: null,
          config,
          name,
          init: req.query ? req.query.init : null,
          editorpath,
          items,
          theme: this.theme,
          filepath,
          agent: this.agent,
        })
      }
      //res.render("env_editor", {
      //  home: null,
      //  config,
      //  name,
      //  init: req.query ? req.query.init : null,
      //  editorpath,
      //  items,
      //  theme: this.theme,
      //  filepath,
      //  agent: this.agent,
      //})
    }))
    this.app.get("/pre/api/:name", ex(async (req, res) => {
      let p = path.resolve(this.kernel.homedir, "api", req.params.name, "pinokio.js")
      let p2 = path.resolve(this.kernel.homedir, "api", req.params.name)
      let config  = (await this.kernel.loader.load(p)).resolved
      if (config && config.pre) {
        config.pre.forEach((item) => {
          if (item.icon) {
            item.icon = `/api/${req.params.name}/${item.icon}?raw=true`
          } else {
            item.icon = "/pinokio-black.png"
          }
          if (!item.href.startsWith("http")) {
            item.href = path.resolve(this.kernel.homedir, "api", req.params.name, item.href)
          }
        })
        let env = await Environment.get2(p2, this.kernel)
        res.render("pre", {
          name: req.params.name,
          theme: this.theme,
          agent: this.agent,
          name: req.params.name,
          items: config.pre,
          env
        })
      } else {
        res.redirect("/env/" + req.params.name + "?init=true")
      }
    }))
    this.app.get("/initialize/:name", ex(async (req, res) => {
      let p = path.resolve(this.kernel.homedir, "api", req.params.name, "pinokio.js")
      let config  = (await this.kernel.loader.load(p)).resolved
      if (config) {
        // if pinokio.js exists
        if (config.pre && Array.isArray(config.pre)) {
          // if pre exists, redirect to /pre/:name
          res.redirect(`/pre/api/${req.params.name}`)
        } else {
          // if pre doesn't exist, redirect to /env/:name
          res.redirect(`/env/api/${req.params.name}?init=true`)
        }
      } else {
        // if pinokio.js doesn't exist, send to /browser/:name
        //res.redirect(`/pinokio/browser/${req.params.name}`)
        res.redirect(`/p/${req.params.name}`)
      }
    }))
    this.app.get("/share/:name", ex(async (req, res) => {
      let filepath = path.resolve(this.kernel.homedir, "api", req.params.name, "ENVIRONMENT")
      //let filepath = path.resolve(this.kernel.homedir, req.params[0])
      const config = await Util.parse_env(filepath)
      const keys = [
        "PINOKIO_SHARE_CLOUDFLARE",
        "PINOKIO_SHARE_LOCAL",
        "PINOKIO_SHARE_LOCAL_PORT"
      ]
      for(let key of keys) {
        if (!config[key]) {
          config[key] = ""
        }
      }
      // find urls in the current app
      let app_path = path.resolve(this.kernel.homedir, "api", req.params.name)
      let scripts = Object.keys(this.kernel.memory.local).filter((x) => {
        return x.startsWith(app_path)
      })
      let cloudflare_links = []
      let local_links = []
      for(let script in this.kernel.memory.local) {
        let mem = this.kernel.memory.local[script]
        if (mem.$share) {
          if (mem.$share.cloudflare) {
            for(let key in mem.$share.cloudflare) {
              let val = mem.$share.cloudflare[key]
              let qr = await QRCode.toDataURL(val)
              cloudflare_links.push({
                url: val,
                qr
              })
            }
          }
          if (mem.$share.local) {
            for(let key in mem.$share.local) {
              let val = mem.$share.local[key]
              let qr = await QRCode.toDataURL(val)
              local_links.push({
                url: val,
                qr
              })
            }
          }
        }
      }
      res.render("share_editor", {
        cloudflare_links,
        local_links,
        keys,
        config,
        theme: this.theme,
        filepath,
        agent: this.agent,
      })
    }))
    this.app.get("/xterm_config", ex(async (req, res) => {
      let exists = await fse.pathExists(this.kernel.path("web"))
      if (exists) {
        let config_exists = await fse.pathExists(this.kernel.path("web/config.json"))
        if (config_exists) {
          let config = (await this.kernel.loader.load(this.kernel.path("web/config.json"))).resolved
          if (config) {
            if (config.xterm) {
              this.xterm = config.xterm
              console.log("this.xterm", this.xterm)
            }
          }
        }
      }
      res.json({ config: this.xterm })
    }))
    this.app.get("/du/*", ex(async (req, res) => {
      let p = this.kernel.path("api", req.params[0])
      try {
        let d1 = await Util.du(p)
        res.json({ du: d1 })
      } catch (e) {
        console.log("disk usage error", e)
        res.json({ du: 0 })
      }
    }))
    this.app.get("/edit/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = path.resolve(this.kernel.homedir, req.params[0])
      const content = await fs.promises.readFile(filepath, "utf8")
      res.render("general_editor", {
        theme: this.theme,
        filepath,
        content,
        agent: this.agent,
      })
    }))
    this.app.get("/script/:name", ex((req, res) => {
      if (req.params.name === "start") {
        res.json(this.startScripts)
      }
    }))
    this.app.get("/gitcommit/:ref/*", ex(async (req, res) => {
      // return git log
      let dir = this.kernel.path("api", req.params[0])
      let changes = []
      let d = Date.now()
      if (req.params.ref === "HEAD") {
        try {
          let statusMatrix = await git.statusMatrix({ dir, fs });
          statusMatrix = statusMatrix.filter(Boolean);
          for (const [filepath, head, workdir, stage] of statusMatrix) {
            if (head !== workdir || head !== stage) {
              const fullPath = path.join(dir, filepath);
              let relpath = path.relative(this.kernel.homedir, fullPath)
              let webpath = "/asset/" + relpath
              let rel_filepath = path.relative(this.kernel.path("api"), fullPath)

              const stats = await fs.promises.stat(fullPath)
              if (stats.isDirectory()) {
                continue
              }


              changes.push({
                ref: req.params.ref,
                webpath,
                file: filepath,
                path: fullPath,
                status: Util.classifyChange(head, workdir, stage),
              });
            }
          }
        } catch (err) {
          console.log("git status matrix error", err)
        }
      } else {
        try {
          let ref = req.params.ref
          const commitOid = await this.kernel.git.resolveCommitOid(dir, ref);
          const parentOid = await this.kernel.git.getParentCommit(dir, commitOid);
          let entries
          if (parentOid !== commitOid) {
            entries = await git.walk({
              fs,
              dir,
              trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: commitOid })],
              map: async (filepath, [A, B]) => {
                if (filepath === ".") return; // skip root

                if (!A && B) return { filepath, type: "added" };
                if (A && !B) return { filepath, type: "deleted" };
                if (A && B) {
                  const Aoid = await A.oid();
                  const Boid = await B.oid();
                  if (Aoid !== Boid) return { filepath, type: "modified" };
                }
              },
            });
          } else {
            // First commit: treat all files as added
            entries = await git.walk({
              fs,
              dir,
              trees: [git.TREE({ ref: commitOid })],
              map: async (filepath, [B]) => {
                if (filepath === ".") return; // skip root
                return { filepath, type: "added" };
              },
            });

          }
          // Filter out undefined (unchanged files)
          const diffFiles = entries.filter(Boolean);
          // Load diffs only for changed files
          for (const { filepath, type } of diffFiles) {
            const fullPath = path.join(dir, filepath);
            const webpath = "/asset/" + path.relative(this.kernel.homedir, fullPath);
            let rel_filepath = path.relative(this.kernel.path("api"), fullPath)
            const stats = await fs.promises.stat(fullPath)
            if (stats.isDirectory()) {
              continue
            }
            changes.push({
              ref: req.params.ref,
              webpath,
              file: filepath,
              path: fullPath,
              status: type,
            });
          }
        } catch (err) {
          console.log("git diff error", err);
        }
      }
      res.json({ changes })
    }))
    this.app.get("/gitdiff/:ref/*", ex(async (req, res) => {
      let fullpath = this.kernel.path("api", req.params[0])
      let dir
      let dirs = Array.from(this.kernel.git.dirs)
      dirs.sort((x, y) => {
        return y.length - x.length
      })
      for(let d of dirs) {
        if (fullpath.startsWith(d)) {
          dir = d
          break
        }
      }
      let filepath = path.relative(dir, fullpath)
      let binary = false;
      try {
        binary = await isBinaryFile(fullpath)
      } catch {
        binary = false; // fallback
      }

      let oldContent = "";
      let newContent = "";
      let change = null
      if (!binary) {
        if (req.params.ref === "HEAD") {
          try {
            const commitOid = await git.resolveRef({ fs, dir, ref: req.params.ref });
            const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
            oldContent = Buffer.from(blob).toString("utf8");
          } catch (e) {
            oldContent = "";
          }

          // Working directory version
          try {
            newContent = await fs.promises.readFile(fullpath, "utf8");
          } catch (e) {
            newContent = "";
          }
          const diffs = diff.diffLines(normalize(oldContent), normalize(newContent));
          change = Util.diffLinesWithContext(diffs, 5);
        } else {
          const commitOid = await this.kernel.git.resolveCommitOid(dir, req.params.ref);
          const parentOid = await this.kernel.git.getParentCommit(dir, commitOid);
          if (commitOid === parentOid) {
            oldContent = ""
          } else {
            try {
              const { blob } = await git.readBlob({ fs, dir, oid: parentOid, filepath });
              oldContent = Buffer.from(blob).toString("utf8");
            } catch (e) {
              console.log("E1", e)
            } // File might not exist

          }
          try {
            const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
            newContent = Buffer.from(blob).toString("utf8");
          } catch (e) {
            console.log("E1", e)
          } // File might not exist
          const diffs = diff.diffLines(normalize(oldContent), normalize(newContent));
          change = Util.diffLinesWithContext(diffs, 5);
        }
      }
      const relpath = path.relative(this.kernel.homedir, fullpath)
      const webpath = "/asset/" + relpath
      let response = {
        webpath,
        file: filepath,
        path: fullpath,
//        status: Util.classifyChange(head, workdir, stage),
        diff: change,
        binary,
      }
      res.json(response)
    }))
    this.app.get("/git/:ref/*", ex(async (req, res) => {

      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }



      let dir = this.kernel.path("api", req.params[0])
      let branches = await git.listBranches({ fs, dir });
      let log = []
      try {
        log = await git.log({ fs, dir, depth: 50, ref: req.params.ref }); // fetch last 50 commits
      } catch (e) {
        console.log("Log error", e)
      }

      let config = await this.kernel.git.config(dir)

      let hosts = ""
      let hosts_file = this.kernel.path("config/gh/hosts.yml")
      let e = await this.exists(hosts_file)
      if (e) {
        hosts = await fs.promises.readFile(hosts_file, "utf8")
        if (hosts.startsWith("{}")) {
          hosts = ""
        }
      }
      let connected = (hosts.length > 0)
      let remote = null
      if (config["remote \"origin\""]) {
        remote = config["remote \"origin\""].url
      }

      let branch = await git.currentBranch({ fs, dir, fullname: false });

      const remote2 = await git.getConfig({
        fs,
        dir,
        path: `branch.${branch}.remote`
      });

      // if current branch exitss => currengt branch is selected
      // if current branch does not exist => get logs[0].oid
      if (branch) {
        branches = branches.map((b) => {
          if (b === branch) {
            return {
              branch: b,
              selected: true
            }
          } else {
            return {
              branch: b,
              selected: false
            }
          }
        })
      } else {
        branches.push(log[0].oid)
        branches = branches.map((b) => {
          if (b === log[0].oid) {
            return {
              branch: b,
              selected: true
            }
          } else {
            return {
              branch: b,
              selected: false
            }
          }
        })
      }

      res.render("git", {
        branch,
        branches,
        ref: req.params.ref,
        path: req.params[0],
        log,
        connected,
//        changes,
        dir,
        config,
        remote,
        theme: this.theme,
        platform: this.kernel.platform,
        agent: this.agent,
      })
    }))
    this.app.get("/d/*", ex(async (req, res) => {
      let filepath = Util.u2p(req.params[0])
      let terminal = await this.terminals(filepath)
      let plugin = await this.getPluginGlobal(req, this.kernel.plugin.config, terminal, filepath)
      let html = ""
      let plugin_menu
      try {
        plugin_menu = plugin.menu
        //plugin_menu = plugin.menu[0].menu
      } catch (e) {
        plugin_menu = []
      }
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
      let retry = false
      // if plugin_menu is empty, try again in 1 sec
      if (plugin_menu.length === 0) {
        retry = true
      }

      let exec_menus = []
      let shell_menus = []
      let href_menus = []
      if (plugin_menu.length > 0) {
        for(let item of plugin_menu) {
          // if shell.run method exists
          // if exec method exists 
          let mode
          if (item.run) {
            for(let step of item.run) {
              if (step.method === "exec") {
                mode = "exec" 
                break
              }
              if (step.method === "shell.run") {
                mode = "shell"
                break
              }
            }
            if (mode === "exec") {
              item.type = "Open"
              exec_menus.push(item)
            } else if (mode === "shell") {
              item.type = "Start"
              shell_menus.push(item)
            }
          } else {
            href_menus.push(item)
          }
        }
        exec_menus.sort((a, b) => { return a > b })
        shell_menus.sort((a, b) => { return a > b })
        href_menus.sort((a, b) => { return a > b })
      }

//      let terminal = await this.terminals(filepath)
//      let online_terminal = await this.getPluginGlobal(req, terminal, filepath)
//      console.log("online_terminal", online_terminal)
      terminal.menus = href_menus
      let dynamic = [
        {
          icon: "fa-solid fa-robot",
          title: "AI Engineer",
          subtitle: "Let AI work on this app",
          menu: shell_menus
        },
        {
          icon: "fa-solid fa-arrow-up-right-from-square",
          title: "External apps",
          subtitle: "Open this project in 3rd party apps",
          menu: exec_menus
        },
        terminal
      ]
      let spec = ""
      console.log("######", { filepath })
      try {
        spec = await fs.promises.readFile(path.resolve(filepath, "SPEC.md"), "utf8")
      } catch (e) {
        console.log(e)
      }
      console.log({ spec })
      res.render("d", {
        filepath,
        spec,
        retry,
        current_urls,
        docs: this.docs,
        portal: this.portal,
        install: this.install,
        agent: this.agent,
        theme: this.theme,
        //dynamic: plugin_menu
        dynamic,
      })
    }))
    this.app.get("/dev/*", ex(async (req, res) => {
      console.log("GET /dev/*", req.params)
      let { requirements, install_required, requirements_pending, error } = await this.kernel.bin.check({
        bin: this.kernel.bin.preset("dev"),
      })
      if (!requirements_pending && install_required) {
        res.redirect(`/setup/dev?callback=${req.originalUrl}`)
        return
      }
      let platform = os.platform()
//      await this.kernel.plugin.init()
      let filepath = Util.u2p(req.params[0])
//      let plugin = await this.getPluginGlobal(filepath)
      let current_urls = await this.current_urls(req.originalUrl.slice(1))
//      let plugin_menu
//      try {
//        plugin_menu = plugin.menu[0].menu
//      } catch (e) {
//        plugin_menu = []
//      }
      const result = {
        current_urls,
        plugin_menu: null,
        portal: this.portal,
        install: this.install,
        port: this.port,
        platform,
        running:this.kernel.api.running,
        memory: this.kernel.memory,
        dynamic: "/pinokio/dynamic_global/" + req.params[0],
        dynamic_content: null,
        home: req.originalUrl,
        theme: this.theme,
        agent: this.agent,
      }
      res.render("mini", result)
    }))
    this.app.get("/asset/*", ex((req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = this.kernel.path(...pathComponents)
      try {
        if (req.query.frame) {
          let m = mime.lookup(filepath)
          res.type("text/plain")
        }
        //res.setHeader('Content-Disposition', 'inline');
        res.sendFile(filepath)
      } catch (e) {
        res.status(404).send(e.message);
      }
    }))
    this.app.get("/raw/*", ex((req, res) => {
      let pathComponents = req.params[0].split("/")
      let filepath = this.kernel.path("api", ...pathComponents)
      try {
        if (req.query.frame) {
          let m = mime.lookup(filepath)
          res.type("text/plain")
        }
        //res.setHeader('Content-Disposition', 'inline');
        res.sendFile(filepath)
      } catch (e) {
        res.status(404).send(e.message);
      }
    }))
    this.app.get("/_api/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      req.query.mode = "source"
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    }))
    this.app.get("/run/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      req.base = this.kernel.homedir
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    }))
    this.app.get("/api/*", ex(async (req, res) => {
      let pathComponents = req.params[0].split("/")
      if (req.query && 'command' in req.query) {
        let full_filepath = this.kernel.path("api", ...pathComponents)
        Util.openfs(full_filepath, { command: req.query.command })
        res.render("fs", {
          path: full_filepath
        })
      } else if (req.query && 'fs' in req.query) {
        // open in file system
        let full_filepath = this.kernel.path("api", ...pathComponents)
        if (req.query.fs) {
          if (req.query.fs === 'open') {
            // open
            Util.openfs(full_filepath, { mode: "open" })
          } else if (req.query.fs === 'view') {
            // view
            Util.openfs(full_filepath, { mode: "view" })
          } else {
            // view
            Util.openfs(full_filepath, { mode: "view" })
          }
          res.render("fs", {
            path: full_filepath
          })
        }
      } else {
        try {
          await this.render(req, res, pathComponents)
        } catch (e) {
          res.status(404).send(e.message)
        }
      }
    }))
    this.app.get("/pinokio/dynamic_global/*", ex(async (req, res) => {
      let filepath = Util.u2p(req.params[0])
      let terminal = await this.terminals(filepath)
      let plugin = await this.getPluginGlobal(req, this.kernel.plugin.config, terminal, filepath)
      if (plugin) {
        let html = ""
        if (plugin && plugin.menu) {
          let plugin_menu
          try {
            plugin_menu = plugin.menu[0].menu
          } catch (e) {
            plugin_menu = []
          }
          html = await new Promise((resolve, reject) => {
            ejs.renderFile(path.resolve(__dirname, "views/partials/dynamic.ejs"), { dynamic: plugin_menu }, (err, html) => {
              resolve(html)
            })
          })
        }
        res.send(html)
      } else {
        res.send("")
      }
    }))
    this.app.get("/pinokio/dynamic/:name", ex(async (req, res) => {
  //    await this.kernel.plugin.init()

      let plugin = await this.getPlugin(req, this.kernel.plugin.config, req.params.name)
      let html = ""
      let plugin_menu
      if (plugin) {
        if (plugin && plugin.menu && Array.isArray(plugin.menu)) {
          plugin = structuredClone(plugin)
          plugin_menu = this.running_dynamic(req.params.name, plugin.menu)
          html = await new Promise((resolve, reject) => {
            ejs.renderFile(path.resolve(__dirname, "views/partials/dynamic.ejs"), { dynamic: plugin_menu }, (err, html) => {
              resolve(html)
            })
          })
        }
      }
      res.send(html)
    }))
    this.app.get("/pinokio/ai/:name", ex(async (req, res) => {
      /*
        link to
          README.md
          AGENTS.md
          CLAUDE.md
          GEMINI.md
      */
      let filenames = [
          "README.md",
          "AGENTS.md",
          "CLAUDE.md",
          "GEMINI.md"
      ]
      let files = []
      for(let filename of filenames) {
        let c = this.kernel.path("api", req.params.name, filename)
        let exists = await this.exists(c)
        if (exists) {
          files.push(filename)
        }
      }

      let items = files.map((item) => {
        return {
          text: item,
          href: `/_api/${req.params.name}/${item}`
        }
      })
      let html = await new Promise((resolve, reject) => {
        ejs.renderFile(path.resolve(__dirname, "views/partials/ai.ejs"), { items }, (err, html) => {
          resolve(html)
        })
      })
      res.send(html)
    }))
    this.app.get("/pinokio/repos/:name", ex(async (req, res) => {
  //    await this.kernel.plugin.init()
      let c = this.kernel.path("api", req.params.name)
      let repos = await this.kernel.git.repos(c)

      await Util.ignore_subrepos(c, repos)

      // check if these are in the existing .git
      // 


      // add all the repos folder to .gitignore (except for the root)
      let html = await new Promise((resolve, reject) => {
        ejs.renderFile(path.resolve(__dirname, "views/partials/repos.ejs"), { repos, ref: "HEAD" }, (err, html) => {
          resolve(html)
        })
      })
      res.send(html)
    }))
    this.app.get("/pinokio/sidebar/:name", ex(async (req, res) => {
      let name = req.params.name
      let app_path = this.kernel.path("api", name, "pinokio.js")
      let rawpath = "/api/" + name
      let config  = (await this.kernel.loader.load(app_path)).resolved
      if (config && config.menu) {
        if (typeof config.menu === "function") {
          if (config.menu.constructor.name === "AsyncFunction") {
            config.menu = await config.menu(this.kernel, this.kernel.info)
          } else {
            config.menu = config.menu(this.kernel, this.kernel.info)
          }
        }

        let uri = this.kernel.path("api")
        await this.renderMenu(req, uri, name, config, [])
      } else {
        // if there is no menu, display all files
        let p = this.kernel.path("api", name)
        let files = await fs.promises.readdir(p, { withFileTypes: true })
        files = files.filter((file) => {
          return file.name.endsWith(".json") || file.name.endsWith(".js")
        }).filter((file) => {
          return file.name !== "pinokio.js" && file.name !== "pinokio.json" && file.name !== "pinokio_meta.json"
        })
        config = {
          title: name, 
          menu: files.map((file) => {
            return {
              text: file.name,
              href: file.name
            }
          })
        }
        let uri = this.kernel.path("api")
        await this.renderMenu(req, uri, name, config, [])
      }


      ejs.renderFile(path.resolve(__dirname, "views/partials/menu.ejs"), { menu: config.menu }, (err, html) => {
        res.send(html)
      })


/*
      res.json({
        config,
        home: req.originalUrl,
//        paths,
        theme: this.theme,
        agent: this.agent,
        rawpath
      })
      */

    }))
    this.app.post("/pinokio/peer/announce_kill", ex(async (req, res) => {
      this.kernel.peer.kill(req.body.host)
    }))
    this.app.post("/pinokio/peer/refresh", ex(async (req, res) => {
      // refresh and broadcast
      let new_config = JSON.stringify(req.body)
      let old_config = JSON.stringify(this.kernel.peer.info[req.body.host])
      let changed
      if (old_config !== new_config) {
        changed = true
      } else {
        changed = false
      }
      this.kernel.peer.refresh_info(req.body)
      await this.kernel.refresh()
      // if the submitted info is the same, do not refresh
      if (changed) {
        await this.kernel.peer.notify_refresh()
      }
      res.json({ changed })
    }))
//    this.app.post("/pinokio/peer/refresh", ex(async (req, res) => {
//      // refresh and broadcast
//      await this.kernel.refresh()
//      res.json({ success: true })
//    }))
    this.app.get("/pinokio/peer", ex(async (req, res) => {
//      await this.kernel.refresh()
      let current_peer_info = await this.kernel.peer.current_host()
      res.json(current_peer_info)
      /*
      res.json({
        home: this.kernel.homedir,
        arch: this.kernel.arch,
        platform: this.kernel.platform,
        name: this.kernel.peer.name,
        host: this.kernel.peer.host,
        port_mapping: this.kernel.router.port_mapping,
        //router: this.kernel.router.info(),
        proc: this.kernel.processes.info,
        router: this.kernel.router.published(),
        memory: this.kernel.memory
      })
      */
    }))
    this.app.get("/pinokio/memory", ex((req, res) => {
      let filepath = req.query.filepath
      let mem = this.getMemory(filepath)
      res.json(mem)
    }))
    this.app.post("/pinokio/tabs", ex(async (req, res) => {
      this.tabs[req.body.name] = req.body.tabs
      res.json({ success: true })
    }))
    this.app.get("/pinokio/browser", ex(async (req, res) => {
      if (req.query && req.query.uri) {
        let uri = req.query.uri
        let p = this.kernel.api.resolveBrowserPath(uri)
        res.redirect(p)
      } else {
        res.redirect("/")
      }
    }))
    this.app.get("/pinokio/launch/:name", ex(async (req, res) => {
      await this.chrome(req, res, "launch")
    }))
    this.app.get("/pinokio/browser/:name/dev", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/pinokio/browser/:name/browse", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/pinokio/browser/:name", ex(async (req, res) => {
      await this.chrome(req, res, "run")
    }))
    this.app.get("/p/:name/dev", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/p/:name/browse", ex(async (req, res) => {
      await this.chrome(req, res, "browse")
    }))
    this.app.get("/p/:name", ex(async (req, res) => {
      await this.chrome(req, res, "run")
    }))
    this.app.post("/pinokio/delete", ex(async (req, res) => {
      try {
        if (req.body.type === 'bin') {
          let folderPath = this.kernel.path("bin")
          await fse.remove(folderPath)
          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          res.json({ success: true })
        } else if (req.body.type === 'cache') {
          let folderPath = this.kernel.path("cache")
          await fse.remove(folderPath)
          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          res.json({ success: true })
        } else if (req.body.type === 'env') {
          let envpath = this.kernel.path("ENVIRONMENT")
          let str = await Environment.ENV("system", this.kernel.homedir)
          await fs.promises.writeFile(path.resolve(this.kernel.homedir, "ENVIRONMENT"), str)
          res.json({ success: true })
        } else if (req.body.type === 'browser-cache') {
          if (this.browser) {
            await this.browser.clearCache()
          }
          res.json({ success: true })
        } else if (req.body.name) {
          let folderPath = this.kernel.path("api", req.body.name)
          await fse.remove(folderPath)
//          await fs.promises.mkdir(folderPath, { recursive: true }).catch((e) => { })
          await new Promise((resolve, reject) => {
            setTimeout(() => {
              resolve()
            }, 2000)
          })
          res.json({ success: true })
        }
      } catch(err) {
        res.json({ error: err.stack })
      }
    }))
    this.app.get("/pinokio/logs.zip", ex((req, res) => {
      let zipPath = this.kernel.path("logs.zip")
      res.download(zipPath)
    }))
    this.app.post("/pinokio/log", ex(async (req, res) => {


      let states = this.kernel.shell.shells.map((s) => {
        return {
          state: s.state,
          id: s.id,
          group: s.group,
          env: s.env,
          path: s.path,
          cmd: s.cmd,
          done: s.done,
          ready: s.ready,
        }
      })

      let info = {
        platform: this.kernel.platform,
        arch: this.kernel.arch,
        running: this.kernel.api.running,
        home: this.kernel.homedir,
        vars: this.kernel.vars,
        memory: this.kernel.memory,
        procs: this.kernel.procs,
        gpu: this.kernel.gpu,
        gpus: this.kernel.gpus,
        version: this.version,
        ...this.kernel.sysinfo
      }
      await fs.promises.writeFile(this.kernel.path("logs/system.json"), JSON.stringify(info, null, 2))
      await fs.promises.writeFile(this.kernel.path("logs/state.json"), JSON.stringify(states, null, 2))


      await fs.promises.cp(
        this.kernel.path("logs"),
        this.kernel.path("exported_logs")
      , { recursive: true })
      await this.kernel.shell.logs()


      let folder = this.kernel.path("exported_logs")
      let zipPath = this.kernel.path("logs.zip")
      await compressing.zip.compressDir(folder, zipPath)
      res.json({ success: true })
    }))
    this.app.get("/pinokio/version", ex(async (req, res) => {
      let version = this.version
      version.script = this.kernel.schema.replace(/[^0-9.]+/,'')
      res.json(version)
    }))
    this.app.get("/pinokio/info", ex(async (req, res) => {
      await this.kernel.getInfo(true)
      let info = Object.assign({}, this.kernel.i)
      info.launch_complete = this.kernel.launch_complete
      console.log("kernel.launch_complete", this.kernel.launch_complete)
      delete info.vars
      delete info.shell_env
      delete info.memory
      res.json(info)
    }))
    this.app.get("/pinokio/port", ex(async (req, res) => {
      let port = await this.kernel.port()
      res.json({ result: port })
    }))
    this.app.get("/pinokio/download", ex((req, res) => {
      let queryStr = new URLSearchParams(req.query).toString()
      res.redirect("/?mode=download&" + queryStr)
    }))
    this.app.post("/pinokio/install", ex((req, res) => {
      req.session.requirements = req.body.requirements
      req.session.callback = req.body.callback
      res.redirect("/pinokio/install")
    }))
    this.app.get("/pinokio/install", ex((req, res) => {
      console.log("render /pinokio/install")
      let requirements = req.session.requirements
      let callback = req.session.callback
      req.session.requirements = null
      req.session.callback = null
      res.render("install", {
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        userdir: this.kernel.api.userdir,
        display: ["form"],
//        query: req.query,
        requirements,
        callback
      })
    }))
    this.app.get("/pinokio", ex((req, res) => {
      // parse the uri & path
      let {uri, ...query} = req.query
      let querystring = new URLSearchParams(query).toString()
      let webpath = this.kernel.api.webPath(req.query.uri)
      if (querystring && querystring.length > 0) {
        webpath = webpath + "?" + querystring
      }
      res.redirect(webpath)
    }))
    this.app.post("/pinokio/upload", this.upload.any(), ex(async (req, res) => {
      try {


        /*
          1. edit
          2. copy
          3. copy + edit
          4. move
          5. move + edit
              
        */

        let formData = req.body
        for(let key in req.files) {
          let file = req.files[key]
          formData[file.fieldname] = file.buffer
        }

        if (formData.edit) {
          if (formData.copy) {
            if (formData.old_path !== formData.new_path) {

              // 1. copy first
              let old_path = this.kernel.path("api", formData.old_path)
              let new_path = this.kernel.path("api", formData.new_path)

              await fs.promises.cp(old_path, new_path, { recursive: true })

              // 2. edit meta in the new_path
              await this.updateMeta(formData, formData.new_path)

            }
          } else if (formData.move) {

            // 1. move first
            if (formData.old_path !== formData.new_path) {
              let old_path = this.kernel.path("api", formData.old_path)
              let new_path = this.kernel.path("api", formData.new_path)
              await fs.promises.rename(old_path, new_path)
            }

            // 2. edit meta in the new_path
            await this.updateMeta(formData, formData.new_path)
          } else {
            // 1. edit only
            if (formData.old_path === formData.new_path) {
              await this.updateMeta(formData, formData.new_path)
            }
          }
        } else {
          if (formData.copy) {
            // 1. copy only
            let old_path = this.kernel.path("api", formData.old_path)
            let new_path = this.kernel.path("api", formData.new_path)
            await fs.promises.cp(old_path, new_path, { recursive: true })
          } else if (formData.move) {
            // 2. move only
            let old_path = this.kernel.path("api", formData.old_path)
            let new_path = this.kernel.path("api", formData.new_path)
            await fs.promises.rename(old_path, new_path)
          } else {
            // nothing
          }
        }
        res.json({
          success: true,
          reload: formData.new_path,
          new_path: formData.new_path,
        })
      } catch (e) {
        console.log("e", e)
        res.status(500).json({ error: e.message })
      }

    }))
    /*
      SYNTAX
      fs.uri(<bin|api>, path)

      EXAMPLES
      fs.uri("api", "sfsdfs")
      fs.uri("api", "https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png")
      fs.uri("bin", "python/bin")

      1. Git URI: http://localhost/pinokio/fs?drive=api&path=https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png
      2. Local path: http://localhost/pinokio/fs?drive=api&path=test/icon.png
    */
    this.app.get("/pinokio/fs", ex((req, res) => {
      // serve reaw files
      if (req.query && req.query.drive && req.query.path) {
        let p
        if (req.query.drive === "bin") {
          p = path.resolve(this.kernel.homedir, "bin", req,query.path)
        } else if (req.query.drive === "api") {
          p = this.kernel.api.filePath(req.query.path, this.kernel.api.userdir)
        }
        try {
          if (p) {
            res.sendFile(p)
          } else {
            res.status(404).send("Path doesn't exist")
          }
        } catch (e) {
          console.log("ERROR" ,e)
          res.status(404).send(e.message);
        }
      } else {
        res.status(404).send("Missing attribute: path")
      }
    }))
    this.app.post("/pinokio/fs", this.upload.any(), ex(async (req, res) => {
      /*
        Packet format:
          types: <argument types>
          drive: <api|bin>,
          path: <file system path>,
          method: <method name>,
          "arg0": <arg0>
          "arg1": <arg1>
          ...


        Argument serialization
          array => JSON
          object => JSON
          primitive => string ("false", "null", etc)
          file,blob,uintarray,arraybuffer => blob

        types:
          file,blob,uintarray,arraybuffer => Blob
          array => Array
          object that's not (array, file, blob, uint8array, arraybuffer) => Object
          the rest => typeof(value)
      */
      let formData = req.body
      for(let key in req.files) {
        let file = req.files[key]
        formData[file.fieldname] = file.buffer
      }

      const drive = formData.drive
      const home = formData.path
      const method = formData.method
      const types = JSON.parse(formData.types)
      if (drive && home && types && method) {
        let deserializedArgs = []
        for(let i=0; i<types.length; i++) {
          let type = types[i]
          let arg = formData[`arg${i}`]
          // deserialize
          let val
          if (type === 'Blob') {
            //val = Buffer.from(arg.data) // blob => buffer
            val = arg
          } else if (type === "Array") {
            val = JSON.parse(arg)
          } else if (type === "Object") {
            val = JSON.parse(arg)
          } else {
            if (type === 'number') {
              val = Number(arg) 
            } else if (type === 'boolean') {
              val = Boolean(arg)
            } else if (type === 'string') {
              val = String(arg)
            } else if (type === 'function') {
              val = new Function(arg)
            } else if (type === 'null') {
              val = null
            } else if (type === 'undefined') {
              val = undefined
            } else {
              val = arg
            }
          }
          deserializedArgs.push(val)
        }

        let cwd
        if (drive === "api") {
          cwd = this.kernel.api.filePath(home, this.kernel.api.userdir)

          // 1. exists
          // 2. clone
          // 3. pull
          if (method === "clone") {
            // clone(dest)
            if (types.length === 1) {
              await this.kernel.bin.sh({
                message: `git clone ${home} "${formData.arg0}"`,
                path: this.kernel.api.userdir
              }, (stream) => {
              })
              res.json({
                result: "success"
              })
            } else {
              res.json({
                error: "Required argument: clone destination folder name"
              })
            }
            return
          } else if (method === "pull") {
            // pull()
            if (cwd) {
              await this.kernel.bin.sh({
                message: `git pull`,
                path: cwd,
              }, (stream) => {
              })
            } else {
              res.json({
                error: "Couldn't resolve path"
              })
            }
            return
          } else if (method === "exists") {
            // exists()
            if (types.length === 0 || types.length === 1 && formData.arg0 === ".") {
              // fs.exists() or fs.exists(".")
              if (!cwd) {
                // doesn't exist
                res.json({ result: false })
                return
              }
            }
          }

          if (!cwd) {
            res.json({ error: `file system for ${home} does not exist yet. try fs.clone(<desired_folder_name>)` })
          }

        } else if (drive === "bin") {
          cwd = path.resolve(this.kernel.homedir, "bin", home)
        }


        if (cwd) {
          try {
            let result = await new Promise((resolve, reject) => {
              const child = fork(path.resolve(__dirname, "..", "worker.js"), null, { cwd })
              child.on('message', (message) => {
                if (message.hasOwnProperty("error")) {
                  reject(message.error)
                } else {
                  resolve(message.result);
                }
                child.kill()
              });
              child.send({
                method,
                args: deserializedArgs,
              })
            })
            res.json({result})
          } catch (e) {
            console.log("### e", e)
            res.json({ error: e })
          }
        } else {
          res.json({ error: "Missing attribute: drive" })
        }
      } else {
        res.json({ error: "Required attributes: path, method, types" })
      }

    }))
    this.app.get("/pinokio/requirements_ready", ex((req, res) => {
      let requirements_pending = !this.kernel.bin.installed_initialized
      res.json({ requirements_pending })
    }))
    this.app.get("/check_peer", ex((req, res) => {
      if (this.kernel.peer.active) {
        // if network is active, return success only if the router is up for all of its peers (including itself)
        console.log({ peer_info: this.kernel.peer.info })
        let ready = true
        if (this.kernel.peer.info && Object.keys(this.kernel.peer.info).length > 0) {
          for(let host in this.kernel.peer.info) {
            let info = this.kernel.peer.info[host]
            if (info.router && Object.keys(info.router).length > 0) {
              ready = true 
            } else {
              ready = false
              break;
            }
          }
        } else {
          ready = false;
        }
        console.log({ info: this.kernel.peer.info, ready })
        if (ready) {
          res.json({ success: true })
        } else {
          res.json({ success: false })
        }
      } else {
        // if network is not active, return success immediately (just checking if the server is up)
        console.log("this.kernel.router.published()")
        res.json({ success: true })
      }
    }))
    this.app.get("/check", ex((req, res) => {
      res.json({ success: true })
    }))
    this.app.post("/onrestart", ex(async (req, res) => {
      console.log("post /onrestart")
      if (this.onrestart) {
        console.log("onrestart exists")
        this.onrestart()
      } else {
        await this.start({ debug: this.debug, browser: this.browser })
        res.json({ success: true })
      }
    }))
    this.app.post("/restart", ex(async (req, res) => {
      console.log("post /restart")
      this.start({ debug: this.debug, browser: this.browser })
    }))
    this.app.post("/network", ex(async (req, res) => {
      if (this.kernel.homedir) {
        let fullpath = path.resolve(this.kernel.homedir, "ENVIRONMENT")
        console.log("POST /network", req.body)
        await Util.update_env(fullpath, req.body)
        res.json({ success: true })
      } else {
        res.json({ error: "homedir doesn't exist" })
      }
    }))

    this.app.post("/config", ex(async (req, res) => {
      try {
        let message = await this.setConfig(req.body)
        res.json({ success: true, message })
      } catch (e) {
        res.json({ error: e.stack })
      }

      // update homedir
    }))

    this.app.use((err, req, res, next) => {
      process.stdout.write("\r\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
      process.stdout.write("\r\n> ERROR\r\n")
      process.stdout.write(err.stack)
      process.stdout.write("\r\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\r\n")
      res.status(500).render("500", {
        install: this.install,
        stack: err.stack
      })
    });
    process.on('SIGINT', () => {
      //if (this.kernel && this.kernel.shell) {
      //  console.log("shell reset")
      //  this.kernel.shell.reset(() => {
      //    process.exit()
      //  })
      //} else {
      //  process.exit()
      //}
      console.log("[SigInt event] Kill", process.pid)
      if (this.kernel.processes.caddy_pid) {
        console.log("kill caddy", this.kernel.processes.caddy_pid)
        kill(this.kernel.processes.caddy_pid, "SIGKILL", true)
      }
      console.log("kill self")
      kill(process.pid, 'SIGKILL', true)
      //kill(process.pid, map, 'SIGKILL', () => {
      //  console.log("child procs killed for", process.pid)
      //  process.exit()
      //});
    })

    process.on('SIGTERM', () => {
//      if (this.kernel && this.kernel.shell) {
//        console.log("shell reset")
//        this.kernel.shell.reset(() => {
//          process.exit()
//        })
//      } else {
//        process.exit()
//      }
      console.log("[Sigterm event] Kill", process.pid)
      if (this.kernel.processes.caddy_pid) {
        console.log("kill caddy", this.kernel.processes.caddy_pid)
        kill(this.kernel.processes.caddy_pid, "SIGKILL", true)
      }
      console.log("kill self")
      kill(process.pid, 'SIGKILL', true)
      //let map = this.kernel.processes.map || {}
      //kill(process.pid, map, 'SIGKILL', () => {
      //  console.log("child procs killed for", process.pid)
      //  process.exit()
      //});
    })
//    process.on('exit', () => {
//      console.log("[Exit event]")
//      kill(process.pid, 'SIGKILL', true)
//      //let map = this.kernel.processes.map || {}
//      //kill(process.pid, map, 'SIGKILL', () => {
//      //  console.log("child procs killed for", process.pid)
//      //  process.exit()
//      //});
//    })
//    process.on('exit', () => {
//      console.log("exit Event")
//      if (this.kernel && this.kernel.shell) {
//        console.log("this.kernel.shell.reset")
//        this.kernel.shell.reset()
//      }
//      process.exit()
//    })


    // install
    this.server = httpserver.createServer(this.app);
    this.socket = new Socket(this)
    await new Promise((resolve, reject) => {
      this.listening = this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}`)
        this.kernel.server_running = true
        resolve()
      });
      this.httpTerminator = createHttpTerminator({
        server: this.listening
      });
    })
//    this.kernel.peer.start(this.kernel)


  }
}
module.exports = Server
