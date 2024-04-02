const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Ffmpeg {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda install -y -c conda-forge ffmpeg",
    }, ondata)
  }
  async installed() {
    return this.kernel.bin.installed.conda.has("ffmpeg")
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove ffmpeg",
    }, ondata)
  }
}
module.exports = Ffmpeg
