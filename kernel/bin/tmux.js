class Tmux {
  cmd() {
    return "tmux"
  }
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      throw new Error("tmux is only supported on macOS and Linux")
    }
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.platform === "win32") {
      return false
    }
    return this.kernel.bin.installed.conda.has("tmux")
  }
  async uninstall(req, ondata) {
    if (this.kernel.platform === "win32") {
      return
    }
    await this.kernel.bin.exec({ message: "conda remove tmux" }, ondata)
  }
}

module.exports = Tmux
