const fs = require('fs')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const decompress = require('decompress');
const NODE_VERSION = "24.18.0"
const PNPM_VERSION = "11.9.0"

const normalizeVersion = (version) => {
  const match = String(version || "").match(/^\d+\.\d+\.\d+/)
  return match ? match[0] : null
}

class Node {
  description = "Installs Node.js and pnpm in the Pinokio environment."
  cmd() {
    return `nodejs=${NODE_VERSION} pnpm=${PNPM_VERSION}`
  }
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }
  async installed() {
    if (!this.kernel.bin.installed.conda.has("nodejs") || !this.kernel.bin.installed.conda.has("pnpm")) {
      return false
    }

    const versions = this.kernel.bin.installed.conda_versions || {}
    return normalizeVersion(versions.nodejs) === NODE_VERSION && normalizeVersion(versions.pnpm) === PNPM_VERSION
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
