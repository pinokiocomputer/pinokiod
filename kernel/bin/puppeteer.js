const fs = require('fs')
const { rimraf } = require('rimraf')
class Puppet {
  constructor(bin) {
    this.bin = bin
    this.path = bin.path("puppet")
    this.cmd = "npm install puppeteer"
    this.env = {
      PUPPETEER_CACHE_DIR: this.bin.path("puppet")
    }
  }
  async check() {
    let node_modules_path = this.bin.path("puppet", "node_modules")
    let exists1 = await this.bin.exists(node_modules_path)

    let chrome_path = this.bin.path("puppet", "chrome")
    let exists2 = await this.bin.exists(chrome_path)

    return exists1 && exists2
  }
  async rm(options, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.bin.path("puppet")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(options, ondata) {
    await fs.promises.mkdir(this.path, { recursive: true }).catch((e) => {console.log(e) })
    await this.bin.sh({
      message: "npm init -y",
      path: this.path,
      env: this.env
    }, (stream) => {
      ondata(stream)
    })
    await this.bin.sh({
      message: this.cmd,
      path: this.path,
      env: this.env
    }, (stream) => {
      ondata(stream)
    })
  }
}
module.exports = Puppet
