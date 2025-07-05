const path = require('path')
const Common = require('./common')
const Processor = require('./processor')
class CustomDomainRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.common = new Common(router)
  }
  handle (peer) {
    for(let domain in this.router.custom_domains) {
      let port = this.router.custom_domains[domain]
      this.common.handle({
        match: `${domain}.localhost`,
        dial: `127.0.0.1:${port}`,
        host: this.router.kernel.peer.host,
      })
    }
  }
}
module.exports = CustomDomainRouter
