const SEVEN_ZIP_VERSION = "23.01"

class Zip {
  description = "Installs 7zip or p7zip for archive extraction."
  cmd() {
    let cmd
    if (this.kernel.platform === 'win32') {
      cmd = `7zip=${SEVEN_ZIP_VERSION}`
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
      if (this.kernel.bin.installed.conda_versions) {
        let version = this.kernel.bin.installed.conda_versions["7zip"]
        if (version !== SEVEN_ZIP_VERSION) {
          return false
        }
      }
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
