const Common = require('./common')
class PeerHomeRouter {
  constructor(router) {
    this.router = router
    this.common = new Common(router)
  }
  handle(peer) {
    this.common.handle({
      match: `${this.router.default_prefix}.${peer.name}.${this.router.default_suffix}`,
      dial: `${peer.host}:${this.router.default_port}`,
      host: peer.host
    })
  }
}
module.exports = PeerHomeRouter
