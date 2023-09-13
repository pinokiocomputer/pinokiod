const path = require('path')
const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
class Cuda {
  constructor(bin) {
    this.bin = bin
    this.check = async () => {
      // check bin/miniconda/pkgs folder for cudatoolkit and cudnn
      const cwd = this.bin.path("miniconda", "pkgs")
      const cudnn = await glob('cudnn*', { cwd })
      const cudatoolkit = await glob('cudatoolkit*', { cwd })
      console.log({ cwd, cudnn, cudatoolkit })
      return cudnn.length > 0 && cudatoolkit.length > 0
    }
  }
  async rm(options, ondata) {
    if (this.path) {
      const folder = this.bin.path("git")
      ondata({ raw: `cleaning up the folder: ${folder}\r\n` })
      await rimraf(folder)
      ondata({ raw: "finished cleaning up\r\n" })
    } else if (this.uninstall) {
      await this.bin.sh({
        message: this.uninstall
      }, (stream) => {
        ondata(stream)
      })
    }
  }
  async install(options, ondata) {
    // check if it supports cuda
    await this.bin.sh({
      message: "nvidia-smi"
    }, (stream) => {
      ondata(stream)
    })
    if (this.url) {
      const url_chunks = this.url.split("/")
      const filename = url_chunks[url_chunks.length-1]
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
        fileStream.on("finish", function() {
          resolve();
        });
      });
      try {
        const folder = this.bin.path("git")
        ondata({ raw: `decompressing to ${folder}...\r\n` })
        await new Promise((resolve, reject) => {
          _7z.unpack(download_path, folder, (err) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          });
        })
        // delete the file
        ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
        await fs.promises.rm(download_path)
      } catch (e) {
        ondata({ raw: e.toString() + "\r\n" })
      }
    } else if (this.cmd) {
      await this.bin.sh({
        message: this.cmd
      }, (stream) => {
        ondata(stream)
      })
    }
  }
}
module.exports = Cuda
