const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class UV {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda install -y -c conda-forge uv",
    }, ondata)
  }
  async installed() {
    return this.kernel.bin.installed.conda.has("uv")
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove uv",
    }, ondata)
  }
}
module.exports = UV
