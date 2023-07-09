const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Cmake {
  constructor (bin) {
    this.bin = bin
    if (bin.platform === "darwin") {
      this.url = "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-macos-universal.tar.gz"
      this.path = bin.path("cmake", "CMake.app", "Contents", "bin")
    } else if (bin.platform === "win32") {
      if (bin.arch === "x64") {
        //this.url = "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-windows-x86_64.zip"
        this.url = "https://github.com/brechtsanders/winlibs_mingw/releases/download/13.1.0-16.0.5-11.0.0-msvcrt-r5/winlibs-x86_64-posix-seh-gcc-13.1.0-llvm-16.0.5-mingw-w64msvcrt-11.0.0-r5.zip"
      } else if (bin.arch === "arm64") {
        this.url = "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-windows-arm64.zip"
      }
      this.path = bin.path("cmake", "bin")
    } else {
      if (bin.arch === "x64") {
        this.url = "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-linux-x86_64.tar.gz"
      } else if (bin.arch === "arm64") {
        this.url = "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-linux-aarch64.tar.gz"
      }
      this.path = bin.path("cmake", "bin")
    }
  }
  async rm(options, ondata) {
    const folder = this.bin.path("cmake")
    ondata({ raw: `cleaning up the folder: ${folder}\r\n` })
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(options, ondata) {
    const url_chunks = this.url.split("/")
    const filename = url_chunks[url_chunks.length-1]
    const filename_without_extension = filename.replace(/(\.tar\.gz|\.zip)/, "")
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
      fileStream.on("close", function() {
        resolve();
      });
    });
    
  //    const unzipped_path = path.resolve(bin_folder, filename_without_extension)
    try {
      const cmake_folder = this.bin.path("cmake")
      ondata({ raw: `decompressing to ${cmake_folder}...\r\n` })
      await decompress(download_path, cmake_folder, { strip: 1})

      // delete the file
      ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
      await fs.promises.rm(download_path)
    } catch (e) {
      ondata({ raw: e.toString() + "\r\n" })
    }
  }
}
module.exports = Cmake
