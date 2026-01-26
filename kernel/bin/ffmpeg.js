const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Ffmpeg {
  cmd() {
    return "ffmpeg=5.1.2"
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.bin.installed.conda && this.kernel.bin.installed.conda_versions) {
      let version = this.kernel.bin.installed.conda_versions.ffmpeg
      if (version !== "5.1.2") {
        return false
      }
    }
    return this.kernel.bin.installed.conda.has("ffmpeg")
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove ffmpeg",
    }, ondata)
  }
}
module.exports = Ffmpeg
