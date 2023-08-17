const os = require('os')
const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
class Win {
  constructor(bin) {
    this.bin = bin
    this.url = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
    this.check = async () => {
      let installed = (await this.bin.kernel.loader.load(this.bin.path('installed.json'))).resolved
      if (installed && installed.win) {
        return true
      }
      return false
    }
  }
  async rm(options, ondata) {
  }
  async install(options, ondata) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
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

    let items = ["Microsoft.VisualStudio.Component.VC.Tools.x86.x64"]
    if (os.release().startsWith("10")) {
      items.push("Microsoft.VisualStudio.Component.Windows10SDK	")
    } else if (os.release().startsWith("11")) {
      items.push("Microsoft.VisualStudio.Component.Windows11SDK.22621	")
    }
    let add = items.map((item) => {
      return `--add ${item}`
    }).join(" ")

    let cmd = `start /wait ${filename} --quiet --wait --norestart --includeRecommended --nocache ${add}`
    ondata({ raw: `${cmd}\r\n` })
    ondata({ raw: `path: ${this.bin.path()}\r\n` })

    // set "installed.win" to false if it exists => to restart
    let installed = (await this.bin.kernel.loader.load(this.bin.path('installed.json'))).resolved
    if (installed) {
      installed.win = false
      await fs.promises.writeFile(this.bin.path("installed.json"), JSON.stringify(installed))
    } else {
      installed = {}
    }
    await this.bin.sh({
      message: cmd,
      path: this.bin.path()
    }, (stream) => {
      console.log({ stream })
      ondata(stream)
    })

    installed.win = true
    await fs.promises.writeFile(this.bin.path("installed.json"), JSON.stringify(installed))
    await fs.promises.rm(download_path)
    ondata({ raw: `Install finished\r\n` })
  }
}
module.exports = Win
