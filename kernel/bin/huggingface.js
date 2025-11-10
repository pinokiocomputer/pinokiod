const semver = require('semver')
class Huggingface {
  cmd() {
    //return 'huggingface_hub "hf-xet!=1.1.10"'
    return 'huggingface_hub=1.0.1'
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
    if (this.kernel.bin.installed.conda.has("huggingface_hub")) {
      let version = this.kernel.bin.installed.conda_versions.huggingface_hub
      if (version) {
        let coerced = semver.coerce(version)
        if (semver.satisfies(coerced, ">=1.0.1")) {
          return true
        }
      }
    }
    return false
  }
//  env() {
//    return {
//      GIT_CONFIG_GLOBAL: gitconfig_path
//export CUDA_HOME=/usr/local/cuda
//export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/cuda/lib64:/usr/local/cuda/extras/CUPTI/lib64
//export PATH=$PATH:$CUDA_HOME/bin
//
//    }
//  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "conda remove huggingface_hub",
    }, ondata)
  }
}
module.exports = Huggingface
