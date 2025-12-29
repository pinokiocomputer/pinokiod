const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
class Node {
  cmd() {
    return "nodejs=22.21.1 pnpm"
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        //"conda install -y nodejs=20.17.0 pnpm -c conda-forge"
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (this.kernel.bin.installed.conda && this.kernel.bin.installed.conda_versions) {
      let version = this.kernel.bin.installed.conda_versions.nodejs
      if (version !== "22.21.1") {
        return false
      }
    }
    return this.kernel.bin.installed.conda.has("nodejs") && this.kernel.bin.installed.conda.has("pnpm")
  }
  env() {
    return {
      PATH: [this.kernel.path("bin/npm"), this.kernel.path("bin/npm/bin")],
      NPM_CONFIG_PREFIX: this.kernel.path("bin/npm"),
      npm_config_cache: this.kernel.path("cache/npm_config_cache"),
      NPM_CONFIG_PREFIX: this.kernel.path("bin/npm"),
      npm_config_prefix: this.kernel.path("bin/npm"),
      PNPM_HOME: this.kernel.path("bin/npm"),
      pnpm_home: this.kernel.path("bin/npm"),
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove nodejs pnpm",
    }, ondata)
  }
}
module.exports = Node
