const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Node {
  constructor () {
    let bin = this.kernel.bin
    if (bin.platform === "darwin") {
      if (bin.arch === "x64") {
        this.url = "https://nodejs.org/dist/v18.16.0/node-v18.16.0-darwin-x64.tar.gz"
      } else if (bin.arch === "arm64") {
        this.url = "https://nodejs.org/dist/v18.16.0/node-v18.16.0-darwin-arm64.tar.gz"
      }
      this.path = bin.path("node", "bin")
    } else if (bin.platform === "win32") {
      //this.url = "https://nodejs.org/dist/v18.16.0/node-v18.16.0-win-x64.zip"
      this.url = "https://github.com/cocktailpeanut/nodejs/releases/download/v18.6.0/node-v18.16.0-win-x64.zip"
      this.path = bin.path("node")
    } else {
      if (bin.arch === "x64") {
        this.url = "https://nodejs.org/download/release/v18.16.0/node-v18.16.0-linux-x64.tar.gz"
      } else if (bin.arch === "arm64") {
        this.url = "https://nodejs.org/download/release/v18.16.0/node-v18.16.0-linux-arm64.tar.gz"
      }
      this.path = bin.path("node", "bin")
    }
  }
  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.kernel.bin.path("node")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(req, ondata) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    const filename_without_extension = filename.replace(/(\.tar\.gz|\.zip)/, "")
    const bin_folder = this.kernel.bin.path()
    console.log({ url_chunks, filename, filename_without_extension, bin_folder })
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
    console.log("mkdir finished")
    const download_path = this.kernel.bin.path(filename)
    console.log("download_path", download_path)
    ondata({ raw: "fetching " + this.url + "\r\n" })
    const response = await fetch(this.url, {
      headers: {
        'User-Agent': 'curl/7.47.0'
      }
    });
    const fileStream = fs.createWriteStream(download_path)
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", (err) => {
        console.log("ERROR", err)
        reject(err);
      });
      fileStream.on("finish", () => {
        resolve();
      });
    });
    console.log("FINISHED Downloading node.js")
    
    try {
      const node_folder = this.kernel.bin.path("node")
      ondata({ raw: `decompressing to ${node_folder}...\r\n` })
      await decompress(download_path, node_folder, { strip: 1})

      // delete the file
      ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
      await fs.promises.rm(download_path)
    } catch (e) {
      ondata({ raw: e.toString() + "\r\n" })
    }
  }
}
module.exports = Node
