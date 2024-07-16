const { yellow, green, blue  } = require('kleur');
const QRCode = require('qrcode');
const path = require('path')
const Util = require('../../util')
class C {
  async tunnel (req, ondata, kernel) {
    /*
      {
        "method": "cloundflare.tunnel",
        "params": {
          "uri": "{{local.url}}",
          "passcode": (optional)
        }
      }

      => cloudflared tunnel --url http://localhost:8080
    */

    let pipe_uri
    if (req.params.passcode) {
      // 1. start a pipe server => needed for authentication
      const api_path = Util.api_path(req.parent.path, kernel)
      const pinokio_path = path.resolve(api_path, "pinokio.js")
      const config  = (await kernel.loader.load(pinokio_path)).resolved
      pipe_uri = await kernel.pipe.start(req.params.uri, req.parent.path, req.params.passcode, config)
    } else {
      // 2. if no passcode required, no need for a pipe server just use the original
      pipe_uri = req.params.uri
    }


    // 2. run cloudflare tunnel on the proxy
    const message = `cloudflared tunnel --url ${pipe_uri}`
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
    kernel.memory.local[req.parent.path].$share.cloudflare[pipe_uri] = cloudflare_url

    return { uri: cloudflare_url }
  }
  async stop (req, ondata, kernel) {
    // stop the cloudflare shell
    const message = `cloudflared tunnel --url ${req.params.uri}`
    await kernel.shell.kill({
      id: message
    })

    // stop pipe server
    await kernel.pipe.stop(req.params.uri, req.parent.path)

    // delete the local variable
    delete kernel.memory.local[req.parent.path].$share.cloudflare[req.params.uri]

  }

}
module.exports = C
