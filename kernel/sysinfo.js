const system = require('systeminformation')
const fs = require('fs')
const path = require('path')
const nvidia = require("./gpu/nvidia")
const amd = require("./gpu/amd")
class Sysinfo {
  async init(kernel) {
    this.kernel = kernel
    this.info = {}
    await Promise.all([this.static(), this.refresh()])
//    await this.static()
//    await this.refresh()
  }
  async static() {
    //await Promise.all([this.gpus(), this.system(), this.cpu(), this.os(), this.audio(), this.env(), this.memory()])
    await Promise.all([this.gpus(), this.system(), this.cpu(), this.os(), this.audio(), this.memory()])
//    await this.gpus()
//    await this.system()
//    await this.cpu()
//    await this.os()
//    await this.audio()
//    await this.env()


//    await this.disk()
  }
  async refresh() {
//    await this.time()


    //await Promise.all([this.memory(), this.battery(), this.proc(), this.bluetooth()])
//    await Promise.all([this.memory(), this.proc()])
//    await this.memory()
//    await this.battery()
//    await this.proc()
//    await this.bluetooth()



//    await this.net()
  }
  async gpus() {
    let g = await system.graphics()
    let controllers = Array.isArray(g && g.controllers) ? g.controllers : []
    let gpus
    if (controllers.length > 0) {
      gpus = controllers.map((x) => {
        return {
          name: (x.vendor || "").toLowerCase(),
          model: (x.model || "").toLowerCase(),
          driver: x.driverVersion ? String(x.driverVersion) : null
        }
      })
    } else {
      gpus = []
    }

    let bestByVram = (items) => {
      return items.reduce((best, item) => {
        let bestVram = Number(best && best.vram) || 0
        let itemVram = Number(item && item.vram) || 0
        return itemVram > bestVram ? item : best
      }, items[0])
    }
    let model = (controller) => {
      return (controller && controller.model ? controller.model : "").toLowerCase()
    }
    let driver = (controller) => {
      return controller && controller.driverVersion ? String(controller.driverVersion) : null
    }

    let is_nvidia = controllers.find(x => /nvidia/i.test(x.vendor || ""))
    let is_amd = bestByVram(controllers.filter(x => /(amd|advanced micro devices)/i.test(x.vendor || "")))
    let is_apple = controllers.find(x => /apple/i.test(x.vendor || ""))

    let gpu
    let gpu_model
    if (is_nvidia) {
      gpu = "nvidia"
      gpu_model = model(is_nvidia)
    } else if (is_amd) {
      gpu = "amd"
      gpu_model = model(is_amd)
    } else if (is_apple) {
      gpu = "apple"
      gpu_model = model(is_apple)
    } else if (gpus.length > 0) {
      gpu = gpus[0].name
      gpu_model = gpus[0].model
    } else {
      gpu = "none"
    }

    let primaryController
    if (is_nvidia) {
      primaryController = is_nvidia
    } else if (is_amd) {
      primaryController = is_amd
    } else if (is_apple) {
      primaryController = is_apple
    } else if (controllers.length > 0) {
      primaryController = controllers[0]
    }

    let vramMB = primaryController && primaryController.vram ? primaryController.vram : 0
    let vramGB = vramMB > 0 ? Math.round(vramMB / 1024) : 0
    let gpu_driver = driver(primaryController)
    let cpu_brand_value
    let cpu_brand = async () => {
      if (cpu_brand_value === undefined) {
        cpu_brand_value = await this.cpu_brand()
      }
      return cpu_brand_value
    }
    let detected = { is_nvidia, is_amd, gpu_model, primaryController, cpu_brand }
    let gpu_target = await this.gpu_target(detected)

    this.info.graphics = g
    this.info.gpus = gpus
    this.info.gpu = gpu
    this.info.gpu_model = gpu_model
    this.info.gpu_driver = gpu_driver
    this.info.gpu_target = gpu_target
    this.info.vram = vramGB
  }
  // Read CPU brand only when generic iGPU names need CPU fallback matching.
  async cpu_brand() {
    let cpu = this.info.cpu
    if (!cpu) {
      try {
        cpu = await system.cpu()
      } catch (e) {
        cpu = null
      }
    }
    return cpu && cpu.brand
  }
  async gpu_target(detected) {
    if (detected.is_nvidia) {
      return await nvidia.resolve_cuda_sm_target(detected.primaryController)
    } else if (detected.is_amd) {
      return await amd.resolve_gpu_target(detected.gpu_model, detected.cpu_brand || (() => this.cpu_brand()))
    } else {
      return null
    }
  }
//  async time() {
//    this.info.time = await system.time()
//  }
  async system() {
    this.info.system = await system.system()
  }
  async cpu() {
    this.info.cpu = await system.cpu()
  }
  async memory() {
    this.info.mem = await system.mem()
    let totalBytes = this.info.mem && this.info.mem.total ? this.info.mem.total : 0
    let totalGB = totalBytes > 0 ? Math.round(totalBytes / (1024 * 1024 * 1024)) : 0
    this.info.ram = totalGB
  }
//  async battery() {
//    this.info.battery = await system.battery()
//  }
  async os() {
    this.info.osInfo = await system.osInfo()
    this.info.shell = await system.shell()
  }
  async proc() {
    this.info.load = await system.currentLoad()
  }
  async disk() {
    this.info.diskLayout = await system.diskLayout()
    this.info.blockDevices = await system.blockDevices()
    this.info.fsSize = await system.fsSize()
    this.info.usb = await system.usb()
  }
  async audio() {
    this.info.audio = await system.audio()
  }
  async net() {
    this.info.networkConnections = await system.networkConnections()
    this.info.gateway = await system.networkGatewayDefault()
    this.info.interface = await system.networkInterfaces("default")
  }
//  async bluetooth() {
//    this.info.bluetooth = await system.bluetoothDevices()
//  }
  exists(_path) {
    return new Promise(r=>fs.access(_path, fs.constants.F_OK, e => r(!e)))
  }
  async env () {
    let cmd
    if (this.kernel.platform === "win32") {
      cmd = "set"
    } else {
      cmd = "env"
    }

//    console.log("############### DEBUGGING ENV")
//    let _res = await this.kernel.bin.exec({ message: cmd, conda: { skip: true } }, (stream) => {
//    })
//    console.log(_res)
//    console.log("############### DEBUGGING ENV FINISH")

    let conda_path = path.resolve(this.kernel.homedir, "bin", "miniforge")
    let conda_exists = await this.exists(conda_path)

    let res
    if (conda_exists) {
      res = await this.kernel.bin.exec({ message: cmd }, (stream) => {
      })
    } else {
      console.log("skip conda")
      res = await this.kernel.bin.exec({ message: cmd, conda: { skip: true } }, (stream) => {
      })
    }

    let lines = res.response.split(/[\r\n]+/)
    let vars = []
    let started
    for(let line of lines) {
      if (started) {
        // end BEFORE the next occurrence of <<PINOKIO SHELL>>
        if (/<<PINOKIO SHELL>>/.test(line)) {
          // do nothing => ignore this line
        } else {
          vars.push(line)
        }
      } else {
        // start AFTER the first occurrence of <<PINOKIO SHELL>>
        if (/<<PINOKIO SHELL>>/.test(line)) {
          started = true
        }
      }
    }


//    this.info.env = process.env
    this.info.shell_env = lines
  }
}
module.exports = Sysinfo
