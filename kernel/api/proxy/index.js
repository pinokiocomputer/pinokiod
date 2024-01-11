class P {
  async start (req, ondata, kernel) {
    /*
      {
        "method": "proxy.start",
        "params": {
          "name",
          "uri": "http://localhost:8192"
        }
      }
    */
    let response = await kernel.api.startProxy(req.parent.path, req.params.uri, req.params.name)
    return response
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
    kernel.api.stopProxy({ uri: req.params.uri })
  }
}
module.exports = P
