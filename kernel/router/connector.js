const Processor = require('./processor')
class Connector extends Processor {
  constructor(router) {
    super()
    this.router = router
  }
  handle ({ match, connector, dial, }) {
    let connector_name = connector.host + ":" + connector.port
    let listener = "0.0.0.0:PORT_PLACEHOLDER_" + connector_name
    let listener_pointer = connector.host + ":PORT_PLACEHOLDER_" + connector_name
    let port_placeholder = "PORT_PLACEHOLDER_" + connector_name

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
            "X-Forwarded-Proto": ["{http.request.header.X-Forwarded-Proto}"],
            //"X-Forwarded-Proto": ["{http.request.scheme}"],
            //"X-Forwarded-Proto": ["https"],
            //"X-Forwarded-Host": ["{http.request.host}"]
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
    if(!this.router.config.apps.http.servers[connector_name]) {
      this.router.config.apps.http.servers[connector_name] = {
        "listen": [listener],
        "routes": [{
          "handle": handler
        }]
      }
    }
    this.router.config.apps.http.servers.main.routes.push({
      "match": [{ "host": [match] }],
      "handle": [
        {
          "handler": "reverse_proxy",
          "transport": {
            "protocol": "http",
            "versions": ["1.1"]
          },
          "upstreams": [{ "dial": listener_pointer }],
          "headers": {
            "request": {
              "set": {
                "Host": ["{http.request.host}"],
                //"X-Forwarded-Proto": ["https"],
                //"Origin": "localhost",
                "X-Forwarded-Proto": ["{http.request.scheme}"],
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
        },
      ]
    })
    this.router.add({ host: connector.host, dial: listener_pointer, match })
  }
}
module.exports = Connector
