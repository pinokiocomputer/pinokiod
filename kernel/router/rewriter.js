const Processor = require('./processor')
class Rewriter extends Processor {
  constructor (router) {
    super()
    this.router = router
  }
  handle({ match, dial, route, fileServerOptions }) {
    //let rewrite = `${route}/{path}`
    //let rewrite = `${route}{http.request.uri}`
    /*
    let handler = [{
      "handler": "rewrite",
      "uri": rewrite,
    }, {
      "handler": "reverse_proxy",
      "upstreams": [{ "dial": dial }],
      "headers": {
        "request": {
          "set": {
            "X-Forwarded-Proto": ["https"],
            "X-Forwarded-Host": ["{http.request.host}"]
          }
        },
        "response": {
          "set": {
            "Access-Control-Allow-Origin": ["*"],
            "Access-Control-Allow-Methods": ["GET, POST, OPTIONS, PUT, DELETE"],
            "Access-Control-Allow-Headers": ["*"],
            "Vary": ["Origin"]
          }
        }
      }
    }]
    */

    // stript the leading /asset/ => (/asset/api/test => /api/test)
    const asset_path = this.router.kernel.path(route.replace(/\/asset\//, ''))

    const fileServerHandler = {
      "handler": "file_server",
      "root": asset_path,
      ...fileServerOptions
    }

    const handlers = [fileServerHandler]

    // if the dial port has been overridden by router.custom_routers, use that instead
    let parsed_dial = this.parse_ip(dial)
    let override_handler = this.router.custom_routers[String(parsed_dial.port)]
    if (override_handler) {
      this.router.config.apps.http.servers.main.routes.push({
        "match": [{
          "host": match ,
        }],
        "handle": override_handler
      })
      return
    }
    this.router.config.apps.http.servers.main.routes.push({
      "match": [{
        "host": match ,
      }],
      "handle": handlers
    })
  }
}
module.exports = Rewriter
