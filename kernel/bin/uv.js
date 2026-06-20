const UV_VERSION = "0.11.23"

const normalizeVersion = (version) => {
  const match = String(version || "").match(/^\d+\.\d+\.\d+/)
  return match ? match[0] : null
}

class UV {
  description = "Installs uv, a fast Python package and virtual environment manager."
  cmd() {
    return `uv=${UV_VERSION}`
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
    if (!this.kernel.bin.installed.conda.has("uv")) {
      return false
    }
    let version = this.kernel.bin.installed.conda_versions && this.kernel.bin.installed.conda_versions.uv
    return normalizeVersion(version) === UV_VERSION
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove uv",
    }, ondata)
  }
}
module.exports = UV
