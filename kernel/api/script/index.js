class Script {
  currentPath(req) {
    if (req && req.parent && req.parent.path) {
      return req.parent.path
    }
    return null
  }
  buildStartRequest(req, uri, input) {
    const nextParams = Object.assign({}, req && req.params ? req.params : {}, {
      uri,
      params: input
    })
    return {
      cwd: req ? req.cwd : undefined,
      client: req ? req.client : undefined,
      origin: req ? req.origin : undefined,
      params: nextParams
    }
  }
  resolveRestartTarget(req, kernel) {
    const hasParams = req && req.params && typeof req.params === "object"
    const requestedUri = hasParams && typeof req.params.uri === "string" && req.params.uri.trim()
      ? req.params.uri
      : null
    const currentPath = this.currentPath(req)
    if (!requestedUri) {
      if (!currentPath) {
        throw new Error("script.restart requires params.uri when called outside a running script")
      }
      return {
        displayUri: currentPath,
        startUri: currentPath,
        stopUri: currentPath,
        self: true,
      }
    }
    const stopUri = kernel.api.filePath(requestedUri, req.cwd)
    return {
      displayUri: requestedUri,
      startUri: requestedUri,
      stopUri,
      self: currentPath ? stopUri === currentPath : false,
    }
  }
  resolveRestartInput(req, kernel, target) {
    const hasExplicitParams = !!(req && req.params && typeof req.params === "object" && Object.prototype.hasOwnProperty.call(req.params, "params"))
    if (hasExplicitParams) {
      return req.params.params
    }
    if (target && target.self && req && req.parent && Object.prototype.hasOwnProperty.call(req.parent, "args")) {
      return req.parent.args
    }
    if (kernel && kernel.memory && kernel.memory.args && target) {
      return kernel.memory.args[target.stopUri]
    }
    return undefined
  }
  scheduleStart(req, ondata, kernel) {
    setTimeout(() => {
      this.start(req, ondata, kernel).catch((e) => {
        const stack = e && e.stack ? e.stack : String(e)
        ondata({ raw: `\r\nFailed to start ${req.params.uri}\r\n${stack}\r\n` })
      })
    }, 0)
  }
  async start(req, ondata, kernel) {
    let res = await this.run(req, ondata, kernel)
    return res
  }
  async restart(req, ondata, kernel) {
    if (!req.params) {
      req.params = {}
    }
    const target = this.resolveRestartTarget(req, kernel)
    const input = this.resolveRestartInput(req, kernel, target)
    await kernel.api.stop({ params: { uri: target.stopUri } })
    ondata({ raw: `\r\nRestarting ${target.displayUri}\r\n` })
    this.scheduleStart(this.buildStartRequest(req, target.startUri, input), ondata, kernel)
    return {
      uri: target.displayUri,
      scheduled: true,
      self: target.self,
      params: input,
    }
  }
  async stop(req, ondata, kernel) {
    /*
      {
        "method": "script.run",
        "params": {
          "uri": <string>|<array>
        }
      }
    */
    // stop the script
    let uris = req.params.uri
    if (!Array.isArray(uris)) {
      uris = [uris]
    }
    for(let uri of uris) {
      kernel.api.stop({ params: { uri } })
      ondata({ raw: `\r\nStopped ${uri}\r\n` })
    }
  }
  async run(req, ondata, kernel) {
    /*
      {
        "method": "script.run",
        "params": {
          "hash": <git commit hash>,
          "branch": <git branch>,
          "pull": true|false,
          "uri": <script uri>,
          "params": <script args>
        }
      }

      => uri resolve
        - relative path
        - absolute path
        - http path
    */
    // if already running, print that it's already running
    let id = kernel.api.filePath(req.params.uri, req.cwd)
    if (kernel.api.running[id]) {
      let msg = `${req.params.uri} already running. Continuing...\r\n`
      ondata({ raw: msg })
    } else {
      // if not already running, start.
      let uri = await this.download(req, ondata, kernel)
      let res = await new Promise((resolve, reject) => {
        let request = {
          uri,
          input: req.params.params,
          client: req.client,
        }
        if (req.parent && req.parent.path) {
          request.caller = req.parent.path
        }
        kernel.api.process(request, (r) => {
          resolve(r.input)
        })
      })
      // need to call api.linkGit() so the git repositories list is up to date
      return res
    }

  }
  async return(req, ondata, kernel) {
    /*
      {
        "method": "script.return",
        "params": <RETURN OBJECT>
      }
    */
    return req.params
  }
  async download(req, ondata, kernel) {
    let uri
    if (req.params.uri.startsWith("http")) {
      uri = req.params.uri
      let modpath = kernel.api.resolveGitURI(uri)
      const repo_uri = kernel.api.getGitURI(uri)
      const urlWithoutProtocol = repo_uri.replace(/^(https?:\/\/)/, '');
      const folderName = urlWithoutProtocol.replace(/[^a-zA-Z0-9_\-]/g, '_');
      if (modpath) {
        let msg = `Path ${uri} already exists at ${modpath}. Continuing...\r\n`
        ondata({ raw: msg })
      } else {
        let msg = `Path ${uri} does not exist. Cloning...\r\n`
        ondata({ raw: msg })

        // clone
        await kernel.bin.sh({
          message: `git clone ${repo_uri} ${folderName}`,
          path: kernel.api.userdir
        }, ondata)
      }

      // switch branch
      if (req.params.branch) {
        await kernel.bin.sh({
          message: `git pull`,
          path: kernel.path("api", folderName)
        }, ondata)
        await kernel.bin.sh({
          message: `git switch ${req.params.branch}`,
          path: kernel.path("api", folderName)
        }, ondata)
      }
      if (req.params.hash) {
        await kernel.bin.sh({
          message: `git pull`,
          path: kernel.path("api", folderName)
        }, ondata)
        await kernel.bin.sh({
          message: `git switch --detach ${req.params.hash}`,
          path: kernel.path("api", folderName)
        }, ondata)
      }
      if (req.params.pull) {
        await kernel.bin.sh({
          message: `git pull`,
          path: kernel.path("api", folderName)
        }, ondata)
      }

      await kernel.api.init()
    } else {
      uri = kernel.api.filePath(req.params.uri, req.cwd)
    }
    return uri
  }
}
module.exports = Script
