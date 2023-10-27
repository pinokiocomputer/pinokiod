const si = require('systeminformation')
const path = require('path')
class Torch {
  gpus() {
    return si.graphics().then((g) => {
      if (g && g.controllers && g.controllers.length > 0) {
        return g.controllers.map((x) => { return x.vendor.toLowerCase() })
      } else {
        return []
      }
    })
  }
  async install(req, ondata) {
    let cmd
    let platform = this.kernel.platform
    let gpus = await this.gpus()
    if (platform === "win32") {
      if (gpus.includes("nvidia")) {
        cmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
      } else if (gpus.includes("amd") || gpus.includes("advanced micro devices")){
        cmd = "pip3 install torch torchvision torchaudio"
      } else {
        cmd = "pip3 install torch torchvision torchaudio"
      }
    } else if (platform === "darwin") {
      cmd = "pip3 install torch torchvision torchaudio"
    } else if (platform === "linux") {
      if (gpus.includes("nvidia")) {
        cmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
      } else if (gpus.includes("amd") || gpus.includes("advanced micro devices")){
        cmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.4.2"
      } else {
        cmd = "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
      }
    }
    await this.kernel.bin.exec({ message: cmd }, ondata)
  }
  async installed() {
    let e = await this.kernel.bin.mod.conda.exists("torch*")
    return e
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({
      message: "pip3 uninstall torch torchvision torchaudio"
    }, ondata)
  }
}
module.exports = Torch
