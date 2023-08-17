const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
class Conda {
  constructor(bin) {
    this.bin = bin
    if (bin.platform === "darwin") {
      if (bin.arch === "x64") {
        this.url = "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-MacOSX-x86_64.sh"
      } else if (bin.arch === "arm64") {
        this.url = "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-MacOSX-arm64.sh"
      }
      this.path = [
        bin.path("miniconda", "bin"),
        bin.path("miniconda", "condabin")
      ]
      this.binpath = bin.path("miniconda", "bin", "conda")
    } else if (bin.platform === "win32") {
      //this.url = "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-Windows-x86_64.exe"
      this.url = "https://github.com/cocktailpeanut/miniconda/releases/download/v23.5.2/Miniconda3-py310_23.5.2-0-Windows-x86_64.exe"
      this.path = [
        bin.path("miniconda", "Scripts"),
        bin.path("miniconda", "condabin"),
      ]
      this.binpath = bin.path("miniconda", "Scripts", "conda")
    } else {
      if (bin.arch === "x64") {
        this.url = "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-Linux-x86_64.sh"
      } else if (bin.arch === "arm64") {
        this.url = "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-Linux-aarch64.sh"
      }
      this.path = [
        bin.path("miniconda", "bin"),
        bin.path("miniconda", "condabin")
      ]
      this.binpath = bin.path("miniconda", "bin", "conda")
    }
  }
  async rm(options, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    const folder = this.bin.path("miniconda")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(options, ondata) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    const bin_folder = this.bin.path()
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
    const download_path = this.bin.path(filename)
    const install_path = this.bin.path("miniconda")

    console.log({ download_path, install_path, filename })

    // 1. download
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

    // 2. run the script
    ondata({ raw: `running installer: ${filename}...\r\n` })

    let cmd
    if (this.bin.platform === "win32") {
      cmd = `start /wait ${filename} /InstallationType=JustMe /RegisterPython=0 /S /D=${install_path}`
    } else {
      cmd = `bash ${filename} -b -p ${install_path}`
    }
    console.log({ cmd })
    ondata({ raw: `${cmd}\r\n` })
    ondata({ raw: `path: ${this.bin.path()}\r\n` })
    await this.bin.sh({
      message: cmd,
      path: this.bin.path()
    }, (stream) => {
      console.log({ stream })
      ondata(stream)
    })
    ondata({ raw: `Install finished\r\n` })

    console.log("DONE")

//    let activate
//    if (this.bin.platform === 'win32') {
//      activate = this.bin.path("miniconda", "Scripts", "activate")
//    } else {
//      activate = this.bin.path("miniconda", "bin", "activate")
//    }
//    await this.bin.sh({
//      message: activate,
//    }, (stream) => {
//      ondata(stream)
//    })
//    await this.bin.sh({
//      message: "conda init",
//    }, (stream) => {
//      ondata(stream)
//    })

//    await new Promise((resolve, reject) => {
//      setTimeout(() => {
//        resolve()
//      }, 1000)
//    })
//    
    try {
      // delete the file
      ondata({ raw: "cleaning up the install script " + download_path + "\r\n"})
      await fs.promises.rm(download_path)
    } catch (e) {
      console.log("E",e)
      ondata({ raw: e.toString() + "\r\n" })
    }
  }
  
}
module.exports = Conda
