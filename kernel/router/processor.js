const path = require('path')
class Processor {
  has_port(str) {
    let chunks = str.split(":")
    return chunks.length === 2
  }
  api_name(platform, home, str) {
    let api_path
    let rel_path
    let name
    let _path
    if (platform === 'win32') {
      _path = path.win32
      api_path = _path.resolve(home, "api")
      rel_path = _path.relative(api_path, str)
    } else {
      _path = path.posix
      api_path = _path.resolve(home, "api")
      rel_path = _path.relative(api_path, str)
    }
    name = rel_path.split(_path.sep)[0]
    return name
  }
  parse_ip(str) {
    let chunks = str.split(":")
    let port = chunks[chunks.length-1].replace(/[^0-9]/g, '')
    let host = chunks.slice(0, chunks.length-1).join(":")
    return { host, port }
  }
  domain (api_name, key) {
    let config = this.router.kernel.pinokio_configs[api_name]
    let dns = config.dns
    for(let domain in dns) {
      let routes = dns[domain]
      for(let route of routes) {
        // $local.url@start ==> start.js/start.json 'url' local variable
        if (route.startsWith("$")) {
          let chunks = route.split("@")
          if (chunks.length === 2) {
            let [memory, filepath] = chunks
            if (memory.startsWith("$local.")) {
              let varname = memory.replace("$local.", "") 
              if (key === varname) {
                return domain
              }
            }
          }
        } else {
          // file path
          return domain
        }
      }
    }
  }
}
module.exports = Processor
