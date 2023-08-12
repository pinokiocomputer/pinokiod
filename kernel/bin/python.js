const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Python {
  constructor (bin) {
    this.bin = bin
    if (bin.platform === "darwin") {
      if (bin.arch === "x64") {
        this.url = "https://github.com/indygreg/python-build-standalone/releases/download/20220802/cpython-3.10.6+20220802-x86_64-apple-darwin-install_only.tar.gz"
      } else if (bin.arch === "arm64") {
        this.url = "https://github.com/indygreg/python-build-standalone/releases/download/20220802/cpython-3.10.6+20220802-aarch64-apple-darwin-install_only.tar.gz"
      }
      this.path = bin.path("python", "bin")
      this.binpath = bin.path("python", "bin", "python3")
    } else if (bin.platform === "win32") {
      this.url = "https://github.com/indygreg/python-build-standalone/releases/download/20220802/cpython-3.10.6+20220802-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
      this.path = bin.path("python")
      this.binpath = bin.path("python", "python")
    } else {
      if (bin.arch === "x64") {
        this.url = "https://github.com/indygreg/python-build-standalone/releases/download/20220802/cpython-3.10.6+20220802-x86_64-unknown-linux-gnu-install_only.tar.gz"
      } else if (bin.arch === "arm64") {
        this.url = "https://github.com/indygreg/python-build-standalone/releases/download/20220802/cpython-3.10.6+20220802-aarch64-unknown-linux-gnu-install_only.tar.gz"
      }
      this.path = bin.path("python", "bin")
      this.binpath = bin.path("python", "bin", "python3")
    }
  }
  async rm(options, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.bin.path("python")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(options, ondata) {
    console.log("install", options)
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    const filename_without_extension = filename.replace(/(\.tar\.gz|\.zip)/, "")
    const bin_folder = this.bin.path()
    console.log({ url_chunks, filename, filename_without_extension, bin_folder })
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
    console.log("mkdir finished")
    const download_path = this.bin.path(filename)
    console.log("download_path", download_path)
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
      const python_folder = this.bin.path("python")
      ondata({ raw: `decompressing to ${python_folder}...\r\n` })
      await decompress(download_path, python_folder, { strip: 1})

      // delete the file
      ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
      await fs.promises.rm(download_path)
    } catch (e) {
      console.log("E",e)
      ondata({ raw: e.toString() + "\r\n" })
    }
  }
}
module.exports = Python
