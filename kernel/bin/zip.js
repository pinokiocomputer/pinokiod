class Zip {
  async install(bin, ondata) {
    let cmd
    if (bin.platform === 'win32') {
      cmd = "conda install -y -c conda-forge 7zip"
    } else {
      cmd = "conda install -y -c conda-forge p7zip"
    }
    await bin.exec({ message: cmd }, ondata)
  }
  async installed(bin) {
    if (bin.platform === 'win32') {
      let e = await bin.mod.conda.exists(bin, "7z.exe")
      return e
    } else {
      let e = await bin.mod.conda.exists(bin, "7z")
      return e
    }
  }
  async uninstall(bin, ondata) {
    let cmd
    if (bin.platform === 'win32') {
      cmd = "conda remove 7zip"
    } else {
      cmd = "conda remove p7zip"
    }
    await bin.exec({ message: cmd }, ondata)
  }
}
module.exports = Zip
