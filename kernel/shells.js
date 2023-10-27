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
  async launch(params, options, ondata) {
    // iterate through all the envs
    params.env = this.kernel.bin.envs(params.env)

    let exec_path = (params.path ? params.path : ".")                         // use the current path if not specified
    let cwd = (options && options.cwd ? options.cwd : this.kernel.homedir)   // if cwd exists, use it. Otherwise the cwd is pinokio home folder (~/pinokio)              
    params.path = this.kernel.api.resolvePath(cwd, exec_path)
    let sh = new Shell(this.kernel)
    if (options) params.group = options.group  // set group

    let m
    let response = await sh.start(params, async (stream) => {
      if (params.on && Array.isArray(params.on)) {
        for(let handler of params.on) {
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
      ondata(stream)
    })


    // need to make a request
    return { id: sh.id, response, stdout: response, event: m }
  }
//  async launch2(params, options, ondata) {
//    /*
//      options = {
//        group: <group id (killing the group will kill all the members>,
//        cwd: <current path>
//      }
//    */
//    // create a shell for "group", so it can be deregistered by group later
//    // 1. resolve env
//    let CMAKE_ENV
//    if (os.platform() === 'win32') {
//      CMAKE_ENV = {
//        CMAKE_GENERATOR: "MinGW Makefiles",
//        CMAKE_OBJECT_PATH_MAX: 1024
//      }
//    } else {
//      CMAKE_ENV = {}
//    }
//
//    let CONDA_ENV = {
//      CONDA_EXE: this.kernel.bin.path("miniconda", "bin", "conda"),
//      CONDA_PYTHON_EXE: this.kernel.bin.path("miniconda", "bin", "python"),
//      CONDA_PREFIX: this.kernel.bin.path("miniconda"),
////      CONDA_SHLVL: 2,
//    }
//
//
//
//    let HOMEBREW_ENV
//    if (os.platform() === 'darwin') {
//      HOMEBREW_ENV = {
//        HOMEBREW_CACHE: this.kernel.bin.path("homebrew", "cache")
//      }
//    } else {
//      HOMEBREW_ENV = {}
//    }
//
//    let GIT_ENV = {}
//
//    if (os.platform() === 'win32') {
//      let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
//      GIT_ENV = {
//        GIT_CONFIG_GLOBAL: gitconfig_path
//      }
//      // check if gitconfig exists
//      let exists = await this.kernel.api.exists(gitconfig_path)
//      // if not, create one
//      if (!exists) {
//        await fs.promises.copyFile(
//          path.resolve(__dirname, "gitconfig_template"),
//          gitconfig_path
//        )
//      }
//    }
//
//    let TCLTK_ENV = {}
//    if (os.platform() === "darwin") {
//      TCLTK_ENV = {
//        TCL_LIBRARY: this.kernel.bin.path("python", "lib", "tcl8.6"),
//        TK_LIBRARY: this.kernel.bin.path("python", "lib", "tk8.6")
//      }
//    }
//
//
//
//
////    let COMPILER_ENV = {}
////    if (os.platform() === 'win32') {
////      COMPILER_ENV.CC = path.resolve(this.kernel.homedir, "bin", "cmake", "bin", "clang.exe")
////      COMPILER_ENV.CXX = path.resolve(this.kernel.homedir, "bin", "cmake", "bin", "clang++.exe")
////    }
//
//
//    let env = Object.assign(CMAKE_ENV, HOMEBREW_ENV, CONDA_ENV, GIT_ENV, TCLTK_ENV, {
//      PYTHON: this.kernel.bin.mod("python").binpath,
//    }, params.env)
//    let paths = (env.path ? env.path : [])
//
//    // add system32 (for those that don't have this path)
//    if (os.platform() === 'win32') {
//      paths.push("C:\\Windows\\System32")
//
//
//      // if something breaks, may need to use
//      // root = process.env.ProgramFiles(x86) || process.env.ProgramFiles instead of hardcoding
//
//      if (!this.win_cl_path) {
//        let cwd = path.resolve(this.kernel.homedir, "bin", "vs", "VC", "Tools", "MSVC")
//        //let cwd = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Tools\\MSVC"
//        const clpaths = await glob('**/bin/Hostx64/x64/cl.exe', {
//          cwd
//        })
//        if (clpaths && clpaths.length > 0) {
//          this.win_cl_path = path.resolve(cwd, path.dirname(clpaths[0]))
//        }
//      }
//      if (this.win_cl_path) {
//        paths.push(this.win_cl_path)
//      }
//
//      // for vcvarsall, used for setuptools
//      paths.push(path.resolve(this.kernel.homedir, "bin", "vs", "VC", "Auxiliary", "Build"))
//      //paths.push("C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build")
//
//    }
//
//    if (os.platform() === 'darwin') {
//      paths.push(path.resolve(this.kernel.homedir, "bin", "homebrew", "Cellar", "llvm", "16.0.6", "bin"))
//    }
//
//    env.path = paths.concat(this.kernel.bin.paths())
//
//
//    params.env = env
//
//
//    // 2. resolve path
//    let p = (params.path ? params.path : ".")                         // use the current path if not specified
//    let cwd = (options && options.cwd ? options.cwd : this.kernel.homedir)   // if cwd exists, use it. Otherwise the cwd is pinokio home folder (~/pinokio)              
//    params.path = this.kernel.api.resolvePath(cwd, p)
//    let sh = new Shell(this.kernel)
//    if (options) params.group = options.group  // set group
//    let response = await sh.start(params, ondata)
//
////    let response = await sh.request(params, async (stream) => {
////      if (stream.prompt) {
////        sh.resolve()
////      } else {
////        if (ondata) ondata(stream)
////      }
////    })
////    return response
//
//    // need to make a request
//    return { id: sh.id, response }
//  }
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
          shell.kill(message, true)
        }
      }
    } else if (request.group) {
      // kill all shells for the scriptpath
      for(let i=0; i<this.shells.length; i++) {
        let shell = this.shells[i]
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
