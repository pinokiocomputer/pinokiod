const os = require('os')
const _ = require('lodash')
const fs = require('fs')
const set = require("./api/set")
const Util = require('./util')
const {
  glob
} = require('glob')

const path = require('path')
const Shell = require("./shell")
const { detect: detectBracketedPasteSupport } = require('./bracketed_paste_detector')
class Shells {
  constructor(kernel) {
    this.kernel = kernel
    this.shells = []
    this.bracketedPasteDetections = new Map()

  }
  /*
  params := {
    "id": <shell id>,
    "message": <message>,
    "on": [{
      event: <pattern>,
      set: {
        
      }
    }]
  }
*/
  async init() {
    // iterate through all the envs
    let sh = new Shell(this.kernel)
    let m
    if (this.kernel.platform === "win32") {
      m = "dir"
    } else {
      m = "ls"
    }
    await sh.init_env({
      env: this.kernel.bin.envs({}),
    })

    await this.ensureBracketedPasteSupport(sh.shell)
    if (this.kernel.bracketedPasteSupport) {
      const cached = this.kernel.bracketedPasteSupport[(sh.shell || '').toLowerCase()]
      if (typeof cached === 'boolean') {
        sh.supportsBracketedPaste = cached
      }
    }

    this.kernel.envs = sh.env
    // also set the uppercase variables if they're not set
    for(let key in sh.env) {
      let up = key.toUpperCase()
      if (!this.kernel.envs[up]) {
        this.kernel.envs[up] = sh.env[key]
      }
    }

  }
  info() {
    return this.shells.map((s) => {
      return {
        EOL: s.EOL,
        shell: s.shell,
        args: s.args,
        cols: s.cols,
        rows: s.rows,
        id: s.id,
        group: s.group,
        start_time: s.start_time,
        cmd: s.cmd,
        done: s.done,
        state: s.state
      }
    })
  }
  async ensureBracketedPasteSupport(shellName) {
    if (!shellName) {
      return
    }
    const lower = (shellName || '').toLowerCase()
    if (!lower) {
      return
    }
    if (!this.kernel.bracketedPasteSupport) {
      this.kernel.bracketedPasteSupport = {}
    }
    if (Object.prototype.hasOwnProperty.call(this.kernel.bracketedPasteSupport, lower)) {
      return this.kernel.bracketedPasteSupport[lower]
    }
    if (this.bracketedPasteDetections.has(lower)) {
      return this.bracketedPasteDetections.get(lower)
    }
    const fallback = !(lower.includes('cmd.exe') || lower === 'cmd' || lower.includes('powershell') || lower.includes('pwsh'))
    const detectionPromise = detectBracketedPasteSupport(shellName, this.kernel.platform || os.platform())
      .then((support) => {
        const value = typeof support === 'boolean' ? support : fallback
        this.kernel.bracketedPasteSupport[lower] = value
        return value
      })
      .catch((error) => {
        console.warn('[shells.ensureBracketedPasteSupport] detection failed', {
          shell: shellName,
          error: error && error.message ? error.message : error
        })
        this.kernel.bracketedPasteSupport[lower] = fallback
        return fallback
      })
      .finally(() => {
        this.bracketedPasteDetections.delete(lower)
      })
    this.bracketedPasteDetections.set(lower, detectionPromise)
    return detectionPromise
  }
  async launch(params, options, ondata) {
    // if array, duplicate the action
    if (Array.isArray(params.message)) {
      if (params.chain) {
        // if "chain" attribute exists,
        // run commands in the same session
        let res = await this._launch(params, options, ondata)
        return res
      } else {
        // if "chain" attribute Does not exist (Default),
        // launch separate shells
        let res
        for(let i=0; i<params.message.length; i++) {
          let message = params.message[i]
          if (message) {
            let params_dup = Object.assign({}, params) 
            params_dup.message = message
            res = await this._launch(params_dup, options, ondata)
            // if there's an error, immediately return with the error
            if (res.error) {
              return res
            }
          }
        }
        return res
      }
    } else {
      let res = await this._launch(params, options, ondata)
      return res
    }
  }
  async _launch(params, options, ondata) {
    // iterate through all the envs
    params.env = this.kernel.bin.envs(params.env)

    // set $parent for scripts stored globally but run locally (git, prototype, plugin, etc)
    if (params.path && !params.$parent) {
      params.$parent = {
        path: params.path
      }
    }

    let exec_path = (params.path ? params.path : ".")                         // use the current path if not specified
    let cwd = (options && options.cwd ? options.cwd : this.kernel.homedir)   // if cwd exists, use it. Otherwise the cwd is pinokio home folder (~/pinokio)
    params.path = this.kernel.api.resolvePath(cwd, exec_path)

    // If this shell runs under ~/pinokio/api/<workspace>, remember the workspace
    // and the current set of known git repo roots so we can detect new repos
    // created by this step and pin them to recorded commits.
    let workspaceName
    let workspaceRoot
    let beforeDirs
    if (params.path && this.kernel && this.kernel.path) {
      const apiRoot = this.kernel.path("api")
      const rel = path.relative(apiRoot, params.path)
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        const segments = rel.split(path.sep).filter(Boolean)
        if (segments.length > 0) {
          workspaceName = segments[0]
          workspaceRoot = this.kernel.path("api", workspaceName)
          beforeDirs = new Set(this.kernel.git.dirs)
        }
      }
    }
    const parentMeta = params.$parent || null

    const plannedShell = params.shell || (this.kernel.platform === 'win32' ? 'cmd.exe' : 'bash')
    await this.ensureBracketedPasteSupport(plannedShell)
    let sh = new Shell(this.kernel)
    if (options) {
      params.group = options.group  // set group
      params.$title = options.title
    }

    let m
    let matched_index

    // if error doesn't exist, add default "error:" event
    if (!params.on) {
      params.on = []
    }

    let monitor = structuredClone(params.on)

    // default error
    const defaultHandlers = [{
      event: "/error:/i",
      break: true
    }, {
      event: "/errno /i",
      break: true
    }, {
      event: "/error:.*triton/i",
      break: false
    }]
    params.on = params.on.concat(defaultHandlers)

    let response = await sh.start(params, async (stream) => {
      /*
        {
          method: "shell.run",
          params: {
            message,
            on: [{
              event: <regex>,
              done: true|false,
              kill: true|false,
              debug: true|false,
              notify: {
                title,
                sound,
                message,
                image
              }
            }]
          }
        }
      */
      try {
        if (params.on && Array.isArray(params.on)) {
          for(let i=0; i<params.on.length; i++) {
            let handler = params.on[i]
            // regexify
            //let matches = /^\/([^\/]+)\/([dgimsuy]*)$/.exec(handler.event)
            if (handler.event) {
              if (handler.notify) {
                // notify is a special case. check by line
                let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
                if (!/g/.test(matches[2])) {
                  matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
                }
                let re = new RegExp(matches[1], matches[2])
                let test = re.exec(sh.monitor)
                if (test && test.length > 0) {
                  // reset monitor
                  sh.monitor = ""
                  let params = this.kernel.template.render(handler.notify, { event: test })
                  if (params.image) {
                    params.contentImage = path.resolve(req.cwd, params.image)
                  }
                  Util.push(params)
                }
              } else {
                let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
                if (!/g/.test(matches[2])) {
                  matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
                }
                let re = new RegExp(matches[1], matches[2])
                if (stream.cleaned) {
                  let line = stream.cleaned.replaceAll(/[\r\n]/g, "")
                  let rendered_event = [...line.matchAll(re)]
                  // 3. if the rendered expression is truthy, run the "run" script
                  if (rendered_event.length > 0) {
                    stream.matches = rendered_event
                    if (handler.kill) {
                      m = rendered_event[0]
                      matched_index = i
                      sh.kill()
                    }
                    if (handler.done) {
                      m = rendered_event[0]
                      matched_index = i
                      sh.continue()
                    }
                  }
                }
              }
            }
          }
        }
        if (ondata) {
          ondata(stream)
        }
      } catch (e) {
        console.log("Capture error", e)
        ondata({ raw: e.stack })
        sh.mute = true
        sh.kill()
      }
    })
    // If this shell ran under a workspace, rescan git repos for that workspace.
    // Snapshots are now always user-initiated via the backups UI; here we only
    // pin new repos to specific commits when this run was started from a
    // snapshot restore.
    if (workspaceRoot && beforeDirs) {
      try {
        await this.kernel.git.restoreNewReposForActiveSnapshot(workspaceName, workspaceRoot, beforeDirs)
      } catch (_) {}
    }
    /*
      {
        method: "shell.run",
        params: {
          message,
          on: [{
            event: <regex>,
            break: true|false
          }],
        }
      }

      - true: break with matched
      - false: do not break (default)
      - TEMPLATE: parse the template 
    */

    let errors = new Set()
    if (response) {
      if (params.on && Array.isArray(params.on)) {

        let line = response.replaceAll(/[\r\n]/g, "")
        // 1. find all break event handlers
        let breakPoints = params.on.filter((x) => {
          return x.event && x.hasOwnProperty("break")
        })

        // 2. first find the `break: false` handlers and replace the patterns with blank => so they won't be matched in the next step
        //let line = response.replaceAll(/[\r\n]/g, "")
        for(let handler of breakPoints) {
          if (handler.event) {
            let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
            if (!/g/.test(matches[2])) {
              matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
            }
            let re = new RegExp(matches[1], matches[2])

            // only the "break: false" ones => these need to be ignored
            if (!handler.break) {
              line = line.replaceAll(re, "")
            }
          }
        }
        // 3. Now with all the `break: false` (ignored patterns) gone, look for the `break: true` patterns
        for(let handler of breakPoints) {
          if (handler.event) {
            let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
            if (!/g/.test(matches[2])) {
              matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
            }
            let re = new RegExp(matches[1], matches[2])

            // only the "break: true" ones
            if (handler.break) {
              let match;
              // Keep executing the regex on the text until no more matches are found
              while ((match = re.exec(line)) !== null) {
                errors.add(match[0])
                // errors.add(match.slice(1));
              }
            }
          }
        }
      }
    }


    if (ondata) {
      if (m) {
        ondata({ raw: `\r\n\r\n===================================================\r\n` })
        //ondata({ raw: `# event handlers\r\n` })
        //ondata({
        //  raw: JSON.stringify(monitor, null, 2).replace(/\n/g, "\r\n") + "\r\n\r\n"
        //})
        ////for(let handler of monitor) {
        ////  let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
        ////  if (!/g/.test(matches[2])) {
        ////    matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
        ////  }
        ////  let re = new RegExp(matches[1], matches[2])
        ////  ondata({ raw: `- ${re}\r\n` })
        ////}
        //ondata({ raw: `# matched event handler\r\n` })
        //ondata({
        //  raw: JSON.stringify(monitor[matched_index], null, 2).replace(/\n/g, "\r\n") + "\r\n\r\n"
        //})
        ondata({
          raw: `# input.event\r\n`
        })
        ondata({
          raw: JSON.stringify(m, null, 2).replace(/\n/g, "\r\n")
        })
        ondata({ raw: `\r\n===================================================\r\n\r\n` })
      }
    }


    if (errors.size > 0) {
      // try replacing the shortest pattern from the text one by one and narrow down the errors
      // so it doesn't accidently contain a very long match

      let errs = Array.from(errors)
      errs.sort((x, y) => {
        return x.length - y.length
      })
      let line = response.replaceAll(/[\r\n]/g, "")
      let shortened_errs = []
      // at this point, errs is sorted in ascending order of length, so the shortest match is the first item
      for(let err of errs) {
        // 1. check the err still matches the line => The first time this is run, it will always be included. But from the next time it might not be
        if (line.includes(err)) {
          // 2. remove the first pattern
          shortened_errs.push(err)
          line = line.replaceAll(err, "")
        }
      }

      // don't return if there's an error
      return { id: sh.id, response, stdout: response, event: m, error: shortened_errs }
    } else {
      // need to make a request
      return { id: sh.id, response, stdout: response, event: m }
    }

  }
  async start(params, options, ondata) {
    params.persistent = true
    let r = await this.launch(params, options, ondata)
    return r.id
  }
  async enter(params, ondata) {
    let response = await this.send(params, ondata, true)
    return response
  }
  async write(params, ondata) {
    let response = await this.send(params, ondata)
    return response
  }
  resize(params) {
    /*
      params := {
        "id": <shell id>,
        "resize": {
          "cols": <cols>,
          "rows": <rows>,
        }
      }
    */
    let session = this.get(params.id)
    if (session) {
      session.resize(params.resize)
    }
  }
  emit(params) {
    /*
      params := {
        "id": <shell id>,
        "emit": <message>,
      }
    */
    let session = this.get(params.id)
    if (session) {
      if (params.paste) {
        const payload = params.emit != null ? String(params.emit) : ''
        if (session.supportsBracketedPaste !== false) {
          //session.emit("\x1b[?2004h\x1b[200~" + params.emit+ "\x1b[201~")
          session.emit("\x1b[200~" + payload + "\x1b[201~")
        } else {
          session.emit(payload)
        }
      } else {
        session.emit(params.emit)
      }
      return true
    } else {
      return false
    }
  }
  async send(params, ondata, enter) {
    /*
      params := {
        "id": <shell id>,
        "message": <message>,
        "on": [{
          // listeners
        }]
      }
    */
    // default id = cwd
    let session = this.get(params.id)
    if (session) {
      let response = await session.send(params.message, enter, async (stream) => {
        // if the stream includes "prompt": true, don't emit the event since that event is only for
        // handling listeners
        if (!stream.prompt) {
          if (ondata) {
            ondata(stream)
          }
        }
        if (params.on) {
          for(let handler of params.on) {
            // handler := { event, run }
            if (handler.event === null) {
              // only handle when stream.prompt is true
              if (stream.prompt) {
                // terminal prompt
                if (typeof handler.return !== 'undefined') {
                  session.clear()
                  let return_value = this.kernel.template.render(handler.return, { event: stream })
                  if (session.resolve) {
                    session.resolve(return_value)
                  }
                  break;
                }
              }
            } else {
              // regexify
              //let matches = /^\/([^\/]+)\/([dgimsuy]*)$/.exec(handler.event)
              let matches = /^\/(.+)\/([dgimsuy]*)$/gs.exec(handler.event)
              if (!/g/.test(matches[2])) {
                matches[2] += "g"   // if g option is not included, include it (need it for matchAll)
              }
              let re = new RegExp(matches[1], matches[2])
              let line = stream.cleaned.replaceAll(/[\r\n]/g, "")
              //let rendered_event = [...stream.cleaned.matchAll(re)]
              let rendered_event = [...line.matchAll(re)]

              // 3. if the rendered expression is truthy, run the "run" script
              if (rendered_event.length > 0) {
                stream.matches = rendered_event
                if (typeof handler.return !== "undefined") {
                  session.clear()
                  let return_value = this.kernel.template.render(handler.return, { event: stream })

                  if (session.resolve) {
                    session.resolve(return_value)
                  }
                  break;
                }
              }
            }
          }
        }
      })
      return response
    } else {
      throw new Error(`shell ${params.id} does not exist. must start first.`)
    }
  }
  async run(req, options, ondata) {
    let response = await this.launch(req, options, ondata)
//    req.id = id
//    let sh = this.get(id)
//    let response = await sh.request(req, ondata)
    return response
  }
  stop (request, message) {
    return this.kill(request, message)
  }
  reset(cb) {
    let info = this.shells.map((s) => {
      return { id: s.id, group: s.group, cmd: s.cmd }
    })
    if (this.shells && this.shells.length > 0) {
      let shells = []
      for(let i=0; i<this.shells.length; i++) {
        shells.push(this.shells[i])
      }
      let count = 0
      for(let shell of shells) {
        console.log("[Kill Shell]", { id: shell.id, group: shell.group, cmd: shell.cmd })
        if (cb) {
          shell.kill("", true, () => {
            count++
            if (count >= shells.length) {
              cb()
            }
          })
        } else {
          shell.kill("", true)
        }
      }
    } else {
      console.log("no shells running")
      if (cb) {
        cb()
      }
    }
  }
  kill(request, message) {
    /*
    *  - Kill by ID
    *    request = { id }

    *  - Kill by group ID
    *    request = { group } 
    */

    if (request.id) {

      let shells = []
      for(let i=0; i<this.shells.length; i++) {
        shells.push(this.shells[i])
      }

      for(let i=0; i<shells.length; i++) {
        let shell = shells[i]
        if (shell.id === request.id) {
          shell.kill(message, true)
        }
      }
    } else if (request.group) {
//      console.log("kill group", this.shells)
      // kill all shells for the scriptpath
      let shells = []
      for(let i=0; i<this.shells.length; i++) {
        shells.push(this.shells[i])
      }
      for(let i=0; i<shells.length; i++) {
        let shell = shells[i]
        if (shell.group === request.group) {
          shell.kill(message, true)
        }
      }
    }
  }
  resolve(id, response) {
    /*
    *  - Resolve by ID
    */
    let shells = []
    for(let i=0; i<this.shells.length; i++) {
      shells.push(this.shells[i])
    }
    for(let i=0; i<shells.length; i++) {
      let shell = shells[i]
      if (shell.id === id) {
        shell.resolve(response)
        break
      }
    }
  }
  async logs() {
    for(let s of this.shells) {
      s.log()
    }
    await this.kernel.log_queue.drained()
  }
  add(sh) {
    this.shells.push(sh)
    for(let i=0; i<this.shells.length; i++) {
      this.shells[i].index = i
    }
  }
  rm(id) {
    for(let i=0; i<this.shells.length; i++) {
      let shell = this.shells[i]
      if (shell.id === id) {
        this.shells.splice(i, 1)
      }
    }
  }
  find(request) {
    if (request.id) {
      let found = this.shells.filter((shell) => {
        return shell.id === request.id
      })
      if (found.length > 0) {
        return found[0]
      } else {
        return null
      }
    } else if (request.group) {
      let found = this.shells.filter((shell) => {
        return shell.group === group
      })
      return found
    } else if (request.filter) {
      let found = this.shells.filter(request.filter)
      return found
    }
  }
  get(id) {
    return this.find({ id })
  }
}
module.exports = Shells
