const path = require('path')
const Processor = require('./processor')
const Connector = require('./connector')
class PeerPortRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.connector = new Connector(router)
  }
  handle(peer) {
    let https_domains_mapping = this.router.info[peer.host]
    for(let dial in https_domains_mapping) {
      let parsed_dial = this.parse_ip(dial)
      if (parsed_dial.host !== peer.host) {
        // ONLY connect for 127.0.0.1 or localhost
        // DO NOT connect if it's the actual host => because it will keep creating proxies forever recursively. only need to create proxies for localhost
        let https_domains = https_domains_mapping[dial]

        // 1. if https_domains is made up of one item <port>.localhost,
        // add <port>.<account>.localhost
        // 2. if https_domains is made up of two items <port>.localhost and <port>.<account>.localhost, don't do anything
        for(let https_domain of https_domains) {
          // insert the $account value right before the last part (1234.localhost => 1234.x.localhost)
          let match
          if (https_domain.endsWith(`${peer.name}.localhost`)) {
            match = https_domain
          } else {
            let chunks = https_domain.split(".")
            chunks.splice(chunks.length - 1, 0, peer.name)
            match = chunks.join(".")
          }
          this.connector.handle({
            match,
            connector: {
              host: peer.host,
              port: parsed_dial.port
            },
            dial,
          })
        }
      }
    }
  }
}
module.exports = PeerPortRouter
