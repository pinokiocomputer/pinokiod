const fs = require('fs')
const path = require('path')
const Common = require('./common')
const Rewriter = require('./rewriter')
const Connector = require('./connector')
const Processor = require('./processor')
class LocalhostStaticRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.common = new Common(router)
    this.connector = new Connector(router)
    this.rewriter = new Rewriter(router)
  }
  handle () {
    let configs = []
    for(let api_name in this.router.kernel.pinokio_configs) {
      let config = this.router.kernel.pinokio_configs[api_name]
      if (config.dns) {
        configs.push({
          api_name,
          config
        })
      }
    }
    for(let { api_name, config } of configs) {
      const apiRoot = this.router.kernel.path('api', api_name)
      const indexPath = path.join(apiRoot, 'index.html')
      const hasMenu = Boolean(config.menu)
      if (hasMenu) {
        delete this.router.rewrite_mapping[api_name]
        continue
      }
      const hasIndex = fs.existsSync(indexPath)
      const fileServerOptions = {}
      if (hasIndex) {
        fileServerOptions.index_names = ["index.html"]
      }
      const effectiveFileServerOptions = Object.keys(fileServerOptions).length ? { ...fileServerOptions } : undefined
      for(let domain in config.dns) {
        let localhost_match
        let peer_match
        if (domain === "@") {
          localhost_match = `${api_name}.localhost`.toLowerCase()
          peer_match = `${api_name}.${this.router.kernel.peer.name}.localhost`.toLowerCase()
        } else {
          localhost_match = `${domain}.${api_name}.localhost`.toLowerCase()
          peer_match = `${domain}.${api_name}.${this.router.kernel.peer.name}.localhost`.toLowerCase()
        }

        let routes = config.dns[domain]
        for(let route of routes) {
          if (!route.startsWith("$") && !route.startsWith(":")) {
            let chunks = route.split("/")
            let local_dial = `${this.router.default_host}:${this.router.default_port}`
            let peer_dial = `${this.router.kernel.peer.host}:${this.router.default_port}`
            let rewrite = `/asset/api/${api_name}`
            this.rewriter.handle({
              route: rewrite,
              match: [localhost_match],
              dial: local_dial,
              fileServerOptions: effectiveFileServerOptions,
            })
            this.rewriter.handle({
              route: rewrite,
              match: [peer_match],
              dial: peer_dial,
              fileServerOptions: effectiveFileServerOptions,
            })

//            this.router.add_rewrite({ route: new_path, match, peer, dial })


/*
        name: web
        internal_router: ["127.0.0.1:42000/asset/api/web", "https://web.localhost"]
        external_ip: ["192.168.1.49:42000/asset/api/web"]
        external_router ["https://web.x.localhost"]
        */

            

            const rewriteEntry = {
              name: api_name,
              internal_router: [
                `${local_dial}${rewrite}`,
                localhost_match
              ],
              external_ip: `${peer_dial}${rewrite}`,
              external_router: [
                peer_match
              ]
            }
            if (effectiveFileServerOptions) {
              rewriteEntry.file_server_options = effectiveFileServerOptions
            }
            this.router.rewrite_mapping[api_name] = rewriteEntry
//            this.connector.handle({
//              match: peer_match,
//              connector: {
//                host: this.router.kernel.peer.host,
//                port: this.router.default_port,
//              },
//              dial,
//              host: this.router.kernel.peer.host,
//            })
          }
        } 
      }
    }
  }
}
module.exports = LocalhostStaticRouter
