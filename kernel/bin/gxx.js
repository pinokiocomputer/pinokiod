class GXX {
  cmd() {
    if (this.kernel.platform === "linux") {
      return "'gxx<12'"
    } else {
      return ""
    }
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
    return this.kernel.bin.installed.conda.has("gxx")
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove gxx",
    }, ondata)
  }
}
module.exports = GXX
