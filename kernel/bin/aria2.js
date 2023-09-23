const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Aria2 {
  async install(bin, ondata) {
    if (bin.platform === 'win32') {
      const url = "https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-win-64bit-build1.zip"
      const dest = "aria2-1.36.0-win-64bit-build1.zip"
      await bin.download(url, dest, ondata)
      await bin.unzip(dest, "aria2", ondata)
    } else {
      await bin.exec({ message: "conda install -y -c conda-forge aria2" }, ondata)
    }
  }
  async installed(bin) {
    if (bin.platform === 'win32') {
      let e = await bin.exists("aria2")
      return e
    } else {
      let e = await bin.exists("miniconda/bin/aria2")
      return e
    }
  }
  async uninstall(bin, ondata) {
    if (bin.platform === 'win32') {
      await bin.rm("aria2", ondata)
    } else {
      await bin.exec({ message: "conda remove aria2" }, ondata)
    }
  }
  env(bin) {
    if (bin.platform === 'win32') {
      return {
PATH: [bin.path("aria2")]
      }
    }
  }
}
module.exports = Aria2
