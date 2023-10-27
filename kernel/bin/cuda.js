class Cuda {
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.exec({
        message: "conda install -y cudnn cudatoolkit libzlib-wapi -c conda-forge"
      }, ondata)
    } else {
      await this.kernel.bin.exec({
        message: "conda install -y cudnn cudatoolkit -c conda-forge"
      }, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      return this.kernel.bin.installed.conda.has("cudnn") &&
        this.kernel.bin.installed.conda.has("cudatoolkit") &&
        this.kernel.bin.installed.conda.has("libzlib-wapi")
    } else {
      return this.kernel.bin.installed.conda.has("cudnn") &&
        this.kernel.bin.installed.conda.has("cudatoolkit")
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove cudnn cudatoolkit"
    }, ondata)
  }
}
module.exports = Cuda
