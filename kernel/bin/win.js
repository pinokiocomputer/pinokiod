const os = require('os')
const path = require('path')
const fs = require('fs')
const fetch = require('cross-fetch')
const decompress = require('decompress');
const { rimraf } = require('rimraf')
class Win {
  constructor(bin) {
    this.bin = bin
    //this.url = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
    //this.url = "https://aka.ms/vs/16/release/vs_buildtools.exe"
    this.url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    this.path = bin.path("vs")
    //this.check = async () => {
    //  let msvc_path = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Tools\\MSVC"
    //  let exists = await this.bin.exists(msvc_path)
    //  console.log("Exists?", msvc_path, exists)
    //  return exists
    //}
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
    let items = ["Microsoft.VisualStudio.Workload.VCTools"]
    let add = items.map((item) => {
      return `--add ${item}`
    }).join(" ")
    //let cmd = `start /wait ${filename} ${mode ? mode: ''} --passive --wait --includeRecommended --nocache ${add}`
    let cmd = `start /wait ${filename} ${mode ? mode: ''} --installPath ${this.bin.path("vs")} --passive --wait --includeRecommended --nocache ${add}`

    return cmd
  }
  async install(options, ondata) {

    // 1. Set registry to allow long paths
    await this.bin.sh({
      message: "reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f"
    }, (stream) => {
      ondata(stream)
    })


    // 2. Install Visual Studio Build Tools
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
