const { yellow, green, blue  } = require('kleur');
const QRCode = require('qrcode');
class C {
  async tunnel (req, ondata, kernel) {
    /*
      {
        "method": "cloundflare.tunnel",
        "params": {
          "uri": "{{local.url}}"
        }
      }

      => cloudflared tunnel --url http://localhost:8080
    */
    const message = `cloudflared tunnel --url ${req.params.uri}`
    let params = {
      id: message,
      message
    }
    if (req.client) {
      params.rows = req.client.rows
      params.cols = req.client.cols
    }
    let options = {}
    if (req.cwd) options.cwd = req.cwd
    if (req.parent && req.parent.path) options.group = req.parent.path
    console.log("shells before", kernel.shell.shells)
    let pattern = /(https:.+?trycloudflare\.com)/
    let cloudflare_url = await new Promise((resolve, reject) => {
      kernel.shell.start(params, options, (e) => {
        ondata(e)
        let test = pattern.exec(e.cleaned)
        if (test && test.length > 0) {
          resolve(test[1])
        }
      })
    })
    console.log("cloudflare_url", cloudflare_url)

    ondata({ raw: yellow("\r\n## Scan the QR code to open in any device\r\n\r\n") })
    ondata({ raw: blue(`${cloudflare_url}\r\n\r\n`) })

    await new Promise((resolve, reject) => {
      QRCode.toString(cloudflare_url, {
        type: "terminal"
      }, function(err, data) {
        ondata({ raw: green(data).replaceAll("\n", "\r\n") })
        ondata({ raw: "\r\n" })
        setTimeout(() => {
          resolve()
        }, 2000)
      });
    })

    return { uri: cloudflare_url }
  }
  async stop (req, ondata, kernel) {
  }
}
module.exports = C
