const os = require('os')
const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
class Win {
  constructor(bin) {
    this.bin = bin
    this.url = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
    this.path = bin.path("vs")
  }
  async rm(options, ondata) {
    const folder = this.bin.path("vs")
    ondata({ raw: `cleaning up the folder: ${folder}\r\n` })
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
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

    //let items = ["Microsoft.VisualStudio.Component.VC.Tools.x86.x64"]
    let items = ["Microsoft.VisualStudio.Workload.VCTools"]


    let win11 = "10.0.22000"

    if (os.release().startsWith("10")) {
      let chunks = os.release().split(".")
      let version = parseInt(chunks[2])
      if (version >= 22000) {
        items.push("Microsoft.VisualStudio.Component.Windows11SDK.22621	")
      } else {
        items.push("Microsoft.VisualStudio.Component.Windows10SDK	")
      }
      let add = items.map((item) => {
        return `--add ${item}`
      }).join(" ")

      //let cmd = `start /wait ${filename} --wait --norestart --includeRecommended --nocache ${add}`
      //let cmd = `start /wait ${filename} --quiet --wait --norestart --includeRecommended --nocache ${add}`
      let cmd = `start /wait ${filename} --installPath ${this.bin.path("vs")} --quiet --wait --norestart --includeRecommended --nocache ${add}`
      ondata({ raw: `${cmd}\r\n` })
      ondata({ raw: `path: ${this.bin.path()}\r\n` })

      // set "installed.win" to false if it exists => to restart
      await this.bin.sh({
        message: cmd,
        path: this.bin.path()
      }, (stream) => {
        console.log({ stream })
        ondata(stream)
      })

   //   await fs.promises.rm(download_path)
      ondata({ raw: `Install finished\r\n` })
    } else {
      ondata({ raw: `Must be Windows 10 or above\r\n` })
    }

  }
}
module.exports = Win
