class Huggingface {
  async install(req, ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        "conda install -y -c conda-forge huggingface_hub"
      ]
//      conda: {
//        name: "base",
//        activate: "minimal"
//      }
    }, ondata)
  }
  async installed() {
    return this.kernel.bin.installed.conda.has("huggingface_hub")
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
