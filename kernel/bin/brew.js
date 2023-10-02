class Brew {
  async install(req, ondata) {
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/homebrew/homebrew.zip"
    //const installer_url = "https://github.com/Homebrew/brew/tarball/master"
    const installer = "Homebrew.zip"

    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await this.kernel.bin.download(installer_url, installer, ondata)

    // 2. run the script
    ondata({ raw: `unzipping installer: ${installer}...\r\n` })
    await this.kernel.bin.unzip("Homebrew.zip", this.kernel.bin.path(), null, ondata)

    ondata({ raw: "installing xcode-select. please approve the xcode-select install dialog and install before proceeding...\r\n" })
    await this.kernel.bin.exec({ message: "xcode-select --install" }, (stream) => { ondata(stream) })
//
    ondata({ raw: "installing gettext\r\n" })
    await this.kernel.bin.exec({ message: "brew install gettext --force-bottle" }, (stream) => { ondata(stream) })
//
    ondata({ raw: `Install finished\r\n` })
    return this.kernel.bin.rm("Homebrew.zip", ondata)
  }

  async installed() {
    let e = await this.kernel.bin.exists("homebrew")
    return e
  }

  uninstall(req, ondata) {
    const install_path = this.kernel.bin.path("homebrew")
    return this.kernel.bin.rm(install_path, ondata)
  }
  env() {
    return {
      PATH: ["homebrew/bin", "homebrew/Cellar"].map((p) => {
        return this.kernel.bin.path(p)
      }),
      HOMEBREW_PREFIX: this.kernel.bin.path("homebrew"),
      HOMEBREW_CELLAR: this.kernel.bin.path("homebrew", "Cellar"),
      HOMEBREW_REPOSITORY: this.kernel.bin.path("homebrew"),
      HOMEBREW_CACHE: this.kernel.bin.path("homebrew", "cache")
    }
  }
}
module.exports = Brew
