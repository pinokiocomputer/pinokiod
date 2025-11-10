const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const path = require("path")
class Git {
  cmd() {
    if (this.kernel.platform === "darwin") {
      return "git git-lfs gh=2.82.1"
    } else if (this.kernel.platform === "win32") {
      return "git git-lfs gh=2.82.1 git-bash"
    } else {
      return "git git-lfs gh=2.82.1"
    }
  }
  async install(req, ondata) {
    console.log("GIT install")
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.platform === "darwin") {
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh")
    } else if (this.kernel.platform === "win32") {
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh") && this.kernel.bin.installed.conda.has("git-bash")
    } else {
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh")
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({ message: "conda remove git gh" }, ondata)
  }
  env() {
    let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
    return {
      GIT_CONFIG_GLOBAL: gitconfig_path,
      GH_CONFIG_DIR: this.kernel.path("config/gh")
    }
  }
  async requires() {
    return ["conda"]
  }
}
module.exports = Git
