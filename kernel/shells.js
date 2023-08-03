const os = require('os')
const path = require('path')
const Shell = require("./shell")
class Shells {
  constructor(kernel) {
    this.kernel = kernel
    this.shells = []
  }
  async launch(params, options, ondata) {
    /*
      options = {
        group: <group id (killing the group will kill all the members>,
        cwd: <current path>
      }
    */
    // create a shell for "group", so it can be deregistered by group later
    // 1. resolve env
    let CMAKE_ENV
    if (os.platform() === 'win32') {
      CMAKE_ENV = {
        CMAKE_GENERATOR: "MinGW Makefiles",
        CMAKE_OBJECT_PATH_MAX: 1024
      }
    } else {
      CMAKE_ENV = {}
    }

    let CONDA_ENV = {
      CONDA_EXE: this.kernel.bin.path("miniconda", "bin", "conda"),
      CONDA_PYTHON_EXE: this.kernel.bin.path("miniconda", "bin", "python"),
      CONDA_PREFIX: this.kernel.bin.path("miniconda"),
//      CONDA_SHLVL: 2,
    }



    let HOMEBREW_ENV
    if (os.platform() === 'darwin') {
      HOMEBREW_ENV = {
        HOMEBREW_CACHE: this.kernel.bin.path("homebrew", "cache")
      }
    } else {
      HOMEBREW_ENV = {}
    }



    let env = Object.assign(CMAKE_ENV, HOMEBREW_ENV, CONDA_ENV, {
      PYTHON: this.kernel.bin.mod("python").binpath,
    }, params.env)
    let paths = (env.path ? env.path : [])
    env.path = paths.concat(this.kernel.bin.paths())
    params.env = env


    // 2. resolve path
    let p = (params.path ? params.path : ".")                         // use the current path if not specified
    let cwd = (options && options.cwd ? options.cwd : this.kernel.homedir)   // if cwd exists, use it. Otherwise the cwd is pinokio home folder (~/pinokio)              
    params.path = this.kernel.api.resolvePath(cwd, p)
    let sh = new Shell(this.kernel)
    if (options) params.group = options.group  // set group
    let response = await sh.start(params, ondata)

//    let response = await sh.request(params, async (stream) => {
//      if (stream.prompt) {
//        sh.resolve()
//      } else {
//        if (ondata) ondata(stream)
//      }
//    })
//    return response

    // need to make a request
    return { id: sh.id, response }
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
              console.log({ line, cleaned: stream.cleaned, rendered_event })
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
  kill(request, message) {
    /*
    *  - Kill by ID
    *    request = { id }

    *  - Kill by group ID
    *    request = { group } 
    */
    if (request.id) {
      for(let i=0; i<this.shells.length; i++) {
        let shell = this.shells[i]
        if (shell.id === request.id) {
          shell.kill(message)
        }
      }
    } else if (request.group) {
      // kill all shells for the scriptpath
      for(let i=0; i<this.shells.length; i++) {
        let shell = this.shells[i]
        if (shell.group === request.group) {
          shell.kill(message)
        }
      }
    }
  }
  resolve(id, response) {
    /*
    *  - Resolve by ID
    */
    for(let i=0; i<this.shells.length; i++) {
      let shell = this.shells[i]
      if (shell.id === id) {
        shell.resolve(response)
        break
      }
    }
  }
  add(sh) {
    this.shells.push(sh)
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
