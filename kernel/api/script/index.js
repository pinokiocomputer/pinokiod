const path = require('path')
class Script {
  async start(req, ondata, kernel) {
    let res = await this.run(req, ondata, kernel)
    return res
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
      ondata({ raw: `\r\nStopped ${req.params.uri}\r\n` })
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
        kernel.api.process({
          uri,
          input: req.params.params,
          client: req.client,
          caller: req.parent.path,
        }, (r) => {
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
      uri = path.resolve(req.cwd, req.params.uri)
    }
    return uri
  }
}
module.exports = Script
