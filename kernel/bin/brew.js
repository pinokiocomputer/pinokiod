const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
const { glob } = require('glob')
class Brew {
  async install(bin, ondata) {
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/homebrew/homebrew.zip"
    //const installer_url = "https://github.com/Homebrew/brew/tarball/master"
    const installer = "Homebrew.zip"

    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await bin.download(installer_url, installer, ondata)

    // 2. run the script
    ondata({ raw: `unzipping installer: ${installer}...\r\n` })
    await bin.unzip("Homebrew.zip", bin.path(), null, ondata)

    ondata({ raw: "installing xcode-select. please approve the xcode-select install dialog and install before proceeding...\r\n" })
    await bin.exec({ message: "xcode-select --install" }, (stream) => { ondata(stream) })
//
    ondata({ raw: "installing gettext\r\n" })
    await bin.exec({ message: "brew install gettext --force-bottle" }, (stream) => { ondata(stream) })
//
    ondata({ raw: `Install finished\r\n` })
    return bin.rm("Homebrew.zip", ondata)
  }

  async installed(bin) {
    let e = await bin.exists("homebrew")
    return e
  }

  uninstall(bin) {
    const install_path = bin.path("homebrew")
    return bin.rm(install_path, ondata)
  }
  env(bin) {
    return {
      PATH: ["homebrew/bin", "homebrew/Cellar"].map((p) => {
        return bin.path(p)
      }),
      HOMEBREW_PREFIX: bin.path("homebrew"),
      HOMEBREW_CELLAR: bin.path("homebrew", "Cellar"),
      HOMEBREW_REPOSITORY: bin.path("homebrew"),
      HOMEBREW_CACHE: bin.path("homebrew", "cache")
    }
  }




//  constructor(bin) {
//    this.bin = bin
//    //if (bin.platform === "darwin" || bin.platform === "linux") {
//    if (bin.platform === "darwin") {
//      //this.cmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
//      this.url = "https://github.com/Homebrew/brew/tarball/master"
//      this.path = [
//        bin.path("homebrew", "bin"),
////        bin.path("homebrew", "Cellar")
//      ]
//      this.binpath = bin.path("homebrew", "bin", "brew")
//    }
////      this.cmd = `mkdir homebrew && curl -L https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1 -C homebrew`
////      this.uninstall = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"`
////      this.check = {
////        run: "brew -v",
////        pattern: "/.*Homebrew [0-9]\.[0-9]+\.[0-9]+.*/g"
////      }
//  }
//  async rm(options, ondata) {
//    ondata({ raw: "cleaning up\r\n" })
//    const folder = this.bin.path("homebrew")
//    await rimraf(folder)
//    ondata({ raw: "finished cleaning up\r\n" })
////    await this.bin.sh({
////      message: this.uninstall
////    }, (stream) => {
////      ondata(stream)
////    })
//  }
//  async install(options, ondata) {
//    //await this.bin.sh({
//    //  message: this.cmd
//    //}, (stream) => {
//    //  ondata(stream)
//    //})
//    const url_chunks = this.url.split("/")
//    const filename = url_chunks[url_chunks.length-1]
//    const filename_without_extension = filename.replace(/(\.tar\.gz|\.zip)/, "")
//    const bin_folder = this.bin.path()
//    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
//    const download_path = this.bin.path(filename)
//    ondata({ raw: "fetching " + this.url + "\r\n" })
//    const response = await fetch(this.url);
//    const fileStream = fs.createWriteStream(download_path)
//    await new Promise((resolve, reject) => {
//      response.body.pipe(fileStream);
//      response.body.on("error", (err) => {
//        reject(err);
//      });
//      fileStream.on("finish", function() {
//        resolve();
//      });
//    });
//    
//    try {
//      const homebrew_folder = this.bin.path("homebrew")
//      ondata({ raw: `decompressing to ${homebrew_folder}...\r\n` })
//      await decompress(download_path, homebrew_folder, { strip: 1})
//
//      // delete the file
//      ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
//      await fs.promises.rm(download_path)
//
//      ondata({ raw: "installing xcode-select. please approve the xcode-select install dialog and install before proceeding...\r\n" })
//      await this.bin.sh({
//        message: "xcode-select --install"
//      }, (stream) => {
//        ondata(stream)
//      })
//
//      ondata({ raw: "installing gettext\r\n" })
//      await this.bin.sh({
//        message: "brew install gettext --force-bottle"
//      }, (stream) => {
//        ondata(stream)
//      })
//
//      ondata({ raw: "installing llvm\r\n" })
//      await this.bin.sh({
//        //message: "brew install gcc llvm"
//        message: "brew install llvm"
//      }, (stream) => {
//        ondata(stream)
//      })
//
//    } catch (e) {
//      console.log("E",e)
//      ondata({ raw: e.toString() + "\r\n" })
//    }
//  }
}
module.exports = Brew
