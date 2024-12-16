const fs = require('fs')
const os = require('os')
const path = require('path')
const _ = require('lodash')
const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')
const Lproxy = require('../lproxy')
//const { glob, globSync, globStream, globStreamSync, Glob, } = require('glob')
const { glob, sync, hasMagic } = require('glob-gitignore')
const fastq = require('fastq')
const Loader = require("../loader")
const Environment = require("../environment")
const Util = require('../util')

class Api {
  constructor(kernel) {
    this.kernel = kernel
    this.gitPath = {}
    this.loader = new Loader()
    this.queues = {}
    this.listeners = {}
    this.counter = 0;
    this.running = {}
    this.done = {}
    this.waiter = {}
    this.proxies = {}
    this.lproxy = new Lproxy()
  }
  get_proxy_url(root, port) {
    if (this.proxies) {
      let proxies = this.proxies[root]
      if (proxies) {
        let filtered = proxies.filter((p) => {
          let re = new RegExp(":"+port+"$")
          return re.test(p.target)
        })
        if (filtered.length > 0) {
          return filtered[0].proxy
        }
      }
    }
    return `http://localhost:${port}`
  }
  checkProxy(config) {
    // if config.name exists, throw error
    // if config.uri exists, throw error
    for(let scriptPath in this.proxies) {
      let proxies = this.proxies[scriptPath]
      for(let p of proxies) {
        if (p.target === config.uri) {
          throw new Error(`A proxy for the uri ${config.uri} already exists`)
        }
      }
    }
  }
  async startProxy(scriptPath, uri, name, options) {
    this.checkProxy({ uri, name })
    // if the name exists, throw error
    // if the uri exists, throw error
    let proxy_uri = await this.lproxy.start(uri, options)
    if (this.proxies[scriptPath]) {
      this.proxies[scriptPath].push({ target: uri, proxy: proxy_uri, name})
    } else {
      this.proxies[scriptPath] = [{ target: uri, proxy: proxy_uri, name }]
    }
    return {
      target: uri,
      proxy: proxy_uri
    }
  }
  stopProxy(config) {
    if (config.script) {
      // stop all proxies for the script
      if (this.proxies[config.script]) {
        for(let p of this.proxies[config.script]) {
          this.stopProxy({ uri: p.target })
        }
      }
    } else if (config.uri) {

      // stop the proxy
      this.lproxy.stop(config.uri)

      // remove the uri from the proxies array
      for(let scriptPath in this.proxies) {
        let p = this.proxies[scriptPath]
        // iterate through p and find the one whose target matches config.uri
        // and remove it
        this.proxies[scriptPath] = this.proxies[scriptPath].filter((item) => {
          return item.target !== config.uri
        })
      }
    }
  }
  async init() {
    if (this.kernel.homedir) {
      this.userdir = path.resolve(this.kernel.homedir, "api")
      await fs.promises.mkdir(this.userdir, { recusrive: true, }).catch((e) => { })
      await this.linkGit()
    }
  }
  respond(req) {
    let requestPath = this.filePath(req.uri)
    if (this.waiter[requestPath]) {
      this.waiter[requestPath].resolve(req.response)
      delete this.waiter[requestPath]
    }
  }
  wait(scriptPath) {
    // need to reject if everything fails
    return new Promise((resolve, reject) => {
      this.waiter[scriptPath] = { resolve, reject }
    })
  }
  async run(endpoint, rpc, ondata) {
    let result = await endpoint(rpc, ondata, this.kernel)
    return result
  }
  async stop(req, ondata) {
    // 1. set the "stop" flag for the uri, so the next execution in the queue for the uri will NOT queue another task
    // 2. stream a message closing the socket

    let requestPath = this.filePath(req.params.uri)



    let { cwd, script } = await this.resolveScript(requestPath)
    if (script.on) {
      if (script.on.stop) {
        await this.process(script.on.stop) 
      }
    }



    // stop all shell processes connected to the uri
    this.kernel.shell.kill({ group: requestPath })

    // if any process is in a "wait" state, resume it
    this.kernel.resumeprocess(requestPath)

    // stop all proxies
    this.stopProxy({ script: requestPath })

    // stop all cloudflare tunnels

    await this.kernel.stopCloudflare({ path: requestPath })

    // if there are any pending waiters, delete them

    if (this.waiter[requestPath]) {
      this.waiter[requestPath].reject()
      delete this.waiter[requestPath]
    }

    delete this.running[requestPath]

    delete this.kernel.memory.local[requestPath]

    this.ondata({
      id: requestPath,
      type: "disconnect"
    })
    return true
  }
  async startScripts() {
    let startScripts = []
    let files
    try {
      files = await fs.promises.readdir(this.userdir, { withFileTypes: true })
    } catch (e) {
    }
    if (files) {
      let folders = files.filter((file) => { return file.isDirectory() }).map((folder) => { return folder.name })
      for(let folder of folders) {
        try {
          const configPath = path.resolve(this.userdir, folder, "pinokio.js")
          let m = (await this.loader.load(configPath))
          if (m.resolved) {
            if (m.resolved.start) {
              if (typeof m.resolved.start === "function") {
                if (m.resolved.start.constructor.name === "AsyncFunction") {
                  m.resolved.start = await m.resolved.start(this.kernel)
                } else {
                  m.resolved.start = m.resolved.start(this.kernel)
                }
              }
              // start script name => turn into hex to find the folder
              // and add the path to the start script array
              if (m.resolved.start) {
                let uri = folder
                startScripts.push({
                  name: folder,
                  path: "/api/" + folder,
                  uri,
                  script: m.resolved
                })
              }

            }
          } 
        } catch (e) {
//          console.log("E", e)
        }
      }
    }
    return startScripts
  }
  async linkGit() {
    // iterate through all userdir folders and check for gitconfig
    // if they exist, add to this.gitPath
    this.gitPath = {}
    let files
    try {
      files = await fs.promises.readdir(this.userdir, { withFileTypes: true })
    } catch (e) {
    }
    if (files) {
      let folders = files.filter((file) => { return file.isDirectory() }).map((folder) => { return folder.name })
      for(let folder of folders) {
        try {
          const repositoryPath = path.resolve(this.userdir, folder)
          let gitRemote = await git.getConfig({
            fs,
            http,
            dir: repositoryPath,
            path: 'remote.origin.url'
          })
          if (gitRemote) {
            this.gitPath[gitRemote] = repositoryPath
          }
        } catch (e) {
          //console.log("E", e)
        }
      }
    }
  }
  denormalize(gitRemote) {
    let denormalized
    if (gitRemote.endsWith(".git")) {
      denormalized = gitRemote.slice(0, -4)
    } else {
      denormalized = gitRemote
    }
    return denormalized
  }
  normalize(gitRemote) {
    let normalized
    if (gitRemote.endsWith(".git")) {
      normalized = gitRemote
    } else {
      normalized = gitRemote + ".git"
    }
    return normalized
  }

  parentGitURI(requestPath) {
    for(let repo in this.gitPath) {
      let val = this.gitPath[repo] 
      if (requestPath.includes(val)) {
        return repo
      }
    }
    return null
  }
  resolveBrowserPath(uri) {
    let repos = Object.keys(this.gitPath)
    let matched_repo = repos.filter((repo) => {
      return uri.includes(repo)
    })
    if (matched_repo.length > 0) {
      let repo_uri = matched_repo[0]

      let relative_path = uri
        .replace(repo_uri, "")    // remove the git repo uri
        .slice(1)                 // remove the leading '/' for relative path

      let repopath = this.gitPath[repo_uri]
      let reponame = path.basename(repopath)

      return `/pinokio/browser/${reponame}/${relative_path}`
    } else {
      return null
    }
  }

  resolveWebPath(uri) {
    let repos = Object.keys(this.gitPath)
    let matched_repo = repos.filter((repo) => {
      return uri.includes(repo)
    })
    if (matched_repo.length > 0) {
      let repo_uri = matched_repo[0]

      let relative_path = uri
        .replace(repo_uri, "")    // remove the git repo uri
        .slice(1)                 // remove the leading '/' for relative path

      let repopath = this.gitPath[repo_uri]
      let reponame = path.basename(repopath)

      return `/api/${reponame}/${relative_path}`
    } else {
      return null
    }
  }
  getGitURI(uri) {
    // git url
    // test to see if any of the gitPaths match partially
    let chunks = uri.split("/")
    let collect = []
    for(let chunk of chunks) {
      collect.push(chunk) 
      if (chunk.endsWith(".git")) {
        break
      }
    }
    return collect.join("/")
  }

  resolveGitURI(uri) {
    // git url
    // test to see if any of the gitPaths match partially

    if (!uri.includes(".git")) {
      throw new Error("a git repository URI must end with .git")
    }

    let repos = Object.keys(this.gitPath)
    let matched_repo = repos.filter((repo) => {
      return uri.includes(repo)
    })

    let modpath
    if (matched_repo.length > 0) {
      let repo_uri = matched_repo[0]

      let relative_path = uri
        .replace(repo_uri, "")    // remove the git repo uri
        .slice(1)                 // remove the leading '/' for relative path

      let repopath = this.gitPath[repo_uri]
      modpath = path.resolve(repopath, relative_path)
    } else {
      //console.log("no matching gitpath")
    }
    return modpath
  }

  webPath(uri) {
    let modpath
    if (uri.startsWith("http")) {
      // git url
      // test to see if any of the gitPaths match partially
      modpath = this.resolveWebPath(uri)
    } else if (uri.startsWith("~/")) {
      // absolute path
      modpath = `/${uri.slice(2)}`
    } else {
      throw new Error("uri must be either an http uri or start with ~/")
    }
    return modpath
  }
  filePath(uri, cwd) {
    let modpath
    if (uri.startsWith("http")) {
      // git url
      // test to see if any of the gitPaths match partially
      modpath = this.resolveGitURI(uri)
    } else if (uri.startsWith("~/")) {
      // absolute path
      modpath = path.resolve(this.kernel.homedir, uri.slice(2))
    } else if (path.isAbsolute(uri)) {
      modpath = uri
    } else if (cwd) {
      modpath = path.resolve(cwd, uri)
    } else {
      throw new Error("uri must be either an http uri or start with ~/")
    }
    return modpath
  }
  ////////////////////////////////////////////////
  // uri to absolute path
  ////////////////////////////////////////////////
  resolvePath(cwd, uri) {
    let modpath;
    if (uri.startsWith("http")) {
      // git url
      // test to see if any of the gitPaths match partially
      modpath = this.resolveGitURI(uri)
    } else if (uri.startsWith("~/")) {
      // absolute path
      modpath = path.resolve(this.kernel.homedir, uri.slice(2))
    } else if (path.isAbsolute(uri)) {
      modpath = uri
    } else {
      if (cwd) {
        // relative path against the cwd (current execution path)
        modpath = path.resolve(cwd, uri)
      } else {
        throw new Error("resolving relative paths require an additional cwd argument")
      }
    }
    return modpath
  }
  async resolveMethod(req, cwd) {
    let modpath
    let method
    let dirname
    let mod
    if (req.uri) {
      modpath = this.resolvePath(cwd, req.uri)
      let m = (await this.loader.load(modpath))
      mod = m.resolved
      dirname = m.dirname
      method = mod[req.method].bind(mod)
    } else {
      // KERNEL
      let chunks = req.method.split(".")
      if (chunks[0] === "kernel") {
        // kernel call
        mod = this.kernel
        let modulePath = chunks.slice(1, -1)
        let methodName = chunks[chunks.length-1]
        for(let chunk of modulePath) {
          mod = mod[chunk]
        }
        method = mod[methodName].bind(mod)
      } else {
        if (chunks.length === 1) {
          let methodName = chunks[0]
          modpath = path.resolve(__dirname, methodName)
          mod = (await this.loader.load(modpath))
          method = mod.resolved
          dirname = mod.dirname
        } else if (chunks.length === 2) {
          let modName = chunks[0]
          let methodName = chunks[1]
          modpath = path.resolve(__dirname, modName)
          let m = (await this.loader.load(modpath))
          mod = m.resolved
          dirname = m.dirname
          method = mod[methodName].bind(mod)
        }
      }
    }
    return { modpath, method, dirname, mod }
  }
  async dirs(p) {
    const files = await fs.promises.readdir(p, { withFileTypes: true })
    return files.filter(file => file.isDirectory()).map((x) => {
      return {
        name: x.name,
        path: path.resolve(p, x.name)
      }
    });
  }
  async files(p) {
    const files = await fs.promises.readdir(p, { withFileTypes: true })
    return files.filter(file => !file.isDirectory())
    .filter((file) => {
      return !file.name.startsWith(".")  // no hidden files
    })
    .map((x) => {
      return {
        name: x.name,
        path: path.resolve(p, x.name)
      }
    });
  }
  exists(_path) {
    return new Promise(r=>fs.access(_path, fs.constants.F_OK, e => r(!e)))
  }
  async resolveFilename(modpath) {
    let filename
    let exists = await this.exists(modpath + "/index.json")
    if (exists) {
      filename = "index.json"
    } else {
      exists = await this.exists(modpath + "/index.js")
      if (exists) {
        filename = "index.js"
      }
    }
    if (exists) {
      throw new Error("module doesn't exist")
    } else {
      return filename
    }
  }
  async construct(cwd, includeFiles, { exclude, is_sub }) {
    let files = includeFiles.filter((filepath) => {
      let file = path.parse(filepath).base
      if (exclude && exclude.length > 0 && exclude.includes(file)) {
        return false
      } else {
        if (!file.startsWith("_") && !file.startsWith(".")) {    // index.json/index.js has been taken care of already in step 1
          if (file.endsWith(".js") || file.endsWith(".json")) {
            if (file !== "index.js" && file !== "index.json") {
              return true
            }
          }
        }
      }
      return false
    })

    let paths = []
    let mods = []
    for(let file of files) {
      let relativePath = file.replace(cwd, "") 
      let chunks = relativePath.split(path.sep).filter((x) => { return x })
      chunks[chunks.length-1] = path.parse(chunks[chunks.length-1]).name
      paths.push(chunks.join("."))

      let r = (await this.loader.load(file)).resolved
      mods.push(r)
    }
    let mod = _.zipObjectDeep(paths, mods)
    return mod

  }
  async step (request, rawrpc, input, i, total, args) {

    await this.init()

    await this.kernel.update_sysinfo()

    // clear global regular expression object RegExp.lastMatch (memory leak prevention)
    let r = /\s*/g.exec("");

    let { cwd, script } = await this.resolveScript(request.path)

    let memory = {
      script: this.kernel.script,
      input,
      args,
      global: (this.kernel.memory.global[request.path] || {}),
      local: (this.kernel.memory.local[request.path] || {}),
      key: this.kernel.memory.key,
      current: i,
      uri: request.uri,
      cwd,
      self: script,
      ...this.kernel.vars,
    }

    if (i < script.run.length-1) {
      memory.next = i+1
    } else {
      memory.next = null
    }

    this.state = memory
    this.executing = request
    // get fully resolved env
    let env = await Environment.get2(request.path, this.kernel)
    // set template
    this.kernel.template.update({ envs: env, env })

    // render until `{{ }}` pattern does not exist
    // 1. render once
    let rpc = rawrpc
    let pass = 0;
    while(true) {
      rpc = this.kernel.template.render(rpc, memory)
      let test = this.kernel.template.istemplate(rpc)
      if (this.kernel.template.istemplate(rpc)) {
        pass++;
        if (pass >= 4) {
          // only try 4 times
          break;
        } else {
          continue;
        }
      } else {
        break;
      }
    }

    // replace {{{ }}} with {{ }}
    rpc = this.kernel.template.flatten(rpc)

    // 6. rpc must have method names
    if (rpc.method) {

      // 7. resolve the rpc
      let resolved = await this.resolveMethod(rpc, cwd)

      // 8. the endpoint must exist
      if (!resolved.method) {
        this.ondata({
          id: request.path,
          type: "error",
          data: "RPC endpoint doesn't exist: " + JSON.stringify(rpc),
          rpc,
          rawrpc
        })
      } else {

        // 9. set the dirname => the resolved module's path is the dirname
        rpc.dirname = resolved.dirname

        // 10. set the cwd => the original request modpath is the cwd
        rpc.cwd = cwd

        rpc.root = request.uri

        rpc.parent = {
          uri: request.uri,
          path: request.path,
          git: this.parentGitURI(request.path),
          body: script 
        }

        if (request.client) rpc.client = request.client

        rpc.current = i

        rpc.total = script.run.length

        rpc.input = input

        rpc.args = args

        if (i < script.run.length-1) {
          rpc.next = i+1
        } else {
          rpc.next = null
        }

        if (rpc.hasOwnProperty("when")) {
          // if rpc.when is false, don't run this and go to the next step
          let should_run
          if (rpc.when) {
            // when { allow_undefined: true}, undefined is treated as falsy
            let h = this.kernel.template.render(rpc.when, memory, { allow_undefined: true })
            if (h) {
              should_run = true
            } else {
              should_run = false
            }
          } else {
            should_run = false
          }
          if (!should_run) {
          //if (!rpc.when) {
            if (typeof rpc.next === "undefined" || rpc.next === null) {
              // last call
              if (script.daemon) {
                this.ondata({
                  id: request.path,
                  type: "start",
                  data: {
                    title: "Started",
                    description: "All scripts finished running. Running in daemon mode..."
                  }
                })
              } else {
                // no next rpc to execute. Finish
                this.kernel.memory.local[request.path] = {}
                this.ondata({
                  id: request.path,
                  type: "event",
                  data: "stop",
                  rpc,
                  rawrpc
                })
                await this.stop({
                  params: {
                    uri: request.path
                  }
                })
              }
              return { request, input: null, step: rpc.next, total: script.run.length, args }
            } else {
              // still ongoing
              let next_rpc = script.run[rpc.next]
              if (next_rpc) {
                return { request, rawrpc: next_rpc, input: null, step: rpc.next, total: script.run.length, args }
              }
            }
          }
        }

        try {
          this.ondata({
            id: request.path,
            type: "start",
            data: rpc
          })

          // DEPRECATED APIS
          // If deprecated, just ignore and move on
          const deprecated = [
            "proxy.start"
          ]


          let result
          if (deprecated.includes(rpc.method)) {
            const msg = `DEPRECATED API ${rpc.method}. Ignored`
            console.log(msg)
          } else {
            // 11. actually make the rpc call
            result = await this.run(resolved.method, rpc, (stream, type) => {
              let m = {
                id: request.path,
                caller: request.caller,
                type: (type ? type : "stream"),
                index: i,
                total,
                data: stream,
                rpc,
                rawrpc
              }

  //            if (["input", "modal"].includes(m.type)) {
  //              // if a message requires user feedback, do not modify id
  //            } else {
  //              // if a message does not require user feedback
  //              // if the current session has a "caller" (parent process),
  //              // set the id to request.caller so the terminal prints the logs
  //              if (request.caller) {
  //                m.id = request.caller
  //              }
  //            }
              this.ondata(m)
            })
          }


          if (result && result.error) {
            this.ondata({
              id: request.path,
              type: "error",
              data: result.response,
              event: result.error,
              rpc,
              rawrpc
            })

            // if there's an error, set the PINOKIO_SCRIPT_DEFAULT to false

            /*
              req := {
                "method": "env.set",
                "params": {
                  <key>: <val>,
                  <key>: <val>,
                }
              }
            */
            // write to current app folder's ENVIRONMENT
            let api_path = Util.api_path(request.path, this.kernel)
            let env_path = path.resolve(api_path, "ENVIRONMENT")
            await Util.update_env(env_path, {
              PINOKIO_SCRIPT_DEFAULT: "false"
            })
            return
          }



          if (result && rpc.returns) {
            // set the scope variable from the return value
            if (typeof rpc.returns === "object") {
              // destructuring return values into the local variable scope.
              // example:
              // returns: { var1: template1, var2: template2 },
              //
              // evaluate template1 and template2 from the return values
              // and set the local variables var1 and var2
              //
              // Example:
              //
              //    "returns": {
              //      "local.image": "{{images[0]}}"
              //    }
              const filled_returns = this.kernel.template.render(rpc.returns, result)
              for(let key in filled_returns) {
                let chunks = key.split(".")
                if (chunks.length === 2) {
                  let name = chunks[1]
                  if (chunks[0] === "local") {
                    this.kernel.memory.local[request.path][name] = filled_returns[name]
                  } else if (chunks[0] === "global") {
                    this.kernel.memory.global[request.path][name] = filled_returns[name]
                  }
                }
              }
            } else if (typeof rpc.returns === "string") {
              // plain assignment to the specified variable name
              // example:
              // returns: "location"
              //  => will set
              //  location = <return value>

              let chunks = rpc.returns.split(".")
              if (chunks.length === 2) {
                let name = chunks[1]
                if (chunks[0] === "local") {
                  if (!this.kernel.memory.local[request.path]) {
                    this.kernel.memory.local[request.path] = {}
                  }
                  this.kernel.memory.local[request.path][name] = result
                } else if (chunks[0] === "global") {
                  if (!this.kernel.memory.global[request.path]) {
                    this.kernel.memory.global[request.path] = {}
                  }
                  this.kernel.memory.global[request.path][name] = result
                }
              }
            }
          }

          this.ondata({
            id: request.path,
            index: i,
            total,
            type: "result",
            data: result,
          })


          if (rpc.notify === true) {
            let html
            if (typeof i !== "undefined") {
              html = `<b>Step ${i} Finished</b><br>${rawrpc.uri ? '<b>uri</b> ' + rawrpc.uri + '<br>' : ''}<b>method</b> ${rawrpc.method}`
            } else {
              html = `<b>Run complete</b><br>${rawrpc.uri ? '<b>uri</b> ' + rawrpc.uri + '<br>' : ''}<b>method</b> ${rawrpc.method}`
            }
            this.ondata({
              id: request.path,
              type: "notify",
              data :{
                html,
              }
            })
          } else if (typeof rpc.notify === "object") {
            this.ondata({
              id: request.path,
              type: "notify",
              data: {
                html: rpc.notify.html,
                href: rpc.notify.href,
                target: rpc.notify.target,
                features: rpc.notify.features,
                type: rpc.notify.type
              }
            })
          }

          // if not running, don't progress any further
          // (can happen when the script made a request to a 3rd party module and the 3rd party module returns a response after the stop was triggered)
          if (!this.running[request.path]) {
            console.log("The script was already canceled")
            return
          }


          if (typeof rpc.next === "undefined" || rpc.next === null) {


            // kill all connected shells
            // if not daemon
            if (script.daemon) {
              this.ondata({
                id: request.path,
                type: "start",
                data: {
                  title: "Started",
                  description: "All scripts finished running. Running in daemon mode..."
                }
              })
              return { request, input: result, step: rpc.next, total: script.run.length, args }
            } else {
              // no next rpc to execute. Finish
              this.kernel.memory.local[request.path] = {}
              this.ondata({
                id: request.path,
                type: "event",
                data: "stop",
                rpc,
                rawrpc
              })
              await this.stop({
                params: {
                  uri: request.path
                }
              })
              return { request, input: result, step: rpc.next, total: script.run.length, args }
            }

          } else {
            // still going
            let next_rpc = script.run[rpc.next]
            return { request, rawrpc: next_rpc, input: result, step: rpc.next, total: script.run.length, args }
          }

        } catch (e) {
          console.log("<>ERROR", e)
          this.ondata({
            id: request.path,
            type: "error",
            data: e.stack,
            rpc,
            rawrpc
          })
          return    // halt when there's an error
        }
      }
    } else {
      this.ondata({
        id: request.path,
        type: "error",
        data: "missing RPC attribute: method",
        rpc,
        rawrpc
      })
      return    // halt when there's an error
    }
  }
  ondata(packet) {
    for(let name in this.listeners) {
      this.listeners[name](packet)
    }
//    if (packet.type === 'error') {
//      this.stop({
//        params: {
//          uri: packet.id
//        }
//      })
//    }
  }
  listen(name, ondata) {
    this.listeners[name] = ondata
  }
  unlisten(name) {
    this.listeners[name] = undefined
  }
  createQueue(queue_id, concurrency) {
    this.queues[queue_id] = fastq.promise(async ({ request, rawrpc, input, step, total, cwd, args }) => {
      try {
        let response  = await this.step(request, rawrpc, input, step, total, args)
        if (response) {
          if (response.rawrpc) {
            this.queue(response.request, response.rawrpc, response.input, response.step, response.total, cwd, args)
          } else {
            if (response.request.caller) {
              if (this.done[response.request.path]) {
                this.done[response.request.path]({
                  global: (this.kernel.memory.global[response.request.path] || {}),
                  local: (this.kernel.memory.local[response.request.path] || {}),
                  //return: response.input
                  input: response.input
                })
              }
            }
          }
        } else {
          if (this.done[request.path]) {
            this.done[request.path]({
              global: (this.kernel.memory.global[request.path] || {}),
              local: (this.kernel.memory.local[request.path] || {}),
            })
          }
        }
      } catch (e) {
        ondata({ raw: e.toString() })
      }
    }, concurrency)
  }
  queue(request, rawrpc, input, step, total, cwd, args) {


    // 1. only run one queued task at a time (for each api method)
    // 2. each api method is identified by ${rpc.uri}/${rpc.method}

    // only queue one item per api.
    // after the task finishes, add the next in the queue
    // every id/method pair has its own queue, so only one process runs at a time

    /*
    {
      method
      params
      returns
      queue: true|false => if true, queue. otherwise immediately run (default: false)
    }
    */

    // concurrency
    let concurrency = (rawrpc.queue ? 1 : 10);

    // queue_id

    let queue_id
    if (rawrpc.uri) {
      const rpc_path = this.resolvePath(cwd, rawrpc.uri)
      queue_id = `${rpc_path}/${rawrpc.method}`
    } else {
      queue_id = rawrpc.method
    }

    if (!this.queues[queue_id]) {
      this.createQueue(queue_id, concurrency)
    }
    this.queues[queue_id].push({
      request,
      rawrpc,
      input,
      step,
      total,
      cwd,
      args
    })
    let queueSize = this.queues[queue_id].length()

    if (queueSize > 0) {
      this.ondata({
        id: request.path,
        type: "info",
        data: `<b>Queued</b> waiting for ${queueSize} ${queueSize > 1 ? 'tasks' : 'task'} to finish<br><b>uri</b> ${rawrpc.uri}<br><b>method</b> ${rawrpc.method}`
      })
    }

  }
  call(request) {
    return new Promise((resolve, reject) => {
      this.process(request, resolve)
    })
  }
  async process(request, done) {
    /**************************************************************
    *
    *   req := { uri: <relative path>|<absolute path>|<url> }   
    *
    *   1. "uri" exists => ALL requests have "uri"
    *     - ONLY used for API calls (apis are under ~/api)
    *       - starts with http => find path based on { git uri:  localpath } mapping
    *       - starts with / => absolute path
    *       - otherwise => relative path (relative to the ~/pinokio path)
    *   2. "uri" does NOT exist
    *     - ONLY used for calling kernel methods
    *       - must have the following attributes { method, params }
    *
    *   example:
    *
    *     1. App methods (under /api) => ONLY includes "uri"
    *     {
    *       uri: "https://github.com/malfunctionize/lla/install.js"
    *     }
    *
    *     or
    *
    *     2. Kernel methods (built into the kernel) => does NOT includ "uri"
    *     {
    *       method: "kernel.bin.bootstrap",
    *       params: { }
    *     }
    *
    *   1. first check if the repository exists
    *   2. if it exists, load the file and check if it contains "uri"
    *   3. if it does, start running.
    *
    **************************************************************/

//    request.uri = this.resolvePath(this.userdir, request.uri)

//    let keypath = path.resolve(this.kernel.homedir, "key.json")
//    this.kernel.keys = (await this.loader.load(keypath)).resolved

    if (request.uri){
      this.counter++;
      // API Call

      request.path = this.resolvePath(this.userdir, request.uri)
      let { cwd, script } = await this.resolveScript(request.path)
      request.cwd = cwd

      if (!script) {
        this.ondata({
          id: request.path,
          type: "error",
          data: "the endpoint does not exist: " + request.uri,
        })
      } else {
        // 3. Check if the resolved endpoint has the "run" attribute and it's an array
        //if (script.run && Array.isArray(script.run)) {
        if (script.run) {

          this.running[request.path] = true

          this.done[request.path] = done

          this.queue(request, script.run[0], request.input, 0, script.run.length, cwd, request.input)

        } else {
          this.ondata({
            id: request.path,
            type: "error",
            data: "missing attribute: run"
          })
        }
      }
    } else if (request.method) {
      let pass = 0;
      while(true) {
        request = this.kernel.template.render(request, { kernel: this.kernel })
        if (this.kernel.template.istemplate(request)) {
          pass++;
          if (pass >= 4) {
            // only try 4 times
            break;
          } else {
            continue;
          }
        } else {
          break;
        }
      }
      if (this.kernel.template.istemplate(request)) {
        console.log("something wrong with the request", request)
        return
      }

      // replace {{{ }}} with {{ }}
      request = this.kernel.template.flatten(request)

      if (request.params && request.params.path) {
        request.params.path = this.resolvePath(this.userdir, request.params.path)
      }

      // Kernel Call
      let resolved = await this.resolveMethod(request)
      try {
        resolved.dirname = resolved.dirname
        let result = await this.run(resolved.method, request, (stream, type) => {
          this.ondata({
            kernel: true,
            id: request.method,
            type: (type ? type : "stream"),
            data: stream,
            rpc: request,
            rawrpc: request
          })
        })
        this.ondata({
          kernel: true,
          id: request.method,
          type: "result",
          data: result,
          rpc: request,
          rawrpc: request
        })
      } catch (e) {
        console.log("E1112", e)
        this.ondata({
          kernel: true,
          id: request.method,
          type: "error",
          data: e.stack,
          rpc: request,
          rawrpc: request
        })
      }
    }
  }
  async resolveScript(scriptpath) {

    // load the module
    // first resolve all potential sub modules

    let stat = await fs.promises.stat(scriptpath)
    let cwd
    let filename
    if (stat.isDirectory()) {
      cwd = scriptpath
      filename = await this.resolveFilename(scriptpath)
    } else {
      cwd = path.dirname(scriptpath)
      filename = path.parse(scriptpath).base
    }


    // get the core script
    let script = (await this.loader.load(scriptpath)).resolved

    // if the sccript is a function, instantiate first
    if (typeof script === "function") {
      if (script.constructor.name === "AsyncFunction") {
        // pass kernel to instantiate
        script = await script(this.kernel)
      } else {
        script = script(this.kernel)
      }
    }
    // if it's an async function,
    // else if it's a normal function
    // otherwise don't do anything

    // require submodules

    // ignore the files in the gi

    // read gitignore
    let ignore = []
    try {
      const ignorepath = path.resolve(cwd, ".gitignore")
      const ignorestr = await fs.promises.readFile(ignorepath, "utf8")
      ignore = ignorestr.split(os.EOL).filter((x) => { return x })
    } catch (e) {
    }
    ignore.push("node_modules")

    //let includeFiles = (await glob('**/*.@(js|json)', { ignore, cwd })).map((x) => {
    let includeFiles = (await glob('*.{js,json}', { ignore, cwd })).map((x) => {
      return path.resolve(cwd, x)
    })

//    let merge = await this.construct(cwd, includeFiles, { exclude: [filename], is_sub: false })
//
//    // merge them into the original module
//    
//    //exclude "run" attributes
//
//    if (script.run) {
//      if (merge.run) {
//        delete merge.run
//      }
//    }
//    script = Object.assign(script, merge)

    return { cwd, script }
  }
}
module.exports = Api
