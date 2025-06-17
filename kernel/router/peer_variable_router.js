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
          let name = this.api_name(peer.platform, peer.home, script_path)
          if (this.has_port(dial)) {
            let parsed_dial = this.parse_ip(dial)
            if (key === "url") {
              this.connector.handle({
                match: `${name}.${peer.name}.localhost`.toLowerCase(),
                connector: {
                  host: peer.host,
                  port: parsed_dial.port
                },
                dial,
                host: peer.host,
              })
            }
            this.connector.handle({
              match:`${key}.${name}.${peer.name}.localhost`.toLowerCase(),
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
module.exports = PeerVariableRouter
