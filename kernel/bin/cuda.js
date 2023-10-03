class Cuda {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      //message: "conda install -y cudnn cudatoolkit -c nvidia"
      message: "conda install -y cudnn -c conda-forge"
    }, ondata)
    await this.kernel.bin.exec({
      //message: "conda install -y cudnn cudatoolkit -c nvidia"
      message: "conda install -y cudatoolkit -c conda-forge"
    }, ondata)
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      let e1 = await this.kernel.bin.mod.conda.exists("cudnn*")
      let e2 = await this.kernel.bin.mod.conda.exists("cudatoolkit*")
      console.log({ e1, e2 })
      return e1 && e2
    } else {
      let e = await this.kernel.bin.mod.conda.exists("cudnn")
      return e
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove cudnn cudatoolkit"
    }, ondata)
  }
}
module.exports = Cuda
