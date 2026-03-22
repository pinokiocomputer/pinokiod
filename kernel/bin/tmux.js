const path = require("path")

class Tmux {
  windowsUrl = "https://github.com/itefixnet/itmux/releases/download/v1.1.0/itmux_1.1.0_x64_free.zip"

  cmd() {
    return "tmux"
  }
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      if (this.kernel.arch !== "x64") {
        throw new Error(`itmux only has a Windows x64 release (current arch: ${this.kernel.arch})`)
      }
      const dest = path.basename(new URL(this.windowsUrl).pathname)
      await this.kernel.bin.rm("tmux", ondata)
      await this.kernel.bin.download(this.windowsUrl, dest, ondata)
      await this.kernel.bin.unzip(dest, this.kernel.bin.path("tmux"), null, ondata)
      await this.kernel.bin.rm(dest, ondata)
    } else {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          `conda install -y -c conda-forge ${this.cmd()}`
        ]
      }, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === "win32") {
      return this.kernel.bin.exists("tmux/bin/tmux.exe")
    } else {
      return this.kernel.bin.installed.conda.has("tmux")
    }
  }
  async uninstall(req, ondata) {
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.rm("tmux", ondata)
    } else {
      await this.kernel.bin.exec({ message: "conda remove tmux" }, ondata)
    }
  }
  env() {
    if (this.kernel.platform === "win32") {
      return {
        PATH: [this.kernel.bin.path("tmux/bin")]
      }
    }
  }
}

module.exports = Tmux
