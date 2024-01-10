class Cuda {
  async install(req, ondata) {
    if (this.kernel.platform === "win32") {
      await this.kernel.bin.exec({
        message: "conda install -y cudnn libzlib-wapi -c conda-forge",
        conda: "base",
      }, ondata)
      await this.kernel.bin.exec({
        message: "conda install -y cuda -c nvidia/label/cuda-11.8.0",
        conda: "base",
      }, ondata)
    } else {
      await this.kernel.bin.exec({
        message: "conda install -y cudnn -c conda-forge",
        conda: "base",
      }, ondata)
      await this.kernel.bin.exec({
        message: "conda install -y cuda -c nvidia/label/cuda-11.8.0",
        conda: "base",
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
      conda: "base",
    }, ondata)
  }
}
module.exports = Cuda
