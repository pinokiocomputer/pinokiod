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
//    try {
//      if (os.release().startsWith("10")) {
//
//        const url_chunks = this.url.split("/")
//        const filename = url_chunks[url_chunks.length-1]
//        const download_path = this.bin.path(filename)
//        let exists = await this.bin.exists(download_path)
//        if (!exists) {
//          ondata({ raw: "fetching " + this.url + "\r\n" })
//          const response = await fetch(this.url);
//          const fileStream = fs.createWriteStream(download_path)
//          await new Promise((resolve, reject) => {
//            response.body.pipe(fileStream);
//            response.body.on("error", (err) => {
//              reject(err);
//            });
//            fileStream.on("finish", function() {
//              resolve();
//            });
//          });
//        }
//
//        let cmd = this.cmd("uninstall")
//        ondata({ raw: `${cmd}\r\n` })
//        ondata({ raw: `path: ${this.bin.path()}\r\n` })
//
//        // set "installed.win" to false if it exists => to restart
//        await this.bin.sh({
//          message: cmd,
//          path: this.bin.path()
//        }, (stream) => {
//          console.log({ stream })
//          ondata(stream)
//        })
//
//    //   await fs.promises.rm(download_path)
//        ondata({ raw: `Unnstall finished\r\n` })
//
//      }
//    } catch (e) {
//      ondata({ raw: e.stack })
//    }
  }
  cmd(mode) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    //let items = ["Microsoft.VisualStudio.Component.VC.Tools.x86.x64"]
    //let items = ["Microsoft.VisualStudio.Workload.VCTools", "Microsoft.VisualStudio.Workload.NativeDesktop"]
    let items = ["Microsoft.VisualStudio.Workload.VCTools"]
//    let chunks = os.release().split(".")
//    let version = parseInt(chunks[2])
//    if (version >= 22000) {
//      items.push("Microsoft.VisualStudio.Component.Windows11SDK.22621")
//    } else {
//      items.push("Microsoft.VisualStudio.Component.Windows10SDK")
//    }
    let add = items.map((item) => {
      return `--add ${item}`
    }).join(" ")
    //let cmd = `start /wait ${filename} ${mode ? mode: ''} --installPath ${this.bin.path("vs")} --passive --wait --norestart --includeRecommended --downloadThenInstall --nocache ${add}`
    //let cmd = `start /wait ${filename} ${mode ? mode: ''} --installPath ${this.bin.path("vs")} --clean --quiet --wait --norestart --includeRecommended --downloadThenInstall --nocache ${add}`


    //let cmd = `start /wait ${filename} ${mode ? mode: ''} --installPath ${this.bin.path("vs")} --quiet --wait --includeRecommended --nocache ${add}`
    let cmd = `start /wait ${filename} ${mode ? mode: ''} --installPath ${this.bin.path("vs")} --wait --includeRecommended --nocache ${add}`
    return cmd
  }
  async install(options, ondata) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    const download_path = this.bin.path(filename)


    let exists = await this.bin.exists(download_path)
    if (!exists) {
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
    }
    if (os.release().startsWith("10")) {
      let cmd = this.cmd()
      ondata({ raw: `${cmd}\r\n` })
      ondata({ raw: `path: ${this.bin.path()}\r\n` })

//      await fs.promises.mkdir(this.bin.path("vs")).catch((e) => { })

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
