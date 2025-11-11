const fs = require('fs')
const path = require('path')

const { detectCommandLineTools } = require('./xcode-tools')
class Brew {
  description = "Wait for an install pop-up, then approve."
  async install(req, ondata) {
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/homebrew/homebrew.zip"
    //const installer_url = "https://github.com/Homebrew/brew/tarball/master"
    const installer = "Homebrew.zip"

    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await this.kernel.bin.download(installer_url, installer, ondata)
    console.log("## DOWNLOADED")

    console.log("homebrewpath", this.kernel.bin.path("homebrew"))
    await this.kernel.bin.rm("homebrew", ondata)

    // 2. run the script
    ondata({ raw: `unzipping installer: ${installer}...\r\n` })
    await this.kernel.bin.unzip("Homebrew.zip", this.kernel.bin.path(), null, ondata)
    await this.kernel.bin.rm("Homebrew.zip", ondata)

    if (this.kernel.platform === "darwin") {
      const checkingMsg = "> checking xcode command line tools...\r\n"
      console.log(checkingMsg)
      ondata({ raw: checkingMsg })

      const cltStatus = await detectCommandLineTools({
        exec: (params) => this.kernel.bin.exec(params, () => {})
      })

      if (cltStatus.valid) {
        const msg = `> command line tools detected at ${cltStatus.path} (pkg ${cltStatus.pkgVersion}, xcode-select ${cltStatus.xcodeSelectVersion}). skipping...\r\n`
        console.log(msg)
        ondata({ raw: msg })
      } else {
        const msg = `> ${cltStatus.reason || "command line tools not installed yet."} install the latest xcode build tools...\r\n`
        console.log(msg)
        ondata({ raw: msg })
        await this._install(req, ondata)
      }
    }
//
    ondata({ raw: "installing gettext\r\n" })
    await this.kernel.bin.exec({ message: "brew install gettext --force-bottle", conda: { skip: true } }, (stream) => { ondata(stream) })
//
    ondata({ raw: `Install finished\r\n` })
  }
  async _install(req, ondata) {
    // command line tools installed
    const msg = "> installing the latest xcode build tools...\r\n"
    console.log(msg)
    ondata({ raw: msg })
    // not installed or not installed properly
    // install xcode build tools
    await this.kernel.bin.exec({ sudo: true, conda: { skip: true }, message: "rm -rf /Library/Developer/CommandLineTools" }, (stream) => { ondata(stream) })
    let sh_path = path.resolve(this.kernel.homedir, "xcode.sh")
    let src_path = path.resolve(__dirname, "xcode.sh")
    console.log({ sh_path, src_path })
    let sh = await fs.promises.readFile(src_path, "utf8")
    console.log({ sh })
    await fs.promises.writeFile(sh_path, sh)
    await this.kernel.bin.exec({ message: "bash ./xcode.sh", path: this.kernel.homedir, conda: { skip: true }}, (stream) => { ondata(stream) })

    ondata({ raw: "> installing xcode-select. please approve the xcode-select install dialog and install before proceeding...\r\n" })
    await this.kernel.bin.exec({ message: "xcode-select --install", conda: { skip: true } }, (stream) => { ondata(stream) })
  }

  async installed() {
    return this.kernel.bin.brew_installed
    /*
    let e = await this.kernel.bin.exists("homebrew")

    let { stdout }= await this.kernel.bin.exec({ message: "xcode-select -p" }, (stream) => { })
    let e2 = /(.*Library.*Developer.*CommandLineTools.*|.*Xcode.*Developer.*)/gi.test(stdout)
    console.log({ e, e2, stdout })

    return e && e2
    */
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
