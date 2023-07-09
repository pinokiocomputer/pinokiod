class Brew {
  constructor(bin) {
    this.bin = bin
    //if (bin.platform === "darwin" || bin.platform === "linux") {
    if (bin.platform === "darwin") {
      this.cmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
      this.uninstall = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"`
      this.check = {
        run: "brew -v",
        pattern: "/.*Homebrew [0-9]\.[0-9]+\.[0-9]+.*/g"
      }
    }
  }
  async rm(options, ondata) {
    await this.bin.sh({
      message: this.uninstall
    }, (stream) => {
      ondata(stream)
    })
  }
  async install(options, ondata) {
    await this.bin.sh({
      message: this.cmd
    }, (stream) => {
      ondata(stream)
    })
  }
}
module.exports = Brew
