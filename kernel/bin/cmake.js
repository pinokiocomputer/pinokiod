const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Cmake {
  urls = {
    darwin: "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-macos-universal.tar.gz",
    win32: "https://github.com/brechtsanders/winlibs_mingw/releases/download/13.1.0-16.0.5-11.0.0-msvcrt-r5/winlibs-x86_64-posix-seh-gcc-13.1.0-llvm-16.0.5-mingw-w64msvcrt-11.0.0-r5.zip",
    linux: {
      x64: "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-linux-x86_64.tar.gz",
      arm64: "https://github.com/Kitware/CMake/releases/download/v3.26.3/cmake-3.26.3-linux-aarch64.tar.gz"
    }
  }
  paths = {
    darwin: ["cmake/CMake.app/Contents/bin"],
    win32: ["cmake/bin"],
    linux: ["cmake/bin"]
  }
  env() {
    return (this.kernel.platform === 'win32' ? {
      CMAKE_GENERATOR: "MinGW Makefiles",
      CMAKE_OBJECT_PATH_MAX: 1024,
      PATH: this.paths[this.kernel.platform]
    } :  {
      PATH: this.paths[this.kernel.platform]
    })
  }

  async install(req, ondata) {
    await this.kernel.bin.download(this.urls[this.kernel.platform], "download.zip")
    await this.kernel.bin.unzip("download.zip", "download")
    await this.kernel.bin.mv(folder, this.kernel.bin.path("cmake"))
  }

  installed(req, ondata) {
    return this.kernel.bin.exists(this.paths[this.kernel.platform])
  }

  uninstall(req, ondata) {
    return this.kernel.bin.rm(this.paths[this.kernel.platform])
  }

}
module.exports = Cmake
