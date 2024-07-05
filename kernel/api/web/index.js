const path = require('path')
class Web {
  /*
  {
    method: "web.expose",
    params: {
      uri: "{{local.uri}}"
    }
  }
  */
  async expose(req, ondata, kernel) {
    let parent_path = req.parent.path
    let userdir = path.resolve(kernel.homedir, "api")
    let rel_path= path.relative(userdir, parent_path)
    let app = rel_path.split(path.sep)[0]
    let uri = req.params.uri
    console.log({ userdir, rel_path, app })
    ondata({
      raw: `\r\n[Exposing Web URL] /app/${app} => ${req.params.uri}\r\n`
    })
    kernel.exposed[app] = req.params.uri
    console.log("kernel.exposed", kernel.exposed)
  }
}
module.exports = Web
