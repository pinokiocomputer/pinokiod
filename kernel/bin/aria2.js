const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Aria2 {
  constructor(bin) {
    this.bin = bin
    if (bin.platform === "darwin") {
      // brew
      this.cmd = "brew install aria2"
      this.uninstall = "brew uninstall aria2"
      this.check = async () => {
        let aria2_path = this.bin.path("homebrew", "bin", "aria2c")
        let exists = await this.bin.exists(aria2_path)
        return exists
      }
    } else if (bin.platform === "win32") {
      // portable git
      this.url = "https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-win-64bit-build1.zip"
      this.path = bin.path("aria2")
    } else if (bin.platform === 'linux') {
      this.url = "https://github.com/aria2/aria2/releases/download/release-1.36.0/aria2-1.36.0-aarch64-linux-android-build1.zip"
      this.path = bin.path("aria2")
    }
  }
  async rm(options, ondata) {
    if (this.path) {
      ondata({ raw: `cleaning up the folder: ${this.path}\r\n` })
      await rimraf(this.path)
      ondata({ raw: "finished cleaning up\r\n" })
    } else if (this.uninstall) {
      await this.bin.sh({
        message: this.uninstall
      }, (stream) => {
        ondata(stream)
      })
    }
  }
  async install(options, ondata) {
    if (this.url) {
      const url_chunks = this.url.split("/")
      const filename = url_chunks[url_chunks.length-1]
      const bin_folder = this.bin.path()
      await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
      const download_path = this.bin.path(filename)
      ondata({ raw: "fetching " + this.url + "\r\n" })
      const response = await fetch(this.url);
      const fileStream = fs.createWriteStream(download_path)
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on("error", (err) => {
          reject(err);
        });
        fileStream.on("finish", function() {
          resolve();
        });
      });
      try {
        const folder = this.bin.path("aria2")
        ondata({ raw: `decompressing to ${folder}...\r\n` })

        await decompress(download_path, folder, { strip: 1})
        await fs.promises.rm(download_path)

      } catch (e) {
        ondata({ raw: e.toString() + "\r\n" })
      }
    } else if (this.cmd) {
      await this.bin.sh({
        message: this.cmd
      }, (stream) => {
        ondata(stream)
      })
    }
  }
}
module.exports = Aria2
