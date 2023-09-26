const os = require('os')
const path = require('path')
const fs = require('fs')
const fetch = require('cross-fetch')
const decompress = require('decompress');
const { rimraf } = require('rimraf')
const { glob } = require('glob')
class VS {
  async init(bin) {
    // Get the only folder inside bin/vs/
    const ROOT_PATHS = await glob('*/', { cwd: bin.path("vsbuiltools") })
    if (ROOT_PATHS.length > 0) {
      const ROOT_PATH = ROOT_PATHS[0]
      const MSVC_PATH = bin.path("vsbuiltools", ROOT_PATH, "VC/Tools/MSVC")
      const BUILD_PATH = bin.path("vsbuiltools", ROOT_PATH, "VC/Auxiliary/Build")
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
  env(bin) {
    return this._env
  }
  async install(bin, ondata) {
    // 1. Set registry to allow long paths
    let res = await bin.exec({
      message: "reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f",
      sudo: true
    }, (stream) => {
      ondata(stream)
    })

    // 2. Download installer
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    const installer = "vs_buildtools.exe"
    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await bin.download(installer_url, installer, ondata)

    // 3. Run installer
    if (os.release().startsWith("10")) {
      ondata({ raw: `running installer: ${installer}...\r\n` })
      const id = "ts" + Date.now()
      const cmd = this.cmd("install", bin.path("vsbuiltools", id))
      await bin.exec({ message: cmd, }, (stream) => {
        ondata(stream)
      })
      ondata({ raw: `Install finished\r\n` })
      return bin.rm(installer, ondata)
    } else {
      ondata({ raw: `Must be Windows 10 or above\r\n` })
    }
  }
  async installed(bin) {
    const ROOT_PATHS = await glob('*/', { cwd: bin.path("vsbuiltools") })
    if (ROOT_PATHS.length > 0) {
      const ROOT_PATH = ROOT_PATHS[0]
      const MSVC_PATH = bin.path("vsbuiltools", ROOT_PATH, "VC/Tools/MSVC")
      const BUILD_PATH = bin.path("vsbuiltools", ROOT_PATH, "VC/Auxiliary/Build")
      const e1 = await bin.exists(MSVC_PATH)
      const e2 = await bin.exists(BUILD_PATH)
      return e1 && e2
    }
  }

  async uninstall(bin, ondata) {
    const ROOT_PATHS = await glob('*/', { cwd: bin.path("vsbuiltools") })
    if (ROOT_PATHS.length > 0) {
      const ROOT_PATH = ROOT_PATHS[0]
      const cmd = this.cmd("uninstall", bin.path("vsbuiltools", ROOT_PATH))
      await bin.exec({ message: cmd, }, (stream) => {
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
