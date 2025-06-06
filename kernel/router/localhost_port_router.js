const Common = require('./common')
class LocalhostPortRouter {
  constructor(router) {
    this.router = router
    this.common = new Common(router)
  }
  handle (proc) {
    this.common.handle({
      match: `${proc.port}.localhost`,
      dial: proc.ip,
      host: this.router.kernel.peer.host,
    })
  }
}
module.exports = LocalhostPortRouter
