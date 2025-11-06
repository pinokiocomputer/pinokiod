const semver = require('semver')
const fs = require('fs')
const path = require('path')
class Cuda {
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cudnn libzlib-wapi -c conda-forge",
        ]
      }, ondata)
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y nvidia/label/cuda-12.8.1::cuda"
        ]
      }, ondata)
      const folder = this.kernel.bin.path("miniconda/etc/conda/activate.d")
      const old_name = path.resolve(folder, "~cuda-nvcc_activate.bat")
      const new_name = path.resolve(folder, "~cuda-nvcc_activate.bat.disabled")
      console.log("rename", { old_name, new_name })
      await fs.promises.rename(old_name, new_name)
    } else {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cudnn -c conda-forge",
        ]
      }, ondata)
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y nvidia/label/cuda-12.8.1::cuda"
        ]
      }, ondata)
      if (this.kernel.platform === "linux") {
        await this.kernel.bin.exec({
          message: [
            "conda install -y -c conda-forge nccl"
          ]
        }, ondata)
      }
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      if (this.kernel.bin.installed.conda.has("cudnn") && this.kernel.bin.installed.conda.has("cuda") && this.kernel.bin.installed.conda.has("libzlib-wapi")) {
        let version = this.kernel.bin.installed.conda_versions.cuda
        if (version) {
          let coerced = semver.coerce(version)
          console.log("cuda version", coerced)
          if (semver.satisfies(coerced, ">=12.8.1")) {
            console.log("cuda satisfied")
            let exists = await this.kernel.exists("bin/miniconda/etc/conda/activate.d/~cuda-nvcc_activate.bat")
            console.log("nvcc_activate exists?", exists)
            if (!exists) {
              return true
            }
          }
        }
      }
    } else {
      if (this.kernel.bin.installed.conda.has("cudnn") && this.kernel.bin.installed.conda.has("cuda")) {
        let version = this.kernel.bin.installed.conda_versions.cuda
        if (version) {
          let coerced = semver.coerce(version)
          console.log("cuda version", coerced)
          if (semver.satisfies(coerced, ">=12.8.1")) {
            console.log("satisfied")
            return true
          }
        }
      }
    }
    return false
  }
  env() {
    return {
      CUDA_HOME: this.kernel.bin.path("miniconda")
    }
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
      message: "conda remove cudnn cuda",
    }, ondata)
  }
}
module.exports = Cuda
