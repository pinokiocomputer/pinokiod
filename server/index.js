const express = require('express');
const mime = require('mime-types')
const httpserver = require('http');
const cors = require('cors');
const path = require("path")
const fs = require('fs');
const os = require('os')
const { fork } = require('child_process');

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const marked = require('marked')
const multer = require('multer');

const Socket = require('./socket')
const Kernel = require("../kernel")
class Server {
  constructor(config) {
    this.agent = config.agent
    this.port = config.port
    this.kernel = new Kernel(config.store)
    this.upload = multer();
  }
  stop() {
    this.server.close()
  }
  exists (s) {
    return new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))
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
    let p = "/api"
    let paths = [{
      name: "<img class='icon' src='/pinokio-black.png'>",
      //name: '<i class="fa-solid fa-circle"></i>',
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
    for(let pathComponent of pathComponents) {
      p = p + "/" + pathComponent
      //let pn = (pathComponent.startsWith("0x") ? Buffer.from(pathComponent.slice(2), "hex").toString() : "/ " + pathComponent)
      let pn =  "/ " + pathComponent
      paths.push({
        //name: "/ " + pathComponent,
        name: pn,
        path: p
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
      res.render("download", {
        agent: this.agent,
        userdir: this.kernel.api.userdir,
        display: ["form"],
        query: req.query
      })
    } else if (pathComponents.length === 0 && req.query.mode === "settings") {
      let configArray = [{
        key: "home",
        val: this.kernel.store.get("home"),
        placeholder: "Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)"
      }]
      res.render("settings", {
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
//          console.log("######### E", e)
        }
      }
      if (filepath.endsWith(".js")) {
        try {
          js = (await this.kernel.loader.load(filepath)).resolved
          mod = true
        } catch (e) {
//          console.log("######### E", e)
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
        if (typeof runner === "function") {
          let r
          if (runner.constructor.name === "AsyncFunction") {
            r = await runner(this.kernel)
          } else {
            r = runner(this.kernel)
          }
          runnable = r && r.run ? true : false
        } else {
          runnable = runner && runner.run ? true : false
        }

        let template
        if (req.query && req.query.mode === "source") {
          if (req.query && req.query.fullscreen) {
            template = "fullscreen_editor"
          } else {
            template = "editor"
          }
        } else if (schemaPath && schemaPath.length > 0) {
          template = "form"
        } else {
          if (req.query && req.query.fullscreen) {
            template = "fullscreen_editor"
          } else {
            template = "editor"
          }
        }

        res.render(template, {
          run: (req.query && req.query.run ? true : false),
          pinokioPath,
          runnable,
          agent: this.agent,
          rawpath,
          gitRemote,
          filename,
          filepath,
          schemaPath,
          uri,
          mod,
          json,
          js,
          content,
          paths,
        })
      } else {
        res.render("frame", {
          agent: this.agent,
          rawpath: rawpath + "?frame=true",
          paths,
          filepath
        })
      }
    } else if (stat.isDirectory()) {
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
              baseUrl: req.originalUrl + "/"
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

              for(let i=0; i<config.menu.length; i++) {
                let item = config.menu[i]
                if (item.href && !item.href.startsWith("http")) {
                  let absolute = path.resolve(__dirname, ...pathComponents, item.href)
                  let seed = path.resolve(__dirname)
                  let p = absolute.replace(seed, "")
                  let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
                  config.menu[i].href = "/api/" + link
                }
              }

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

      if (pathComponents.length === 0) {
        for(let i=0; i<items.length; i++) {
          let item = items[i]
          let p = path.resolve(uri, item.name, "pinokio.js")
          let config  = (await this.kernel.loader.load(p)).resolved
          if (config && config.menu) {
            if (typeof config.menu === "function") {
              if (config.menu.constructor.name === "AsyncFunction") {
                config.menu = await config.menu(this.kernel)
              } else {
                config.menu = config.menu(this.kernel)
              }
            }

            for(let i=0; i<config.menu.length; i++) {
              let menuitem = config.menu[i]
              if (menuitem.href && !menuitem.href.startsWith("http")) {
                let absolute = path.resolve(__dirname, ...pathComponents, menuitem.href)
                let seed = path.resolve(__dirname)
                let p = absolute.replace(seed, "")
                let link = p.split(/[\/\\]/).filter((x) => { return x }).join("/")
                config.menu[i].href = "/api/" + item.name + "/" + link
              }
            }
            items[i].menu = config.menu
          }
        }
      }

      res.render("index", {
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
              icon = "/pinokio-black.png"
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
            url: p + "/" + x.name
          }
        }),
        readme,
        filepath,
      })
    }
  }
  async start() {
    await this.kernel.init()
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
    this.app.get("/", async (req, res) => {
      if (this.kernel.bin.all_installed) {
        //this.startScripts = await this.kernel.api.startScripts()
        //if (this.started) {
        //  //await this.render(req, res, [])
        //  if (this.kernel.api.counter >= this.startScripts.length) {
        //    // get all the metadata
        //    // 1. get all the folders
        //    // 2. look at pinokio.js for each
        //    // 3. create an object
        //    let apipath = this.kernel.path("api")
        //    let files = await fs.promises.readdir(apipath, { withFileTypes: true })
        //    let folders = files.filter((f) => {
        //      return f.isDirectory()
        //    }).map((x) => {
        //      return x.name
        //    })
        //    let meta = {}
        //    for(let folder of folders) {
        //      let p = path.resolve(apipath, folder, "pinokio.js")
        //      let pinokio = (await this.kernel.loader.load(p)).resolved
        //      if (pinokio) {
        //        meta[folder] = {
        //          title: pinokio.title,
        //          description: pinokio.description,
        //          icon: pinokio.icon ? `/api/${folder}/${pinokio.icon}?raw=true` : null
        //        }
        //      }
        //    }
        //    await this.render(req, res, [], meta)
        //  } else {
        //    res.render("launch", {
        //      agent: this.agent,
        //    })
        //  }
        //} else {
        //  this.started = true
        //  res.render("launch", {
        //    agent: this.agent,
        //  })
        //  // display start scripts for all installed modules
        //}
        this.started = true
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
      } else {
        // get all the "start" scripts from pinokio.json
        // render installer page
        this.started = true
        res.render("bootstrap", {
          agent: this.agent,
        })
      }
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
    this.app.get("/api/*", async (req, res) => {
      let pathComponents = req.params[0].split("/")
      try {
        await this.render(req, res, pathComponents)
      } catch (e) {
        res.status(404).send(e.message)
      }
    })
    this.app.get("/pinokio/port", async (req, res) => {
      let port = await this.kernel.port()
      res.json({ result: port })
    })
    this.app.get("/pinokio/download", (req, res) => {
      let queryStr = new URLSearchParams(req.query).toString()
      res.redirect("/?mode=download&" + queryStr)
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
    this.app.post("/config", async (req, res) => {

      // get the existing homedir
      let existingHome = this.kernel.homedir

      // update the pinokio.json file
      if (req.body.home && req.body.home.length > 0) {
        const basename = path.basename(req.body.home)
        let isValidPath = (basename !== '' && basename !== req.body.home);
        if (isValidPath) {
          // move the existing home directory to the new home directory

          this.kernel.store.set("home", req.body.home)
          await fs.promises.rename(existingHome, req.body.home)
          res.json({ success: true })
        } else {
          res.json({ error: "invalid filepath" })
        }
      } else {
        // if the home directory is empty, remove the home attribute, and move the existing home to the homedir
        this.kernel.store.set("home", null)
//        let configFile = path.resolve(__dirname, "..", "kernel", "pinokio.json")
//        await fs.promises.writeFile(configFile, JSON.stringify(req.body, null, 2))
        let defaultHome = path.resolve(os.homedir(), "pinokio")
        await fs.promises.rename(existingHome, defaultHome)
        res.json({ success: true })
      }
      // update homedir
    })
    // install
    this.server = httpserver.createServer(this.app);
    this.socket = new Socket(this)
    await new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}`)
        resolve()
      });
    })
  }
}
module.exports = Server
