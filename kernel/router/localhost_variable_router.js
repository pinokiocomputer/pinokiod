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
        if (val.startsWith("http")) {
          let dial = val.replace(/https?:\/\//, '')
          let name = this.api_name(this.router.kernel.platform, this.router.kernel.homedir, script_path)
          if (this.has_port(dial)) {
            if (key === "url") {
              this.common.handle({
                match: `${name}.localhost`.toLowerCase(),
                dial,
                host: this.router.kernel.peer.host,
              })
            }
            this.common.handle({
              match: `${key}.${name}.localhost`.toLowerCase(),
              dial,
              host: this.router.kernel.peer.host,
            })
          }
        }
      }
    }
  }
}
module.exports = LocalhostVariableRouter
