const Processor = require('./processor')
class Common extends Processor {
  constructor (router) {
    super()
    this.router = router
  }
  handle({ match, dial, host }) {
    let handler = [{
      "handler": "reverse_proxy",
      "transport": {
        "protocol": "http",
        "versions": ["1.1"]
      },
      "upstreams": [{ "dial": dial }],
      "headers": {
        "request": {
          "set": {
            "Host": ["{http.request.host}"],
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

    // if the dial port has been overridden by router.custom_routers, use that instead
    let parsed_dial = this.parse_ip(dial)
    let override_handler = this.router.custom_routers[String(parsed_dial.port)]
    if (override_handler) {
      handler = override_handler
    }
    this.router.config.apps.http.servers.main.routes.push({
      "match": [{ "host": Array.isArray(match) ? match : [match] }],
      "handle": handler
    })
    this.router.add({ host, dial, match })
  }
}
module.exports = Common
