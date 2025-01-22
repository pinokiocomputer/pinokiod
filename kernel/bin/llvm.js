class LLVM {
  async install(req, ondata) {
    if (this.kernel.platform === 'darwin') {
      await bin.exec({ conda: { skip: true }, message: "brew install llvm" }, ondata)
    } else {
      await bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y -c conda-forge llvm"
        ]
//        conda: {
//          name: "base",
//          activate: "minimal"
//        }
      }, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === 'darwin') {
      return this.kernel.bin.installed.brew.has("llvm")
    } else {
      return this.kernel.bin.installed.conda.has("llvm")
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({ message: "conda remove llvm" }, ondata)
  }
}
module.exports = LLVM
