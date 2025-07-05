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
    console.log("GIT install")
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
    if (this.kernel.platform === "darwin") {
      console.log("brew install gh")
      await this.kernel.bin.exec({
//        conda: { skip: true },
        message: [
          "echo $PATH",
          "which brew",
          "brew install gh",
        ],
      }, (e) => {
        process.stdout.write(e.raw)
        ondata(e)
      })
    }
    await fs.promises.mkdir(this.kernel.path("config/gh"), { recursive: true }).catch((e) => { })

    let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
    // check if gitconfig exists
    let exists = await this.kernel.api.exists(gitconfig_path)
    // if not, create one
    if (!exists) {
      await fs.promises.copyFile(
        path.resolve(__dirname, "..", "gitconfig_template"),
        gitconfig_path
      )
    }
  }
  async installed() {
    let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
    let exists = await this.kernel.api.exists(gitconfig_path)
    if (!exists) {
      return false; 
    }

    if (this.kernel.platform === "darwin") {
      let gh_config_exists = await this.kernel.exists("config/gh")
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.brew.has("gh") && gh_config_exists
    } else {
      let gh_config_exists = await this.kernel.exists("config/gh")
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
