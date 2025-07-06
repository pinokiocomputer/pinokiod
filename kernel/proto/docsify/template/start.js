const path = require('path')
const fs = require('fs')
module.exports = {
  daemon: true,
  run: [{
    method: async (req, ondata, kernel) => {
      let config_path = path.resolve(req.cwd, "docs/docsify.config.json")
      console.log({ config_path })
      let config = await kernel.require(config_path)
      console.log({ config })
      if (config._basePath) {
        return { _basePath: config._basePath }
      }
    }
  }, {
    when: "{{input && input._basePath}}",
    method: "shell.run",
    params: {
      //message: "npx -y http-server {{input._basePath}} --cors -c-1",
      message: "npx -y live-server {{input._basePath}} --port={{port}} --no-browser --cors",
      on: [{
        event: "/:([0-9]+)/i",
        done: true,
      }]
    }
  }, {
    method: async (req, ondata, kernel) => {
      console.log("req.input", req.input)
      if (req.input && req.input.event && req.input.event.length > 1) {
        let port = req.input.event[1]
        let config_path = path.resolve(req.cwd, "docs/docsify.config.json")
        let config = await kernel.require(config_path)
        config.basePath = `http://localhost:${port}/`
        console.log("updated config", config)
        await fs.promises.writeFile(config_path, JSON.stringify(config, null, 2))
      }
    }
  }, {
    method: "shell.run",
    params: {
      message: "npx -y docsify-cli serve .",
      path: "docs",
      on: [{
        event: "/http:\/\/\\S+(?=\s|$)/m",
        done: true,
      }]
    }
  }, {
    method: "local.set",
    params: {
      url: "{{input.event[0]}}"
    }
  }]
}
