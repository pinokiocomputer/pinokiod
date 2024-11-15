/*
const proxy = new Minproxy()

// 1. start the proxy for url
const generated_url = await proxy.start(url)

// 2. stop the proxy for url
proxy.stop(url)

// 3. get the proxy url for a given url
const proxy_url = proxy.url(url)

// 4. get all proxies
const proxies = proxy.all()

*/
const httpProxy = require('http-proxy');
const portfinder = require('portfinder-cp');
const os = require('os')
class Lproxy {
  constructor() {
    this.proxies = {}
    this.ip = this.local()
  }
  async start (url, options) {
    let port
    if (options && options.port) {
      port = options.port
      console.log("start proxy at port", port)
      delete options.port
    }
    let o = Object.assign({
      target: url,
      ws: true,
      localAddress: '0.0.0.0',
    },  options)
    console.log("proxy object", o)
    const proxy = httpProxy.createProxyServer(o)
    // get a new port
    if (!port) {
      port = await portfinder.getPortPromise({
        //port: 42420
        port: 44000
      })
    }
    proxy.listen(port)
    proxy.on('close', (res, socket, head) => {
      console.log('Client disconnected');
    });
    proxy.on('error', (e) => {
      console.log('Proxy Error', e)
    });

    this.proxies[url] = proxy
    return `http://${this.ip}:${port}`
  }
  async stop (url) {
    console.log("proxies", this.proxies, url)
    let p = this.proxies[url]
    if (p) {
      p.close()
    }
  }
  local() {
    const interfaces = Object.values(os.networkInterfaces())
    let addr
    for (let iface of interfaces) {
      for (let alias of iface) {
        if (alias.family === "IPv4" && alias.address !== "127.0.0.1" && !alias.internal) {
          return alias.address
        }
      }
    }
  }
}
module.exports = Lproxy
