class LocalhostHomeRouter {
  constructor(router) {
    this.router = router
  }
  handle () {
    this.router.add({
      host: this.router.kernel.peer.host,
      dial: this.router.default_host + ":" + this.router.default_port,
      match: this.router.default_match
    })
    this.router.config = {
      "apps": {
        "tls": {
          "automation": {
            "policies": [
              {
                "issuers": [{ "module": "internal" }],
                "on_demand": true
              }
            ]
          }
        },

        "http": {
          "servers": {
            "main": {
              "listen": [":443"],
              "routes": [
                {
                  "match": [{ "method": ["OPTIONS"] }],
                  "handle": [
                    {
                      "handler": "headers",
                      "response": {
                        "set": {
                          "Access-Control-Allow-Origin": ["*"],
                          "Access-Control-Allow-Methods": ["GET, POST, OPTIONS, PUT, DELETE"],
                          "Access-Control-Allow-Headers": ["*"],
                          "Vary": ["Origin"],
                        }
                      }
                    },
                    {
                      "handler": "static_response",
                      "status_code": 204
                    }
                  ]
                },
                {
                  "match": [{ "host": [ this.router.default_match ] }],
                  "handle": [
                    {
                      "handler": "reverse_proxy",
                      "transport": {
                        "protocol": "http",
                        "versions": ["1.1"]
                      },
                      "upstreams": [{ "dial": this.router.default_host + ":" + this.router.default_port }],
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
                    },
                  ]
                },
              ]
            }
          }
        }
      },
      "logging": {
        "logs": {
          "default": {
            "writer": {
              "output": "file",
              "filename": this.router.kernel.path("logs/caddy.log"),
              "roll": true,
              "roll_size_mb": 1,
              "roll_keep": 1,
              "roll_keep_days": 1,
              "roll_gzip": false,
              "roll_local_time": true
            },
            "level": "INFO"
          }
        }
      }
    }
  }
}
module.exports = LocalhostHomeRouter
