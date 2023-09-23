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
    let e = await bin.exists("miniconda/bin/7z")
    return e
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
