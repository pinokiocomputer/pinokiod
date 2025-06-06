const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const path = require("path")
class Git {
  cmd() {
    if (this.kernel.platform === "darwin") {
      return "git git-lfs"
    } else {
      return "git git-lfs gh"
    }
  }
  async install(req, ondata) {
    if (this.kernel.platform === "darwin") {
      await this.kernel.bin.exec({
        conda: { skip: true },
        message: "brew install gh",
      }, ondata)
    } else {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          `conda install -y -c conda-forge ${this.cmd()}`
        ]
      }, ondata)
    }
    await fs.promises.mkdir(this.kernel.path("config/gh"), { recursive: true }).catch((e) => { })
//    if (this.kernel.platform === 'win32') {
//      let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
//      // check if gitconfig exists
//      let exists = await this.kernel.api.exists(gitconfig_path)
//      // if not, create one
//      if (!exists) {
//        await fs.promises.copyFile(
//          path.resolve(__dirname, "..", "gitconfig_template"),
//          gitconfig_path
//        )
//      }
//    }
  }
  async installed() {
    if (this.kernel.platform === "darwin") {
      let gh_config_exists = await this.kernel.exists("config/gh")
      console.log("conda installed", this.kernel.bin.installed.conda)
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.brew.has("gh") && gh_config_exists
    } else {
      let gh_config_exists = await this.kernel.exists("config/gh")
      console.log("conda installed", this.kernel.bin.installed.conda)
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh") && gh_config_exists
    }
  }
  async uninstall(req, ondata) {
    if (this.kernel.platform === "darwin") {
      await this.kernel.bin.exec({ message: "conda remove git" }, ondata)
      await this.kernel.bin.exec({
        conda: { skip: true },
        message: "brew uninstall gh",
      })
    } else {
      await this.kernel.bin.exec({ message: "conda remove git gh" }, ondata)
    }
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
