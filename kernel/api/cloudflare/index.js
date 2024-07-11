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

    ondata({ raw: yellow("\r\n## [CLOUDFLARE SHARING] Scan the QR code to open in any device\r\n\r\n") })
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

    /***************************************************
      Expose local variabl

      local.$share := {
        cloudflare: {
          <original_url>: <cloudflare_url>
        }
      }
    ***************************************************/
    if (!kernel.memory.local[req.parent.path].$share) {
      kernel.memory.local[req.parent.path].$share = {}
    }
    if (!kernel.memory.local[req.parent.path].$share.cloudflare) {
      kernel.memory.local[req.parent.path].$share.cloudflare = {}
    }
    kernel.memory.local[req.parent.path].$share.cloudflare[req.params.uri] = cloudflare_url

    return { uri: cloudflare_url }
  }
  async stop (req, ondata, kernel) {
    const message = `cloudflared tunnel --url ${req.params.uri}`
    await kernel.shell.kill({
      id: message
    })
  }
}
module.exports = C
