const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Ffmpeg {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda install -y -c conda-forge ffmpeg"
    }, ondata)
  }
  async installed() {
    let e = await this.kernel.bin.mod.conda.exists("ffmpeg*")
    console.log("e", e)
    return e
    /*
    if (this.kernel.platform === 'win32') {
      let e = await this.kernel.bin.mod.conda.exists("ffmpeg.exe")
      return e
    } else {
      let e = await this.kernel.bin.mod.conda.exists("ffmpeg")
      return e
    }
    */
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove ffmpeg"
    }, ondata)
  }
}
module.exports = Ffmpeg
