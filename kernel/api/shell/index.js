const path = require('path')
const fs = require('fs')
const os = require('os')
const CondaRuntimeGuard = require('../../shell_conda_runtime_guard')
class Shell {
  async applyBluefairyDefault(req = {}, kernel) {
    if (!req.params) {
      return
    }
    if (Object.prototype.hasOwnProperty.call(req.params, "bluefairy")) {
      return
    }
    const preferences = kernel && kernel.appPreferences
    if (
      !preferences
      || !kernel
      || !kernel.api
      || typeof kernel.api.resolvePath !== "function"
      || typeof preferences.resolveAppIdFromPath !== "function"
      || typeof preferences.getPreference !== "function"
    ) {
      req.params.bluefairy = "off"
      return
    }
    const cwd = req.cwd || kernel.homedir
    const requestedPath = req.params.path || "."
    const resolvedPath = kernel.api.resolvePath(cwd, requestedPath)
    const appId = preferences.resolveAppIdFromPath(resolvedPath)
    if (!appId) {
      req.params.bluefairy = "off"
      return
    }
    const preference = await preferences.getPreference(appId)
    req.params.bluefairy = preference && preference.protection_enabled === true ? "on" : "off"
  }
  async start(req, ondata, kernel) {
    /*
      {
        "method": "shell.start",
        "params": {
          "id": <shell id>,
          "env": <env>,
          "path": <cwd>,
        }
      }
    */

    // the default ID is the cwd.
    if (!req.params) {
      req.params = {
        id: req.cwd,
        path: req.cwd
      }
    }

    // default id = cwd
    if (!req.params.id) {
      req.params.id = req.cwd 
    }

    // default path = cwd
    if (!req.params.path) {
      req.params.path = req.cwd
    }

    if (req.client) {
      req.params.rows = req.client.rows
      req.params.cols = req.client.cols
    }

    if (req.params) {
      req.params.$parent = req.parent
    }
    if (!Object.prototype.hasOwnProperty.call(req.params, "bluefairy")) {
      req.params.bluefairy = "off"
    }

//    // create a persistent session
//    req.params.persistent = true

    // create a shell

    let options = {}
    if (req.cwd) options.cwd = req.cwd
    if (req.parent && req.parent.id) {
      options.group = req.parent.id
    } else if (req.parent && req.parent.path) {
      options.group = req.parent.path
    }
    if (req.parent && req.parent.body && req.parent.body.title) {
      options.title = req.parent.body.title
    }
    let id = await kernel.shell.start(req.params, options, ondata)
    return id
    //let id = await kernel.shell.start(req.params, options)
    //this.session = kernel.shell.get(id)

    //// make a request
    //let response = await this.session.request(req.params, async (stream) => {
    //  if (stream.prompt) {
    //    this.session.resolve()
    //  } else {
    //    ondata(stream)
    //  }
    //})
    //return response
  }
  async enter(req, ondata, kernel) {
    // convenience method for shell.write with a newline at the end
    // same as shell.write but end with \n 
    /*
      {
        "method": "shell.enter",
        "params": {
          "id": <shell id>,
          "message": <message>,
          "on": [{
            // listeners
          }]
        }
      }
    */
    if (!req.params) {
      req.params = { message: "" }
    }
    if (!req.params.message) {
      req.params.message = ""
    }

    if (!req.params.id) {
      req.params.id = req.cwd 
    }
    if (req.params) {
      req.params.$parent = req.parent
    }
    let response = await kernel.shell.enter(req.params, ondata)
    //let response = await this.send(req, ondata, kernel, true)
    return response
  }
  async write(req, ondata, kernel) {
    //let response = await this.send(req, ondata, kernel)
    if (!req.params.id) {
      req.params.id = req.cwd 
    }
    let response = await kernel.shell.write(req.params, ondata)
    return response
  }
  async run(req, ondata, kernel) {
    /*
      {
        "method": "shell.run",
        "params": {
          "env": <env>,
          "path": <cwd>,
          "message": <message>
        }
      }
    */
    if (!req.params) {
      req.params = {}
    }
    if (!req.params.path) {
      req.params.path = req.cwd
    }
    if (req.params) {
      req.params.$parent = req.parent
    }
    await this.applyBluefairyDefault(req, kernel)
    let options = {}
    if (req.cwd) options.cwd = req.cwd
    if (req.parent && req.parent.id) {
      options.group = req.parent.id
    } else if (req.parent && req.parent.path) {
      options.group = req.parent.path
    }
    if (req.parent && req.parent.body && req.parent.body.title) {
      options.title = req.parent.body.title
    }
    if (req.client) {
      req.params.rows = req.client.rows
      req.params.cols = req.client.cols
    }
    options[CondaRuntimeGuard.SHELL_RUN_GUARD_OPTION] = true
    let response = await kernel.shell.run(req.params, options, async (stream, type) => {
//      process.stdout.write(stream.raw)
      ondata(stream, type)
    })
    return response
  }
  async stop(req, ondata, kernel) {
    /*
      stop a shell by id: {
        "method": "shell.stop",
        "params": {
          "id": <shell id>,
        }
      }

      stop all shells for a group: {
        "method": "shell.stop",
        "params": {
          "group": <group id>,
        }
      }
    */
    if (!req.params) {
      req.params = {
        id: req.cwd,
      }
    }

    // default id = cwd
    if (!req.params.id) {
      req.params.id = req.cwd 
    }
    await kernel.shell.kill(req.params)
  }
}
module.exports = Shell
