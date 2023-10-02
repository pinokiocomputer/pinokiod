class LLVM {
  async install(req, ondata) {
    if (this.kernel.platform === 'darwin') {
      await bin.exec({ message: "brew install llvm" }, ondata)
    } else {
      await bin.exec({ message: "conda install -y -c conda-forge llvm" }, ondata)
    }
  }
  async installed() {
    let e = await this.kernel.bin.exists("miniconda/bin/llvm")
    console.log("E", e)
    return e
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({ message: "conda remove llvm" }, ondata)
  }
}
module.exports = LLVM
