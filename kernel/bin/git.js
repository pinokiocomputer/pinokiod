const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const path = require("path")
class Git {
  cmd() {
    if (this.kernel.platform === "darwin") {
      return "git git-lfs"
    } else if (this.kernel.platform === "win32") {
      return "git git-lfs gh git-bash"
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

    await fs.promises.mkdir(this.kernel.path("scripts/git"), { recursive: true }).catch((e) => { })
    let gitpush_path = path.resolve(this.kernel.homedir, "scripts/git/push.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/push"),
      gitpush_path
    )

    let gitcreate_path = path.resolve(this.kernel.homedir, "scripts/git/create.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/create"),
      gitcreate_path
    )

    let gitcommit_path = path.resolve(this.kernel.homedir, "scripts/git/commit.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/commit"),
      gitcommit_path
    )

    let gitcheckout_path = path.resolve(this.kernel.homedir, "scripts/git/checkout.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/checkout"),
      gitcheckout_path
    )

    let gitreset_commit_path = path.resolve(this.kernel.homedir, "scripts/git/reset_commit.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/reset_commit"),
      gitreset_commit_path
    )

    let gitreset_file_path = path.resolve(this.kernel.homedir, "scripts/git/reset_file.json")
    await fs.promises.copyFile(
      path.resolve(__dirname, "..", "scripts/git/reset_file"),
      gitreset_file_path
    )
  }
  async installed() {
    let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
    let exists = await this.kernel.api.exists(gitconfig_path)
    if (!exists) {
      return false; 
    }
    let gitpush_path = path.resolve(this.kernel.homedir, "scripts/git/push.json")
    let exists2 = await this.kernel.api.exists(gitpush_path)
    if (!exists2) {
      return false; 
    }
    let gitcreate_path = path.resolve(this.kernel.homedir, "scripts/git/create.json")
    let exists3 = await this.kernel.api.exists(gitcreate_path)
    if (!exists3) {
      return false; 
    }
    let gitcommit_path = path.resolve(this.kernel.homedir, "scripts/git/commit.json")
    let exists4 = await this.kernel.api.exists(gitcommit_path)
    if (!exists4) {
      return false; 
    }

    if (this.kernel.platform === "darwin") {
      let gh_config_exists = await this.kernel.exists("config/gh")
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.brew.has("gh") && gh_config_exists
    } else if (this.kernel.platform === "win32") {
      let gh_config_exists = await this.kernel.exists("config/gh")
      return this.kernel.bin.installed.conda && this.kernel.bin.installed.conda.has("git") && this.kernel.bin.installed.conda.has("gh") && gh_config_exists && this.kernel.bin.installed.conda.has("git-bash")
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
