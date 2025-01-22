const fs = require('fs')
class Cloudflared {
  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    let bin = this.kernel.bin
    if (bin.platform === "darwin") {
      await this.kernel.bin.exec({
        conda: { skip: true },
        message: "brew uninstall cloudflared",
      }, ondata)
    } else if (bin.platform === "win32") {
      const folder = this.kernel.bin.path("cloudflared.exe")
      await fs.promises.rm(folder).catch((e) => {
      })
    } else {
      const folder = this.kernel.bin.path("cloudflared")
      await fs.promises.rm(folder).catch((e) => {
      })
    }
    ondata({ raw: "finished cleaning up\r\n" })
  }
  async install(req, ondata) {
    let bin = this.kernel.bin
    if (bin.platform === "darwin") {
      await this.kernel.bin.exec({
        conda: { skip: true },
        message: "brew install cloudflared",
      }, ondata)
    } else if (bin.platform === "win32") {
      const url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
      const dest = "cloudflared.exe"
      await this.kernel.bin.download(url, dest, ondata)
    } else {
      let url
      if (bin.arch === "x64") {
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
      } else if (bin.arch === "arm64") {
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
      }
      const dest = "cloudflared"
      await this.kernel.bin.download(url, dest, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      let e = await this.kernel.bin.exists("cloudflared.exe")
      return e
    } else if (this.kernel.platform === "darwin") {
      return this.kernel.bin.installed.brew.has("cloudflared")
    } else {
      let e = await this.kernel.bin.exists("cloudflared")
      return e
    }
  }
}
module.exports = Cloudflared
