class Cuda {
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cudnn libzlib-wapi -c conda-forge",
        ]
//        conda: {
//          name: "base",
//          activate: "minimal"
//        }
      }, ondata)
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cuda -c nvidia/label/cuda-12.1.0",
        ]
//        conda: {
//          name: "base",
//          activate: "minimal"
//        }
      }, ondata)
    } else {
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cudnn -c conda-forge",
        ]
//        conda: {
//          name: "base",
//          activate: "minimal"
//        }
      }, ondata)
      await this.kernel.bin.exec({
        message: [
          "conda clean -y --all",
          "conda install -y cuda -c nvidia/label/cuda-12.1.0",
        ]
//        conda: {
//          name: "base",
//          activate: "minimal"
//        }
      }, ondata)
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      return this.kernel.bin.installed.conda.has("cudnn") &&
        this.kernel.bin.installed.conda.has("cuda") &&
        this.kernel.bin.installed.conda.has("libzlib-wapi")
    } else {
      return this.kernel.bin.installed.conda.has("cudnn") &&
        this.kernel.bin.installed.conda.has("cuda")
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
