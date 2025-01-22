const fse = require('fs-extra')
const path = require('path')
class Py {
  async install(req, ondata) {
    await fse.remove(this.kernel.path('bin/py'))
    await this.kernel.exec({
      message: "git clone https://github.com/pinokiocomputer/python py",
      path: this.kernel.path("bin")
    }, ondata)
    await this.kernel.exec({
      message: "pip install -r requirements.txt",
      venv: "env",
      path: this.kernel.bin.path("py")
    }, ondata)
  }
  async installed() {
    let exists = await this.kernel.exists(this.kernel.bin.path("py"))
    let exists2 = await this.kernel.exists(this.kernel.bin.path("py/env"))
    let site_packages_root
    if (this.kernel.platform === "win32") {
      site_packages_root = this.kernel.bin.path("py/env/Lib/site-packages")
    } else {
      site_packages_root = this.kernel.bin.path("py/env/lib/python3.10/site-packages")
    }
    let module_paths = ["fastapi", "uvicorn", "importlib_metadata"].map((name) => {
      return path.resolve(site_packages_root, name)
    })
    let exists3 = await this.kernel.exists(site_packages_root)
    let exists4 = true
    for(let module_path of module_paths) {
      let exists = await this.kernel.exists(module_path)
      if (!exists) {
        exists4 = false
        break;
      }
    }
    console.log({ exists, exists2, exists3, exists4 })
    return exists && exists2 && exists3 && exists4
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.rm(this.kernel.bin.path("py"), ondata)
  }
}
module.exports = Py
