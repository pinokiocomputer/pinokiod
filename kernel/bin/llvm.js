class LLVM {
  async install(req, ondata) {
    if (this.kernel.platform === 'darwin') {
      await bin.exec({ message: "brew install llvm" }, ondata)
    } else {
      await bin.exec({ message: "conda install -y -c conda-forge llvm", conda: "base" }, ondata)
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
    await this.kernel.bin.exec({ message: "conda remove llvm", conda: "base" }, ondata)
  }
}
module.exports = LLVM
