const path = require('path')
const Common = require('./common')
const Processor = require('./processor')
class LocalhostVariableRouter extends Processor {
  constructor(router) {
    super()
    this.router = router
    this.common = new Common(router)
  }
  handle (local) {
    for(let script_path in local) {
      let local_variables_for_script = local[script_path]
      for(let key in local_variables_for_script) {
        let val = local_variables_for_script[key]
        if (typeof val === "string" && val.startsWith("http")) {
          let dial = val.replace(/https?:\/\//, '')
          if (dial.endsWith("/")) {
            dial = dial.slice(0, -1)
          }
          let api_name = this.api_name(this.router.kernel.platform, this.router.kernel.homedir, script_path)
          let domain = this.domain(api_name, key)
          if (domain) {
            if (this.has_port(dial)) {
              let match
              if (domain === "@") {
                match = `${api_name}.localhost`.toLowerCase()
              } else {
                match = `${domain}.${api_name}.localhost`.toLowerCase()
              }
              this.common.handle({
                match,
                dial,
                host: this.router.kernel.peer.host,
              })
            }
          }
        }
      }
    }
  }
}
module.exports = LocalhostVariableRouter
