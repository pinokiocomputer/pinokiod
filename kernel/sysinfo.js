const system = require('systeminformation')
const fs = require('fs')
const path = require('path')
class Sysinfo {
  async init(kernel) {
    this.kernel = kernel
    this.info = {}
    await this.static()
    await this.refresh()
  }
  async static() {
    await this.gpus()
    await this.system()
    await this.cpu()
    await this.os()
    await this.audio()
    await this.env()
//    await this.disk()
  }
  async refresh() {
//    await this.time()
    await this.memory()
    await this.battery()
    await this.proc()
    await this.bluetooth()
//    await this.net()
  }
  async gpus() {
    let g = await system.graphics()
    let gpus
    if (g && g.controllers && g.controllers.length > 0) {
      gpus = g.controllers.map((x) => { return x.vendor.toLowerCase() })
    } else {
      gpus = []
    }

    let is_nvidia = gpus.find(gpu => /nvidia/i.test(gpu))
    let is_amd = gpus.find(gpu => /(amd|advanced micro devices)/i.test(gpu))
    let is_apple = gpus.find(gpu => /apple/i.test(gpu))

    let gpu
    if (is_nvidia) {
      gpu = "nvidia"
    } else if (is_amd) {
      gpu = "amd"
    } else if (is_apple) {
      gpu = "apple"
    } else if (gpus.length > 0) {
      gpu = gpus[0]
    } else {
      gpu = "none"
    }

    this.info.graphics = g
    this.info.gpus = gpus
    this.info.gpu = gpu

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
  }
  async battery() {
    this.info.battery = await system.battery()
  }
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
  async bluetooth() {
    this.info.bluetooth = await system.bluetoothDevices()
  }
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

    let conda_path = path.resolve(this.kernel.homedir, "bin", "miniconda")
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
