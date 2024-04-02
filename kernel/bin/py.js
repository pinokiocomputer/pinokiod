class Py {
  async install(req, ondata) {
    await this.kernel.exec({
      message: "git clone https://github.com/pinokiocomputer/python py",
      path: this.kernel.path("bin")
    }, ondata)
    await this.kernel.exec({
      message: "pip install -r requirements.txt",
      path: this.kernel.bin.path("py")
    }, ondata)
  }
  async installed() {
    let exists = await this.kernel.exists(this.kernel.bin.path("py"))
    return exists
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.rm(this.kernel.bin.path("py"), ondata)
  }
}
module.exports = Py
