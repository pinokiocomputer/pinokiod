const os = require('os')
const _ = require('lodash')
const fs = require('fs')
const set = require("./api/set")
const {
  glob
} = require('glob')

const path = require('path')
const Shell = require("./shell")
class Shells {
  constructor(kernel) {
    this.kernel = kernel
    this.shells = []

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
    let response = await sh.start({
      message: m,
      env: this.kernel.bin.envs({}),
      conda: {
        skip: true
      }
    }, async (stream) => {
      process.stdout.write(stream.raw)
    })

    this.kernel.envs = sh.env
    // also set the uppercase variables if they're not set
    for(let key in sh.env) {
      let up = key.toUpperCase()
      if (!this.kernel.envs[up]) {
        this.kernel.envs[up] = sh.env[key]
      }
    }

  }
  async launch(params, options, ondata) {
    // if array, duplicate the action
    if (Array.isArray(params.message)) {
      let res
      for(let i=0; i<params.message.length; i++) {
        let message = params.message[i]
        let params_dup = Object.assign({}, params) 
        params_dup.message = message
        res = await this._launch(params_dup, options, ondata)
        // if there's an error, immediately return with the error
        if (res.error) {
          return res
        }
      }
      return res
    } else {
      let res = await this._launch(params, options, ondata)
      return res
    }
  }
  async _launch(params, options, ondata) {
    // iterate through all the envs
    params.env = this.kernel.bin.envs(params.env)

    let exec_path = (params.path ? params.path : ".")                         // use the current path if not specified
    let cwd = (options && options.cwd ? options.cwd : this.kernel.homedir)   // if cwd exists, use it. Otherwise the cwd is pinokio home folder (~/pinokio)              
    params.path = this.kernel.api.resolvePath(cwd, exec_path)
    let sh = new Shell(this.kernel)
    if (options) params.group = options.group  // set group

    let m

    // if error doesn't exist, add default "error:" event
    if (!params.on) {
      params.on = []
    }
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
              <done|kill|debug>: true
            }],
          }
        }
      */
      if (params.on && Array.isArray(params.on)) {
        for(let handler of params.on) {
          // regexify
          //let matches = /^\/([^\/]+)\/([dgimsuy]*)$/.exec(handler.event)
          if (handler.event) {
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
              if (handler.kill) {
                m = rendered_event[0]
                sh.kill()
              }
              if (handler.done) {
                m = rendered_event[0]
                sh.continue()
              }
            }
          }
        }
      }
      ondata(stream)
    })

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
  emit(params) {
    /*
      params := {
        "id": <shell id>,
        "emit": <message>,
      }
    */
    let session = this.get(params.id)
    if (session) {
      session.emit(params.emit)
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
          ondata(stream)
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
  reset() {
    let info = this.shells.map((s) => {
      return { id: s.id, group: s.group, cmd: s.cmd }
    })
    if (this.shells) {
      let shells = []
      for(let i=0; i<this.shells.length; i++) {
        shells.push(this.shells[i])
      }
      for(let shell of shells) {
        console.log("[Kill Shell]", { id: shell.id, group: shell.group, cmd: shell.cmd })
        shell.kill("", true)
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
    }
  }
  get(id) {
    return this.find({ id })
  }
}
module.exports = Shells
