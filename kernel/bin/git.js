const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const semver = require('semver')
const { rimraf } = require('rimraf')
const path = require("path")
class Git {
  cmd() {
    if (this.kernel.platform === "darwin") {
      return "git=2.51.0 git-lfs gh=2.82.1"
    } else if (this.kernel.platform === "win32") {
      //return "git git-lfs gh=2.82.1 git-bash"
      return "git=2.51.0 git-lfs gh=2.82.1 m2-base"
    } else {
      return "git=2.51.0 git-lfs gh=2.82.1"
    }
  }
  async install(req, ondata) {
    console.log("GIT install")
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.exec({ message: "conda remove git-bash" }, ondata)
    }
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.bin.installed.conda && this.kernel.bin.installed.conda_versions) {
      let version = this.kernel.bin.installed.conda_versions.git
      console.log("git version", version)
      let coerced = semver.coerce(version)
      console.log("git coerced", coerced)
      let requirement = ">=2.51.0"
      let satisfied = semver.satisfies(coerced, requirement)
      console.log("git version satisfied?", satisfied)
      if (!satisfied) {
        return false 
      }
    }
    if (this.kernel.platform === "darwin") {
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh")
    } else if (this.kernel.platform === "win32") {
      //return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh") && this.kernel.bin.installed.conda.has("git-bash")
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh") && this.kernel.bin.installed.conda.has("m2-base")
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
