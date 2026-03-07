class Script {
  currentParent(req) {
    if (req && req.parent && typeof req.parent === "object") {
      return req.parent
    }
    return null
  }
  currentPath(req) {
    const parent = this.currentParent(req)
    if (parent && parent.path) {
      return parent.path
    }
    return null
  }
  currentSessionId(req) {
    if (req && typeof req.id === "string" && req.id.trim()) {
      return req.id
    }
    const parent = this.currentParent(req)
    if (parent && typeof parent.id === "string" && parent.id.trim()) {
      return parent.id
    }
    return undefined
  }
  currentCaller(req) {
    if (req && typeof req.caller === "string" && req.caller.trim()) {
      return req.caller
    }
    const parent = this.currentParent(req)
    if (parent && typeof parent.caller === "string" && parent.caller.trim()) {
      return parent.caller
    }
    return undefined
  }
  currentClient(req) {
    if (req && req.client) {
      return req.client
    }
    const parent = this.currentParent(req)
    if (parent && parent.client) {
      return parent.client
    }
    return undefined
  }
  currentOrigin(req) {
    if (req && typeof req.origin === "string" && req.origin.trim()) {
      return req.origin
    }
    const parent = this.currentParent(req)
    if (parent && typeof parent.origin === "string" && parent.origin.trim()) {
      return parent.origin
    }
    return undefined
  }
  buildStartRequest(req, uri, input, target) {
    const nextParams = Object.assign({}, req && req.params ? req.params : {}, {
      uri,
      params: input
    })
    const preserveSession = !!(target && target.self)
    return {
      id: preserveSession ? this.currentSessionId(req) : undefined,
      caller: preserveSession ? this.currentCaller(req) : undefined,
      cwd: req ? req.cwd : undefined,
      client: this.currentClient(req),
      origin: this.currentOrigin(req),
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
    const sessionId = target.self ? this.currentSessionId(req) : undefined
    ondata({
      id: sessionId || target.stopUri,
    }, "restart")
    const stopRequest = sessionId
      ? { params: { id: sessionId } }
      : { params: { uri: target.stopUri } }
    await kernel.api.stop(stopRequest)
    ondata({ raw: `\r\nRestarting ${target.displayUri}\r\n` })
    const startRequest = this.buildStartRequest(req, target.startUri, input, target)
    this.scheduleStart(startRequest, ondata, kernel)
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
          client: this.currentClient(req),
        }
        if (req.id) {
          request.id = req.id
        }
        const caller = this.currentCaller(req)
        if (caller) {
          request.caller = caller
        } else if (req.parent && req.parent.path) {
          request.caller = req.parent.path
        }
        const origin = this.currentOrigin(req)
        if (origin) {
          request.origin = origin
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
