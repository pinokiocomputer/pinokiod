const path = require('path')
const fs = require('fs')
class Script {
  constructor(kernel) {
    this.kernel = kernel
  }
  // script.resolve('https://github.com/cocktailpeanutlabs/comfyui.git', 'start.json')
  // script.resolve('~/api/comfyui.git', 'start.json')
  // script.resolve(cwd, 'start.json')
  resolve(...chunks) {
    let [base, ...relative] = chunks
    let p = this.kernel.api.filePath(base)
    if (p) {
      return path.resolve(p, ...relative)
    } else {
      return false
    }
  }
  exists(...chunks) {
    let abspath = this.resolve(...chunks)
    if (abspath) {
      return fs.existsSync(abspath)
    } else {
      return false
    }
  }
  // script.running('https://github.com/cocktailpeanutlabs/comfyui.git/start.json')
  // script.running('~/api/comfyui.git/start.json')
  // script.running(cwd, 'start.json')
  running(...chunks) {
    let id = this.resolve(...chunks)
    if (id) {
      if (this.kernel.api.running[id]) {
        return true
      } else {
        return false
      }
    } else {
      return false
    }
  }
  // script.local('https://github.com/cocktailpeanutlabs/comfyui.git/start.json')
  // script.local('~/api/comfyui.git/start.json')
  // script.local(cwd, 'start.json')
  local(...chunks) {
    let id = this.resolve(...chunks)
    if (id) {
      let v = this.kernel.memory.local[id]
      if (v) {
        return  v
      } else {
        return {}
      }
    } else {
      return null
    }
  }
  // script.global('https://github.com/cocktailpeanutlabs/comfyui.git/start.json')
  // script.global('~/api/comfyui.git/start.json')
  // script.global(cwd, 'start.json')
  global(...chunks) {
    let id = this.resolve(...chunks)
    if (id) {
      let v = this.kernel.memory.global[id]
      if (v) {
        return  v
      } else {
        return {}
      }
    } else {
      return null
    }
  }
}
module.exports = Script
