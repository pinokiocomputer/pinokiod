const { yellow, green, blue  } = require('kleur');
const QRCode = require('qrcode');
class P {
  async start (req, ondata, kernel) {
    /*
      {
        "method": "proxy.start",
        "params": {
          "name",
          "uri": "http://localhost:8192",
          "port": 3000,
          "ws": false
        }
      }
    */
    try {
      // check proxy
      kernel.api.checkProxy({ uri, name })
      // if exists, don't do anything
    } catch (e) {
      ondata({
        raw: `\r\n[Start Local Sharing]\r\n`
      })
      let { name, uri, ...o } = req.params
      console.log("proxy.start", { name, uri, o })
      let response = await kernel.api.startProxy(req.parent.path, req.params.uri, req.params.name, o)

      ondata({ raw: yellow("\r\n## [LOCAL NETWORK SHARING] Scan the QR code to open in any device\r\n\r\n") })
      ondata({
        raw: `${blue(response.proxy)}\r\n\r\n`
      })
      await new Promise((resolve, reject) => {
        QRCode.toString(response.proxy, {
          type: "terminal"
        }, function(err, data) {
          ondata({ raw: green(data.replaceAll("\n", "\r\n")) })
          ondata({ raw: "\r\n" })
          setTimeout(() => {
            resolve()
          }, 2000)
        });
      })

      /***************************************************
        Expose local variabl

        local.$share := {
          local: {
            <original_url>: <cloudflare_url>
          }
        }
      ***************************************************/
      if (!kernel.memory.local[req.parent.path].$share) {
        kernel.memory.local[req.parent.path].$share = {}
      }
      if (!kernel.memory.local[req.parent.path].$share.local) {
        kernel.memory.local[req.parent.path].$share.local = {}
      }
      kernel.memory.local[req.parent.path].$share.local[req.params.uri] = response.proxy

      return response
    }
  }
  async stop (req, ondata, kernel) {
    /*
      {
        "method": "proxy.stop",
        "params": {
          "uri": "http://localhost:8192"
        }
      }
    */
    ondata({
      raw: `\r\n[Stop proxy] ${req.params.uri}\r\n`
    })
    kernel.api.stopProxy({ uri: req.params.uri })
    ondata({
      raw: "Proxy Stopped\r\n"
    })
  }
}
module.exports = P
