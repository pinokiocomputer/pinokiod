class HtmlModalAPI {
  constructor() {
    this.defaultIdPrefix = 'htmlmodal'
  }

  resolveParentPath(req) {
    if (req && req.parent && req.parent.path) {
      return req.parent.path
    }
    if (req && req.cwd) {
      return req.cwd
    }
    if (req && req.params && req.params.id) {
      return req.params.id
    }
    return this.defaultIdPrefix
  }

  buildPacket(req, action) {
    const params = Object.assign({}, req.params || {})
    if (!params.id) {
      params.id = `${this.defaultIdPrefix}:${this.resolveParentPath(req)}`
    }
    return Object.assign({ action }, params)
  }

  async dispatch(req, ondata, kernel, action, options = {}) {
    if (!req || typeof req !== 'object') {
      req = { params: {} }
    }
    if (!req.params) {
      req.params = {}
    }
    const packet = this.buildPacket(req, action)
    const awaitKey = this.resolveParentPath(req)
    if (options.forceAwait === false) {
      packet.await = false
    }
    if (packet.await) {
      packet.awaitKey = awaitKey
    }
    ondata(packet, 'htmlmodal')
    if (packet.await) {
      const waitKey = packet.awaitKey || awaitKey
      const response = await kernel.api.wait(waitKey)
      return response
    }
    return packet
  }

  async open(req, ondata, kernel) {
    /*
      {
        "method": "htmlmodal.open",
        "params": {
          "id": <optional modal id>,
          "title": <string>,
          "html": <html string>,
          "statusText": <string>,
          "actions": [ { ... } ],
          "await": <wait for response> 
        }
      }
    */
    return this.dispatch(req, ondata, kernel, 'open')
  }

  async update(req, ondata, kernel) {
    /*
      {
        "method": "htmlmodal.update",
        "params": {
          "id": <modal id>,
          "html": <html string>,
          "statusText": <string>,
          "waiting": <bool>,
          "actions": [ { ... } ],
          "await": <wait for response>
        }
      }
    */
    return this.dispatch(req, ondata, kernel, 'update')
  }

  async close(req, ondata, kernel) {
    /*
      {
        "method": "htmlmodal.close",
        "params": {
          "id": <modal id>
        }
      }
    */
    return this.dispatch(req, ondata, kernel, 'close', { forceAwait: false })
  }
}

module.exports = HtmlModalAPI
