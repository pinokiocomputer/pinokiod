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
    let port = chunks[chunks.length-1]
    let host = chunks.slice(0, chunks.length-1).join(":")
    return { host, port }
  }
}
module.exports = Processor
