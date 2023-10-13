const os = require('os')
const path = require('path')
const fs = require('fs')
const { glob } = require('glob')
class VS {
  async init() {
    if (this.kernel.platform === "win32") {
      console.log("INIT vs")
      // Get the only folder inside bin/vs/
      const ROOT_PATHS = await glob('*/', { cwd: this.kernel.bin.path("vsbuiltools") })
      if (ROOT_PATHS.length > 0) {
        const ROOT_PATH = ROOT_PATHS[0]
        const MSVC_PATH = this.kernel.bin.path("vsbuiltools", ROOT_PATH, "VC/Tools/MSVC")
        const BUILD_PATH = this.kernel.bin.path("vsbuiltools", ROOT_PATH, "VC/Auxiliary/Build")
        const env = {
          PATH: ["C:\\Windows\\System32", MSVC_PATH, BUILD_PATH]
        }
        const clpaths = await glob('**/bin/Hostx64/x64/cl.exe', { cwd: MSVC_PATH })
        if (clpaths && clpaths.length > 0) {
          let win_cl_path = path.resolve(MSVC_PATH, path.dirname(clpaths[0]))
          env.PATH.push(win_cl_path)
        }
        this._env = env
      }
    }
  }
  env() {
    if (this.kernel.platform === "win32") {
      return this._env
    }
  }
  async install(req, ondata) {
//    // 1. Set registry to allow long paths
//    let res = await this.kernel.bin.exec({
//      message: "reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f",
//      sudo: true
//    }, (stream) => {
//      ondata(stream)
//    })

    // 2. Download installer
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    const installer = "vs_buildtools.exe"
    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await this.kernel.bin.download(installer_url, installer, ondata)

    // 3. Run installer
    if (os.release().startsWith("10")) {
      ondata({ raw: `running installer: ${installer}...\r\n` })
      const id = "ts" + Date.now()
      const cmd = this.cmd("install", this.kernel.bin.path("vsbuiltools", id))
      await this.kernel.bin.exec({ message: cmd, }, (stream) => {
        ondata(stream)
      })
      ondata({ raw: `Install finished\r\n` })
      return this.kernel.bin.rm(installer, ondata)
    } else {
      ondata({ raw: `Must be Windows 10 or above\r\n` })
    }
  }
  async installed() {
    if (this.kernel.platform === "win32") {
      const ROOT_PATHS = await glob('*/', { cwd: this.kernel.bin.path("vsbuiltools") })
      if (ROOT_PATHS.length > 0) {
        const ROOT_PATH = ROOT_PATHS[0]
        const MSVC_PATH = this.kernel.bin.path("vsbuiltools", ROOT_PATH, "VC/Tools/MSVC")
        const BUILD_PATH = this.kernel.bin.path("vsbuiltools", ROOT_PATH, "VC/Auxiliary/Build")
        const e1 = await this.kernel.bin.exists(MSVC_PATH)
        const e2 = await this.kernel.bin.exists(BUILD_PATH)
        return e1 && e2
      }
    }
  }

  async uninstall(req, ondata) {
    const ROOT_PATHS = await glob('*/', { cwd: this.kernel.bin.path("vsbuiltools") })
    if (ROOT_PATHS.length > 0) {
      const ROOT_PATH = ROOT_PATHS[0]
      const cmd = this.cmd("uninstall", this.kernel.bin.path("vsbuiltools", ROOT_PATH))
      await this.kernel.bin.exec({ message: cmd, }, (stream) => {
        ondata(stream)
      })
    }
  }
  cmd(mode, installPath) {
    const url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    const filename = "vs_buildtools.exe"
    let items = ["Microsoft.VisualStudio.Workload.VCTools"]
    let add = items.map((item) => {
      return `--add ${item}`
    }).join(" ")
    let cmd = `start /wait ${filename} ${mode === 'uninstall' ? mode: ''} --installPath ${installPath} --passive --wait --includeRecommended --nocache ${add}`
    //let cmd = `start /wait ${filename} ${mode === 'uninstall' ? mode: ''} --installPath ${installPath} --wait --includeRecommended --nocache ${add}`
    return cmd
  }
}
module.exports = VS
