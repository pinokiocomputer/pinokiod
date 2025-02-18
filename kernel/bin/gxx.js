class GXX {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      //message: "conda install -y nodejs=22.12.0 -c conda-forge"
      message: [
        "conda clean -y --all",
        "conda install -y -c conda-forge 'gxx<12'"
      ]
//      conda: {
//        name: "base",
//        activate: "minimal"
//      }
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
