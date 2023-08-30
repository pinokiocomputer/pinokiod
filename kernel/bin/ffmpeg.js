const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Ffmpeg {
  constructor (bin) {
    this.bin = bin
    if (bin.platform === "darwin") {
      this.url = [
        "https://evermeet.cx/ffmpeg/ffmpeg-111795-g95433eb3aa.zip",
        "https://evermeet.cx/ffmpeg/ffprobe-111833-gb5273c619d.zip"
      ]
      this.path = bin.path("ffmpeg")
    } else if (bin.platform === "win32") {
      this.url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
      this.path = bin.path("ffmpeg", "bin")
    } else {
      if (bin.arch === "x64") {
        this.url = "https://github.com/cocktailpeanut/bin/releases/download/ffmpeg-linux/ffmpeg-git-20230721-amd64-static.zip"
      } else if (bin.arch === "arm64") {
        this.url = "https://github.com/cocktailpeanut/bin/releases/download/ffmpeg-linux/ffmpeg-git-20230721-arm64-static.zip"
      }
      this.path = bin.path("ffmpeg")
    }
  }
  async rm(options, ondata) {
    const folder = this.bin.path("ffmpeg")
    ondata({ raw: `cleaning up the folder: ${folder}\r\n` })
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(options, ondata) {
    let urls = Array.isArray(this.url) ? this.url : [this.url]
    for(let url of urls) {
      const url_chunks = url.split("/")
      const filename = url_chunks[url_chunks.length-1]
      const filename_without_extension = filename.replace(/(\.tar\.gz|\.zip)/, "")
      const bin_folder = this.bin.path()
      await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => {console.log(e) })
      const download_path = this.bin.path(filename)
      ondata({ raw: "fetching " + url + "\r\n" })
      const response = await fetch(url);
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
      
    //    const unzipped_path = path.resolve(bin_folder, filename_without_extension)
      try {
        const ffmpeg_folder = this.bin.path("ffmpeg")
        ondata({ raw: `decompressing to ${ffmpeg_folder}...\r\n` })
        await decompress(download_path, ffmpeg_folder, { strip: 1})

        // delete the file
        ondata({ raw: "removing the compressed file " + download_path + "\r\n"})
        await fs.promises.rm(download_path)
      } catch (e) {
        ondata({ raw: e.toString() + "\r\n" })
      }
    }
  }
}
module.exports = Ffmpeg
