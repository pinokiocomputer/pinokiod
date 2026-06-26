const RELEASE_VERSION = "8.1.2"
const CONDA_SPEC = `ffmpeg=${RELEASE_VERSION}`
const CONDA_CHANNEL_FLAGS = "-c conda-forge"

class Ffmpeg {
  description = "Installs FFmpeg for audio and video processing."

  cmd() {
    return CONDA_SPEC
  }

  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y ${CONDA_CHANNEL_FLAGS} ${this.cmd()}`
      ]
    }, ondata)
  }

  async installed() {
    return this.kernel.bin.installed.conda.has("ffmpeg") &&
      this.kernel.bin.installed.conda_versions.ffmpeg === RELEASE_VERSION
  }

  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove -y ffmpeg",
    }, ondata)
  }
}

module.exports = Ffmpeg
