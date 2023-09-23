class LLVM {
  async install(bin, ondata) {
    if (bin.platform === 'darwin') {
      await bin.exec({ message: "brew install llvm" }, ondata)
    } else {
      await bin.exec({ message: "conda install -y -c conda-forge llvm" }, ondata)
    }
  }
  async installed(bin) {
    let e = await bin.exists("miniconda/bin/llvm")
    console.log("E", e)
    return e
  }
  async uninstall(bin, ondata) {
    await bin.exec({ message: "conda remove llvm" }, ondata)
  }
}
module.exports = LLVM
