const path = require('path')
const Connector = require('./connector')
const Processor = require('./processor')
class PeerVariableRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.connector = new Connector(router)
  }
  handle(peer) {
    for(let script_path in peer.memory.local) {
      let local_variables = peer.memory.local[script_path]
      for(let key in local_variables) {
        let val = local_variables[key]
        if (typeof val === "string" && val.startsWith("http")) {
          let dial = val.replace(/https?:\/\//, '')
          if (dial.endsWith("/")) {
            dial = dial.slice(0, -1)
          }
          let api_name = this.api_name(peer.platform, peer.home, script_path)
          let domain = this.domain(api_name, key)
          if (domain) {
            if (this.has_port(dial)) {
              let match
              if (domain === "@") {
                match = `${api_name}.${peer.name}.localhost`.toLowerCase()
              } else {
                match = `${domain}.${api_name}.${peer.name}.localhost`.toLowerCase()
              }
              let parsed_dial = this.parse_ip(dial)
              this.connector.handle({
                match,
                connector: {
                  host: peer.host,
                  port: parsed_dial.port
                },
                dial,
                host: peer.host,
              })
            }
          }
        }
      }
    }
  }
}
module.exports = PeerVariableRouter
