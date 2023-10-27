const os = require('os')
const si = require('systeminformation')
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
  resolve(platform, gpus) {
    if (platform === "win32") {
      if (gpus.includes("nvidia")) {
        return "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
      } else if (gpus.includes("amd") || gpus.includes("advanced micro devices")){
        return "pip3 install torch torchvision torchaudio"
      } else {
        return "pip3 install torch torchvision torchaudio"
      }
    } else if (platform === "darwin") {
      return "pip3 install torch torchvision torchaudio"
    } else if (platform === "linux") {
      if (gpus.includes("nvidia")) {
        return "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
      } else if (gpus.includes("amd") || gpus.includes("advanced micro devices")){
        return "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.6"
      } else {
        return "pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
      }
    } else {
      throw new Error("undectedted platform: " + platform)
    }
  }
  async init() {
    let gpus = await this.gpus()
    return this.resolve(os.platform(), gpus)
  }
}
module.exports = Torch
