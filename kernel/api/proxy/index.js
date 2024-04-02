class P {
  async start (req, ondata, kernel) {
    /*
      {
        "method": "proxy.start",
        "params": {
          "name",
          "uri": "http://localhost:8192",
          "ws": false
        }
      }
    */
    try {
      // check proxy
      kernel.api.checkProxy({ uri, name })
      // if exists, don't do anything
    } catch (e) {
      ondata({
        raw: `\r\n[Start proxy] ${req.params.name} ${req.params.uri}\r\n`
      })
      let { name, uri, ...o } = req.params
      console.log("proxy.start", { name, uri, o })
      let response = await kernel.api.startProxy(req.parent.path, req.params.uri, req.params.name, o)

      ondata({
        raw: `Proxy Started ${JSON.stringify(response)}\r\n`
      })

      return response
    }
  }
  async stop (req, ondata, kernel) {
    /*
      {
        "method": "proxy.stop",
        "params": {
          "uri": "http://localhost:8192"
        }
      }
    */
    ondata({
      raw: `\r\n[Stop proxy] ${req.params.uri}\r\n`
    })
    kernel.api.stopProxy({ uri: req.params.uri })
    ondata({
      raw: "Proxy Stopped\r\n"
    })
  }
}
module.exports = P
