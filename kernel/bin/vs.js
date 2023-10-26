const os = require('os')
const path = require('path')
const fs = require('fs')
const { glob } = require('glob')
class VS {
  description = "Look for a dialog requesting admin permission and approve it to proceed. This will install Microsoft visual studio build tools, which is required for building several python wheels."
  async install(req, ondata) {

    // 2. Download installer
    const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    const installer = "vs_buildtools.exe"
    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await this.kernel.bin.download(installer_url, installer, ondata)

    // 3. Run installer
    if (os.release().startsWith("10")) {
      ondata({ raw: `running installer: ${installer}...\r\n` })
      const cmd = this.cmd("install")
      await this.kernel.bin.exec({ sudo: true, message: cmd, }, (stream) => {
        ondata(stream)
      })
      ondata({ raw: `Install finished\r\n` })
      return this.kernel.bin.rm(installer, ondata)
    } else {
      ondata({ raw: `Must be Windows 10 or above\r\n` })
    }
  }
  async init() {
    if (this.kernel.platform === "win32") {
      const ROOT_PATH = process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"]
      const MSVC_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Tools/MSVC")
      const BUILD_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Auxiliary/Build")
      const CMAKE_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin")
      const env = {
        PATH: ["C:\\Windows\\System32", MSVC_PATH, BUILD_PATH, CMAKE_PATH]
      }
      const clpaths = await glob('**/bin/Hostx64/x64/cl.exe', { cwd: MSVC_PATH })
      if (clpaths && clpaths.length > 0) {
        let win_cl_path = path.resolve(MSVC_PATH, path.dirname(clpaths[0]))
        env.PATH.push(win_cl_path)
      }
      this._env = env
    }
  }
  env () {
    if (this.kernel.platform === "win32") {
      return this._env
    }
  }
  async installed() {
    if (this.kernel.platform === "win32") {
      let ROOT_PATH = process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"]
      const MSVC_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Tools/MSVC")
      const BUILD_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Auxiliary/Build")
      const e1 = await this.kernel.bin.exists(MSVC_PATH)
      const e2 = await this.kernel.bin.exists(BUILD_PATH)
      return e1 && e2
    }
  }

  async uninstall(req, ondata) {
    const cmd = this.cmd("uninstall")
    await this.kernel.bin.exec({ sudo: true, message: cmd, }, (stream) => {
      ondata(stream)
    })
  }
  cmd(mode) {
    const url = "https://aka.ms/vs/17/release/vs_buildtools.exe"
    //const url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
    const filename = this.kernel.bin.path("vs_buildtools.exe")
    let items = ["Microsoft.VisualStudio.Workload.VCTools"]
    let add = items.map((item) => { return `--add ${item}` }).join(" ")
    let cmd = `start /wait ${filename} ${mode === 'uninstall' ? mode: ''} --passive --wait --includeRecommended --nocache ${add}`
    return cmd
  }
}
module.exports = VS
