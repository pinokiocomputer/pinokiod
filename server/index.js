const express = require('express');
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
const gepeto = require('gepeto')
const { fork } = require('child_process');
const semver = require('semver')
const fse = require('fs-extra')

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const marked = require('marked')
const multer = require('multer');
//const localtunnel = require('localtunnel');
//const ngrok = require("@ngrok/ngrok");

const ejs = require('ejs');




const Socket = require('./socket')
const Kernel = require("../kernel")
const packagejson = require("../package.json")
class Server {
  constructor(config) {
    this.tabs = {}
    this.agent = config.agent
    this.port = config.port
    this.kernel = new Kernel(config.store)
//    this.tunnels = {}
    this.version = {
      pinokiod: packagejson.version,
      pinokio: config.version
    }
    this.kernel.version = this.version
    this.upload = multer();

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

  }
  stop() {
    this.server.close()
  }
  exists (s) {
    return new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))
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
    }
  }
  getMemory(filepath) {
    console.log("memory", this.kernel.memory.local)
    console.log("filepath", filepath)
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
      //let name = (x.name.startsWith("0x") ? Buffer.from(x.name.slice(2), "hex").toString() : x.name)
      let name
      let description
      let icon
      let uri
      if (meta) {
        let m = meta[x.name]
        name = (m && m.title ? m.title : x.name)
        description = (m && m.description ? m.description : "")
        if (m && m.icon) {
          icon = m.icon
        } else {
          icon = null
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
        menu: x.menu,
        index: x.index,
        //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
        name,
        uri,
        //description: x.path,
        description,
        url: p + "/" + x.name,
        browser_url: "/pinokio/browser/" + x.name
      }
    })
  }
  async render(req, res, pathComponents, meta) {

    
    let full_filepath = this.kernel.path("api", ...pathComponents)

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
      name: '<i class="fa-solid fa-house"></i>',
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
        console.log("ERROR", e)
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


    let stat = await fs.promises.stat(filepath)
    if (pathComponents.length === 0 && req.query.mode === "explore") {
      res.render("explore", {
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

      let requirements = [{
        name: "conda",
      }, {
        name: "git",
      }, {
        name: "zip",
      }, {
        type: "conda",
        name: "nodejs",
        args: "-c conda-forge"
      }]
      let platform = os.platform()
      if (platform === "win32") {
        requirements.push({
          name: "registry"
        })
        requirements.push({
          name: "vs"
        })
      }
      let requirements_pending = !this.kernel.bin.installed_initialized


      let install_required = true
      if (!requirements_pending) {
        install_required = false
        for(let i=0; i<requirements.length; i++) {
          let r = requirements[i]
          let installed = await this.installed(r)
          requirements[i].installed = installed
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

      console.log({ install_required, requirements, requirements_pending })

      console.log("ERROR", error)

      res.render("download", {
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
      let configArray = [{
        key: "home",
        val: this.kernel.homedir,
        placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
      }, {
        key: "theme",
        val: this.theme,
        options: ["light", "dark"]
      }]
      console.log("agent", this.agent)
      res.render("settings", {
        version: this.version,
        logo: this.logo,
        theme: this.theme,
        agent: this.agent,
        paths,
        config: configArray,
        query: req.query
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
        let content = await fs.promises.readFile(filepath, "utf8")

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
        uri = path.resolve(this.kernel.api.userdir, ...pathComponents)

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
            resolved = await runner(this.kernel)
          } else {
            resolved = runner(this.kernel)
          }
          runnable = resolved && resolved.run ? true : false
        } else {
          runnable = runner && runner.run ? true : false
          resolved = runner
        }

        let template
        template = "fullscreen_editor"

        if (req.query && req.query.mode === "source") {
          template = "editor"
        }


// Deprecate source view and form view => Everything is full screen by default
//        if (req.query && req.query.mode === "source") {
//          if (req.query && req.query.fullscreen) {
//            template = "fullscreen_editor"
//          } else {
//            template = "editor"
//          }
//        } else if (schemaPath && schemaPath.length > 0) {
//          template = "form"
//        } else {
//          if (req.query && req.query.fullscreen) {
//            template = "fullscreen_editor"
//          } else {
//            template = "editor"
//          }
//        }

        let requirements = [{
          name: "conda",
        }, {
          name: "git",
        }, {
          name: "zip",
        }, {
          type: "conda",
          name: "nodejs",
          args: "-c conda-forge"
        }]
        let platform = os.platform()
        if (platform === "win32") {
          requirements.push({
            name: "registry"
          })
        }
        if (platform === "darwin") {
          requirements.push({
            name: "brew"
          })
        }
//        if (platform === "linux") {
//          requirements.push({
//            name: "brew"
//          })
//        }

        if (resolved && resolved.requires && resolved.requires.length > 0) {
          /*********************************************************************

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


          let platform = os.platform()
          let type_name_set = new Set()
          for(let r of resolved.requires) {
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
        let requirements_pending = !this.kernel.bin.installed_initialized

        let install_required = true
        if (!requirements_pending) {
          install_required = false
          for(let i=0; i<requirements.length; i++) {
            let r = requirements[i]

            let relevant = this.relevant(r)
            requirements[i].relevant = relevant
            if (relevant) {
              let installed = await this.installed(r)
              requirements[i].installed = installed
              if (!installed) {
                install_required = true
              }
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

        requirements = requirements.filter((r) => {
          return r.relevant
        })

        console.log("#filepath", filepath)


        console.log({ filepath, })
        let mem = this.getMemory(filepath)
//        let localMem = this.kernel.memory.local[filepath]
//        let globalMem = this.kernel.memory.global[filepath]
//
//        let mem = []
//        let localhosts = ["localhost", "127.0.0.1", "0.0.0.0"]
//        for(let key in localMem) {
//          let val = localMem[key]
//          // check for localhost url
//          let localhost = false
//          let tunnel
//          try {
//            let url = new URL(val)
//            if (localhosts.includes(url.hostname)) {
//              localhost = true
//              if (this.tunnels[val]) {
//                tunnel = this.tunnels[val].url
//              }
//            }
//          } catch (e) { }
//          mem.push({
//            type: "local",
//            key,
//            val,
//            tunnel,
//            localhost,
//          })
//        }
//        for(let key in globalMem) {
//          let val = globalMem[key]
//          let localhost = false
//          let tunnel
//          try {
//            let url = new URL(val)
//            if (localhosts.includes(url.hostname)) {
//              localhost = true
//              if (this.tunnels[val]) {
//                tunnel = this.tunnels[val].url
//              }
//            }
//          } catch (e) { }
//          mem.push({
//            type: "global",
//            key,
//            val,
//            tunnel,
//            localhost,
//          })
//        }
        console.log("mem", mem)
        console.log("originalUrl", req.originalUrl)
        let edu = new URL("http://localhost" + req.originalUrl)
        edu.searchParams.set("mode", "source")
        let editorUrl = edu.pathname + edu.search
        console.log("editorUrl", editorUrl)
        console.log("req.query", req.query)




        const result = {
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
        }
        console.log("RESULT", result)


        res.render(template, result)
      } else {
        res.render("frame", {
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
                  config.menu = await config.menu(this.kernel)
                } else {
                  config.menu = config.menu(this.kernel)
                }
              }

              await this.renderMenu(filepath.replace("/" + pathComponents[0], ""), pathComponents[0], config, pathComponents.slice(1))
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
                  config.update = await config.update(this.kernel)
                } else {
                  config.update = config.update(this.kernel)
                }
              }
              let absolute = path.resolve(__dirname, ...pathComponents, config.update)
              let seed = path.resolve(__dirname)
              let p = absolute.replace(seed, "")
              let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
              config.update = "/api/" + link
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
            if (config.version) {
              let coerced = semver.coerce(config.version)
              console.log("version", { coerced, v: config.version })
              if (semver.satisfies(coerced, this.kernel.schema)) {
                console.log("semver satisfied", config.version, this.kernel.schema)
              } else {
                console.log("semver NOT satisfied", config.version, this.kernel.schema)
                error = `Please update Pinokio to the latest version (current script version: ${config.version}, supported: ${this.kernel.schema}`
              }
            }
            /*
            if (config.pinokiod) {
              // if the script contains a 'pinokiod' field, compare it against the current version
              // if the current version satisfies the pinokiod field, move forward
              // otherwise display an "upgrade" message
              if (semver.satisfies(this.version.pinokiod, config.pinokiod)) {
                console.log("semver satisfied", this.version.pinokiod, config.pinokiod)
              } else {
                console.log("semver NOT satisfied", this.version.pinokiod, config.pinokiod)
                error = `Please update Pinokio to the latest version (current pinokiod: ${this.version.pinokiod}, required: ${config.pinokiod}`
              }
            }
            */
            if (config.menu) {
              if (typeof config.menu === "function") {
                if (config.menu.constructor.name === "AsyncFunction") {
                  config.menu = await config.menu(this.kernel)
                } else {
                  config.menu = config.menu(this.kernel)
                }
              }

              await this.renderMenu(uri, item.name, config, pathComponents)

              items[i].menu = config.menu
            }
          }


          // check if there is a running process with this folder name
          let runningApps = new Set()
          for(let key in this.kernel.api.running) {
            let re = new RegExp(item.name)
            if (re.test(key)) {
              items[i].running = true
              items[i].index = index
              index++;
              running.push(items[i])
              break
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

      // items




 //     let U = `${_p}/${pathComponents.join("/")}`
 //     console.log("*******", { filepath, pathComponents, U })


      res.render("index", {
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
        items: items.map((x) => {
          //let name = (x.name.startsWith("0x") ? Buffer.from(x.name.slice(2), "hex").toString() : x.name)
          let name
          let description
          let icon
          let uri
          if (meta) {
            let m = meta[x.name]
            name = (m && m.title ? m.title : x.name)
            description = (m && m.description ? m.description : "")
            if (m && m.icon) {
              icon = m.icon
            } else {
              icon = null
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
            menu: x.menu,
            //icon: (x.isDirectory() ? "fa-solid fa-folder" : "fa-regular fa-file"),
            name,
            uri,
            //description: x.path,
            description,
            //url: p + "/" + x.name,
            url: _p + "/" + x.name,
//            url: `${U}/${x.name}`,
            browser_url: "/pinokio/browser/" + x.name
          }
        }),
      })
    }
  }
  async renderMenu(uri, name, config, pathComponents) {
    if (config.menu) {
      for(let i=0; i<config.menu.length; i++) {
        let menuitem = config.menu[i]

        if (menuitem.menu) {
          let m = await this.renderMenu(uri, name, { menu: menuitem.menu }, pathComponents)
          menuitem.menu = m.menu
        }


        if (menuitem.href && !menuitem.href.startsWith("http")) {

          // href resolution
          let absolute = path.resolve(__dirname, ...pathComponents, menuitem.href)
          let seed = path.resolve(__dirname)
          let p = absolute.replace(seed, "")
          let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
          config.menu[i].href = "/api/" + name + "/" + link
        }

        if (menuitem.href && menuitem.params) {
          menuitem.href = menuitem.href + "?" + new URLSearchParams(menuitem.params).toString();
        }

        if (menuitem.href) {
          let u
          if (menuitem.href.startsWith("http")) {
            menuitem.src = menuitem.href
          } else if (menuitem.href.startsWith("/")) {
            u = new URL("http://localhost" + menuitem.href)
            u.search = ""
            menuitem.src = u.pathname
          } else {
            u = new URL("http://localhost/" + menuitem.href)
            u.search = ""
            menuitem.src = u.pathname
          }


          // check running
          let fullpath = this.kernel.path(menuitem.src.slice(1))
          if (this.kernel.api.running[fullpath]) {
            menuitem.running = true
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

            console.log("processing", menuitem)

            if (menuitem.hasOwnProperty("icon")) {
              menuitem.html = `<i class="${menuitem.icon}"></i> ${menuitem.text}` 
            } else {
              menuitem.html = `${menuitem.text}` 
            }

            if (menuitem.href) {
              // button
              config.menu[i].btn = menuitem.html
            } else if (menuitem.menu) {
              config.menu[i].btn = menuitem.html
            } else {
              // label
              config.menu[i].label = menuitem.html
            }
          }
        }
      }
      config.menu = config.menu.filter((item) => {
        return item.btn
      })
      console.log("config", JSON.stringify(config,null,2))
      return config
    } else {
      return config
    }
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
  async _installed(name, type) {
    if (type === "conda") {
      return this.kernel.bin.installed.conda.has(name)
    } else if (type === "pip") {
      return this.kernel.bin.installed.pip.has(name)
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
    console.log("sudo_exec", { message, homedir })
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

  async syncConfig() {
    // 1. THEME
    this.theme = this.kernel.store.get("theme") || "light"
    if (this.theme === "dark") {
      this.colors = {
        color: "rgb(31, 29, 39)",
        symbolColor: "#b7a1ff"
      }
    } else {
      this.colors = {
        color: "white",
//        color: "#F5F4FA",
        symbolColor: "black",
      }
    }
    //this.logo = (this.theme === 'dark' ?  "<img class='icon' src='/pinokio-white.png'>" : "<img class='icon' src='/pinokio-black.png'>")
    this.logo = '<i class="fa-solid fa-house"></i>'

    // 4. existing home is set + new home is set + existing home does NOT exist => delete the "home" field and DO NOT go through with the move command
    // 5. existing home is NOT set + new home is set => go through with the "home" setting procedure
    // 6. existing home is NOT set + new home is NOT set => don't touch anything => the homedir will be the default home

    // 2. HOME
    // 2.1. Check if the config includes NEW_HOME => if so,
    //    - move the HOME folder to NEW_HOME
    //    - set HOME=NEW_HOME
    //    - remove NEW_HOME
    let existing_home = this.kernel.store.get("home")
    let new_home = this.kernel.store.get("new_home")
    console.log("syncConfig", { existing_home, new_home })

    if (existing_home) {
      let exists = await fse.pathExists(existing_home)
      console.log("#A", { exists })
      if (exists) {
        console.log("#B", { new_home })
        if (new_home) {
          let new_home_exists = await fse.pathExists(new_home)
          console.log("#C", { new_home_exists })
          if (new_home_exists) {
            console.log("#D")
            // - existing home is set
            // - existing home exists
            // - new home is set
            // - new home exists already
            //    => delete store.new_home ==> will load at store.home
            this.kernel.store.delete("new_home")
          } else {
            console.log("#E")
            // - existing home is set
            // - existing home exists
            // - new home is set
            // - new home does not exist
            //    => run mv()
            //    => update store.home
            //    => delete store.new_home
            await this.mv(existing_home, new_home)
            this.kernel.store.set("home", new_home)
            this.kernel.store.delete("new_home")
          }
        } else {
          console.log("#F")
          // - existing home is set
          // - existing home exists
          // - new home is not set
          //    => This is most typical scenario => don't touch anything => the homedir will be the existing home
        }
      } else {
        console.log("#G", { new_home })
        if (new_home) {
          console.log("#H")
          // - existing home is set
          // - but the existing home path DOES NOT exist
          // - new home is set
          //    => This is an invalid scenario => Just to avoid disaster, just delete store.home and delete store.new_home
          //    => the app will load at ~/pinokio
          this.kernel.store.delete("home")
          this.kernel.store.delete("new_home")
        } else {
          console.log("#I")
          // - existing home is set
          // - but the existing home path DOES NOT exist
          // - new home is NOT set
          //    => This is an invalid scenario => just delete store.home
          //    => the app will load at ~/pinokio
          this.kernel.store.delete("home")
        }
      }
    } else {
      console.log("#J", { new_home })
      if (new_home) {
        console.log("#K")
        // - existing home is NOT set
        // - new home is set
        //    => update store.home
        //    => delete store.new_home
        this.kernel.store.set("home", new_home)
        this.kernel.store.delete("new_home")
      } else {
        console.log("#L")
        // - existing home is NOT set
        // - new home is NOT set
        //    => don't touch anything => will load at ~/pinokio
      }
    }
  }
  async setConfig(config) {
    console.log("setConfig", config)
    let home = this.kernel.store.get("home")
    let theme = this.kernel.store.get("theme")
    console.log("before setting config", { home, theme })

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

        // check if the destination already exists => throw error
        let exists = await fse.pathExists(config.home)
        if (exists) {
          throw new Error(`The path ${config.home} already exists. Please remove the folder and retry`)
        }

        console.log("set new home", config.home)

        this.kernel.store.set("new_home", config.home)
      }

    }

    home = this.kernel.store.get("home")
    theme = this.kernel.store.get("theme")
    let new_home = this.kernel.store.get("new_home")
    console.log("after setting config", { home, theme, new_home })
  }
  async startLogging() {
    if (!this.debug) {
      if (this.logInterval) {
        clearInterval(this.logInterval)
      }
      if (this.kernel.homedir) {
        let exists = await this.exists(this.kernel.homedir)
        if (exists) {
          let logsdir = path.resolve(this.kernel.homedir, "logs")
          await fs.promises.mkdir(logsdir, { recursive: true }).catch((e) => { })
          if (!this.log) {
            this.log = fs.createWriteStream(path.resolve(this.kernel.homedir, "logs/stdout.txt"))
            process.stdout.write = process.stderr.write = this.log.write.bind(this.log)
            process.on('uncaughtException', (err) => {
              console.error((err && err.stack) ? err.stack : err);
            });
            this.logInterval = setInterval(async () => {
              let file = path.resolve(this.kernel.homedir, "logs/stdout.txt")
              let data = await fs.promises.readFile(file, 'utf8')
              let lines = data.split('\n')
              if (lines.length > 100000) {
                let str = lines.slice(-100000).join("\n")
                await fs.promises.writeFile(file, str)
              }
            }, 1000 * 60 * 10)  // 10 minutes
          }
        }
      }
    }
  }
  async start(debug) {


    this.debug = debug

    console.log("start called", this.listening, debug)

    if (this.listening) {
      console.log("close server")
      console.log("terminate start")
      await this.httpTerminator.terminate();
      console.log("terminate end")
    }

    // configure from kernel.store
    await this.syncConfig()

    // initialize kernel
    await this.kernel.init()

    console.log("homedir", this.kernel.homedir)


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
    await this.startLogging()

    

    //await this.configure()


    this.started = false
    this.app = express();
    this.app.use(cors({
      origin: '*'
    }));

    this.app.use(express.static(path.resolve(__dirname, 'public')));
    this.app.use("/web", express.static(path.resolve(__dirname, "..", "..", "web")))
    this.app.set('view engine', 'ejs');
    this.app.set("views", path.resolve(__dirname, "views"))
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use(cookieParser());
    this.app.use(session({secret: "secret" }))

    //let home = this.kernel.homedir
    let home = this.kernel.store.get("home")
    this.app.get("/", async (req, res) => {
      console.log("### req.headers", req.headers)

      console.log({ mode: req.query.mode, home, homeempty: !home })
      if (req.query.mode !== "settings" && !home) {
        console.log("settings")
        res.redirect("/?mode=settings")
        return


      }
      if (req.query.mode === 'settings') {
        let configArray = [{
          key: "home",
          val: this.kernel.homedir ? this.kernel.homedir : path.resolve(os.homedir(), "pinokio"),
          placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
        }, {
          key: "theme",
          val: this.theme,
          options: ["light", "dark"]
        }]
        console.log("agent", this.agent)
        res.render("settings", {
          version: this.version,
          logo: this.logo,
          theme: this.theme,
          agent: this.agent,
          paths: [],
          config: configArray,
          query: req.query
        })

        return
      }
      console.log("abc")

      let apipath = this.kernel.path("api")
      let files = await fs.promises.readdir(apipath, { withFileTypes: true })
      let folders = files.filter((f) => {
        return f.isDirectory()
      }).map((x) => {
        return x.name
      })
      let meta = {}
      for(let folder of folders) {
        let p = path.resolve(apipath, folder, "pinokio.js")
        let pinokio = (await this.kernel.loader.load(p)).resolved
        if (pinokio) {
          meta[folder] = {
            title: pinokio.title,
            description: pinokio.description,
            icon: pinokio.icon ? `/api/${folder}/${pinokio.icon}?raw=true` : null
          }
        }
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
    })
    this.app.get("/script/:name", (req, res) => {
      if (req.params.name === "start") {
        res.json(this.startScripts)
      }
    })
    this.app.get("/raw/*", (req, res) => {
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
    })
    this.app.get("/_api/*", async (req, res) => {
      let pathComponents = req.params[0].split("/")
      req.query.mode = "source"
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    })
    this.app.get("/api/*", async (req, res) => {
      let pathComponents = req.params[0].split("/")
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    })
    this.app.get("/pinokio/sidebar/:name", async (req, res) => {
      let name = req.params.name
      let app_path = this.kernel.path("api", name, "pinokio.js")
      let rawpath = "/api/" + name
      let config  = (await this.kernel.loader.load(app_path)).resolved
      if (config && config.menu) {
        if (typeof config.menu === "function") {
          if (config.menu.constructor.name === "AsyncFunction") {
            config.menu = await config.menu(this.kernel)
          } else {
            config.menu = config.menu(this.kernel)
          }
        }

        let uri = this.kernel.path("api")
        await this.renderMenu(uri, name, config, [])

        console.log({ config })
      }


      ejs.renderFile(path.resolve(__dirname, "views/partials/menu.ejs"), { menu: config.menu }, (err, html) => {
        console.log("html", html)
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

    })
    this.app.get("/pinokio/memory", (req, res) => {
      let filepath = req.query.filepath
      let mem = this.getMemory(filepath)
      res.json(mem)
    })
//    this.app.post("/pinokio/tunnel", async (req, res) => {
//      let port
//      let local_host
//      try {
//        let u = new URL(req.body.url)
//        port = u.port
//        local_host = u.hostname
//        console.log({ local_host, port })
//        if (req.body.action === "start") {
//          // Output ngrok url to console
//
//          let url = req.body.url
//          console.log("tunnel", req.body)
//          const tunnel = await ngrok.forward({ addr: port, authtoken: req.body.token });
//          console.log("created", tunnel)
//          console.log("url", tunnel.url())
//          this.tunnels[url] = tunnel
//          res.json({ url: tunnel.url() })
//
//
//          // localtunnel
//          //const tunnel = await localtunnel({ local_host, port: parseInt(port) });
//          //const tunnel = await localtunnel({ local_host: "127.0.0.1", port: parseInt(port) });
//
//          //const tunnel = await localtunnel({ port: parseInt(port) });
//          //this.tunnels[url] = tunnel
//          //tunnel.on('error', (err) => {
//          //  console.log(err)
//          //  delete this.tunnels[url]
//          //})
//          //tunnel.on('close', () => {
//          //  // tunnels are closed
//          //  console.log("tunnel closed", { url, tunnel_url: tunnel.url })
//          //  delete this.tunnels[url]
//          //});
//          //res.json({ url: tunnel.url })
//        } else if (req.body.action === "stop") {
//          let url = req.body.url
//          await this.tunnels[url].close()
//          delete this.tunnels[url]
//          res.json({ url })
////          let url = req.body.url
////          console.log({ tunnels: this.tunnels, url })
////          this.tunnels[url].close()
////          res.json({ url })
//        }
//      } catch (e) {
//        console.log("ERROR", e)
//        res.json({ error: e.message })
//      }
//    })
    this.app.post("/pinokio/tabs", async (req, res) => {
      this.tabs[req.body.name] = req.body.tabs
      res.json({ success: true })
    })
    this.app.get("/pinokio/browser/:name", async (req, res) => {
      let name = req.params.name
      let app_path = this.kernel.path("api", name, "pinokio.js")
      let rawpath = "/api/" + name
      let config  = (await this.kernel.loader.load(app_path)).resolved
      if (config && config.menu) {
        if (typeof config.menu === "function") {
          if (config.menu.constructor.name === "AsyncFunction") {
            config.menu = await config.menu(this.kernel)
          } else {
            config.menu = config.menu(this.kernel)
          }
        }

        let uri = this.kernel.path("api")
        await this.renderMenu(uri, name, config, [])

        console.log({ config })

      }



      console.log("MEMORY", this.kernel.memory)
      res.render("browser", {
        running:this.kernel.api.running,
        memory: this.kernel.memory,
        sidebar: "/pinokio/sidebar/" + name,
        name,
        tabs: (this.tabs[name] || []),
        config,
//        sidebar_url: "/pinokio/sidebar/" + name,
        home: req.originalUrl,
//        paths,
        theme: this.theme,
        agent: this.agent,
        src: "/_api/" + name,
        rawpath
      })
    })
//    this.app.get("/pinokio/shell_state", (req, res) => {
//      let states = this.kernel.shell.shells.map((s) => {
//        return {
//          state: s.state,
//          id: s.id,
//          group: s.group,
//          env: s.env,
//          path: s.path,
//          cmd: s.cmd,
//          done: s.done,
//          ready: s.ready,
//        }
//      })
//
//      let info = {
//        platform: this.kernel.platform,
//        arch: this.kernel.arch,
//        running: this.kernel.api.running,
//        home: this.kernel.homedir,
//        vars: this.kernel.vars,
//        memory: this.kernel.memory,
//        procs: this.kernel.procs,
//        gpu: this.kernel.gpu,
//        gpus: this.kernel.gpus
//      }
//    })
    this.app.get("/pinokio/logs.zip", (req, res) => {
      let zipPath = this.kernel.path("logs.zip")
      console.log("sendFile", zipPath)
      res.download(zipPath)
    })
    this.app.post("/pinokio/log", async (req, res) => {


      console.log("#1")

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
        version: this.version
      }
      console.log("# info", info)

      console.log("#2")
      await fs.promises.writeFile(this.kernel.path("logs/system.json"), JSON.stringify(info, null, 2))
      console.log("#3")
      await fs.promises.writeFile(this.kernel.path("logs/state.json"), JSON.stringify(states, null, 2))


      console.log("#4")
      await fs.promises.cp(
        this.kernel.path("logs"),
        this.kernel.path("exported_logs")
      , { recursive: true })
      console.log("#5")
      await this.kernel.shell.logs()
      console.log("#6")


      let folder = this.kernel.path("exported_logs")
      let zipPath = this.kernel.path("logs.zip")
      await compressing.zip.compressDir(folder, zipPath)
      console.log("#7")
      res.json({ success: true })
    })
    this.app.get("/pinokio/port", async (req, res) => {
      let port = await this.kernel.port()
      res.json({ result: port })
    })
    this.app.get("/pinokio/download", (req, res) => {
      let queryStr = new URLSearchParams(req.query).toString()
      res.redirect("/?mode=download&" + queryStr)
    })
    this.app.post("/pinokio/install", (req, res) => {
      req.session.requirements = req.body.requirements
      req.session.callback = req.body.callback
      res.redirect("/pinokio/install")
    })
    this.app.get("/pinokio/install", (req, res) => {
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
    })
    this.app.get("/pinokio", (req, res) => {
      // parse the uri & path
      let {uri, ...query} = req.query
      let querystring = new URLSearchParams(query).toString()
      let webpath = this.kernel.api.webPath(req.query.uri)
      if (querystring && querystring.length > 0) {
        webpath = webpath + "?" + querystring
      }
      res.redirect(webpath)
    })
    /*
      SYNTAX
      fs.uri(<bin|api>, path)

      EXAMPLES
      fs.uri("api", "sfsdfs")
      fs.uri("api", "https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png")
      fs.uri("bin", "python/bin")

      1. Git URI: http://localhost:4200/pinokio/fs?drive=api&path=https://github.com/cocktailpeanut/llamacpp.pinokio.git/icon.png
      2. Local path: http://localhost:4200/pinokio/fs?drive=api&path=test/icon.png
    */
    this.app.get("/pinokio/fs", (req, res) => {
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
    })
    this.app.post("/pinokio/fs", this.upload.any(), async (req, res) => {
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

    })
    this.app.get("/pinokio/requirements_ready", (req, res) => {

      let requirements_pending = !this.kernel.bin.installed_initialized
      console.log({ requirements_pending })
      res.json({ requirements_pending })
    })
    this.app.get("/check", (req, res) => {
      res.json({ success: true })
    })
    this.app.post("/gepeto", async (req, res) => {
      try {
        await gepeto(path.resolve(this.kernel.homedir, "api", req.body.name))
      } catch (e) {
        console.log("gepeto error", e)
      }
      res.json({ success: true })
    })
    this.app.post("/restart", async (req, res) => {
      console.log("post /restart")
      this.start(this.debug)
    })
    this.app.post("/config", async (req, res) => {
      console.log("/config", { body: req.body })
      try {
        await this.setConfig(req.body)
        res.json({ success: true })
      } catch (e) {
        res.json({ error: e.stack })
      }

      // update homedir
    })
    // install
    this.server = httpserver.createServer(this.app);
    this.socket = new Socket(this)
    await new Promise((resolve, reject) => {
      this.listening = this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}`)
        resolve()
      });
      this.httpTerminator = createHttpTerminator({
        server: this.listening
      });
    })
  }
}
module.exports = Server
