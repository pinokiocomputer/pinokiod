class Zip {
  async install(req, ondata) {
    let cmd
    if (this.kernel.platform === 'win32') {
      cmd = "conda install -y -c conda-forge 7zip"
    } else {
      cmd = "conda install -y -c conda-forge p7zip"
    }
    await this.kernel.bin.exec({ message: cmd }, ondata)
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      let e = await this.kernel.bin.mod.conda.exists("7z.exe")
      return e
    } else {
      let e = await this.kernel.bin.mod.conda.exists("7z")
      return e
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
