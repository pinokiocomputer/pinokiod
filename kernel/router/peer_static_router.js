const path = require('path')
const Common = require('./common')
const Rewriter = require('./rewriter')
const Connector = require('./connector')
const Processor = require('./processor')
class PeerStaticRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.common = new Common(router)
    this.connector = new Connector(router)
    this.rewriter = new Rewriter(router)
  }
  handle (rewrite_mapping) {
    /*
      rewrite_mapping: {
        name: "test",
        internal_router: [
          "127.0.0.1:42000/asset/api/test",
          "test.localhost"
        ],
        external_ip: "192.168.1.49:42000/asset/api/test",
        external_router: [
          "test.x.localhost"
        ]
      }

      connect 
        dial: 192.168.1.49:42000 
        rewrite: /asset/api/test
        match: test.x.localhost
    */ 
    let url = new URL("http://" + rewrite_mapping.external_ip)
    let dial = url.host
    let rewrite = url.pathname
    const fileServerOptions = rewrite_mapping.file_server_options
      ? { ...rewrite_mapping.file_server_options }
      : undefined
    this.rewriter.handle({
      route: url.pathname,
      match: rewrite_mapping.external_router,
      dial: url.host,
      fileServerOptions,
    })
  }
}
module.exports = PeerStaticRouter
