const Common = require('./common')
class LocalhostPortRouter {
  constructor(router) {
    this.router = router
    this.common = new Common(router)
  }
  handle (proc) {
    let name_match
    for(let api_name in this.router.kernel.pinokio_configs) {
      let config = this.router.kernel.pinokio_configs[api_name]
      if (config.dns) {
        let root_routes = config.dns["@"]
        if (root_routes && root_routes.length > 0) {
          for(let route of root_routes) {
            if (route === ":" + proc.port) {
              // matched
              name_match = api_name
              break;
            }
          }
        }
      }
    }

    let match
    if (name_match) {
      match = [
        `${name_match}.localhost`,
        `${proc.port}.localhost`
      ]
    } else {
      match = `${proc.port}.localhost`
    }
    this.common.handle({
      match,
      dial: proc.ip,
      host: this.router.kernel.peer.host,
    })
  }
}
module.exports = LocalhostPortRouter
