  /*
    env(kernel)
    init(kernel)
    installed(kernel)
    install(req, ondata, kernel)
    uninstall(req, ondata, kernel)
  */
const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Aria2 {
  async install(req, ondata) {
    if (this.kernel.platform === 'win32') {
      const url = "https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-win-64bit-build1.zip"
      const dest = "aria2-1.36.0-win-64bit-build1.zip"
      await this.kernel.bin.download(url, dest, ondata)
      await this.kernel.bin.unzip(dest, "aria2", ondata)
    } else {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y -c conda-forge aria2"
        ]
      }, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      let e = await this.kernel.bin.exists("aria2")
      return e
    } else {
      return this.kernel.bin.installed.conda.has("aria2")
    }
  }
  async uninstall(req, ondata) {
    if (this.kernel.platform === 'win32') {
      await this.kernel.bin.rm("aria2", ondata)
    } else {
      await this.kernel.bin.exec({ message: "conda remove aria2" }, ondata)
    }
  }
  env() {
    if (this.kernel.platform === 'win32') {
      return {
        PATH: [this.kernel.bin.path("aria2")]
      }
    }
  }
}
module.exports = Aria2
