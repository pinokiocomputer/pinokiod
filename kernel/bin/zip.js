class Zip {
  cmd() {
    let cmd
    if (this.kernel.platform === 'win32') {
      cmd = "7zip"
    } else {
      cmd = "p7zip"
    }
    return cmd
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      return this.kernel.bin.installed.conda.has("7zip")
    } else {
      return this.kernel.bin.installed.conda.has("p7zip")
    }
  }
  async uninstall(req, ondata) {
    let cmd
    if (this.kernel.platform === 'win32') {
      cmd = "conda remove 7zip"
    } else {
      cmd = "conda remove p7zip"
    }
    await this.kernel.bin.exec({ message: cmd }, ondata)
  }
}
module.exports = Zip
