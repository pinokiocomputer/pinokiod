const os = require('os')
const path = require('path')
const fs = require('fs')
const { glob } = require('glob')
class VS {
  description = "Look for a dialog requesting admin permission and approve it to proceed. This will install Microsoft visual studio build tools, which is required for building several python wheels."
  async install(req, ondata) {
    // 3. Run installer
    if (os.release().startsWith("10")) {

      ondata({ raw: `[0] Visual Studio Build Tools Installation Attempt ${req._attempt}\r\n` })
      let attempt = req._attempt;
      console.log("VS Installation attempt " + attempt)

      // 1. wait 3 seconds
      // 2. check installed
      // 3. if NOT installed, j

      if (attempt > 0) {
        let WARNING = `<div><div>If the Visual Studio Install Step keeps repeating, try the following:</div>
  <ol style="padding-inline-start:20px">
    <li>Launch <b>Visual Studio Installer</b> on Windows</li>
    <li>Find <b>Visual Studio Build Tools 2019</b> and <b>Uninstall</b></li>
    <li>And relaunch Pinokio</li>
  </ol></div>`
        /*
        ondata({
          raw: `\r\n\x1b[33m${WARNING}\x1b[0m\r\n\r\n`
        })
        */

        let html = `<div>
  <img src="/vsinstaller.gif">
  <div style="padding:5px; font-size:12px">${WARNING}</div>
  </div>`
        ondata({
          html,
  //        href: <link location to open>,
        }, "notify")
      }

      // Download installer
      const installer_url = "https://github.com/cocktailpeanut/bin/releases/download/vs_buildtools/vs_buildtools.exe"
      const installer = "vs_buildtools.exe"
      ondata({ raw: `[1] downloading installer: ${installer_url}...\r\n` })
      await this.kernel.bin.download(installer_url, installer, ondata)
      ondata({ raw: `[2] Installing..\r\n` })
      let commands = [
        this.cmd("uninstall"),
        this.cmd("install"),
        this.cmd("repair")
      ]
      let cmd = commands.join(" && ")
      await this.kernel.bin.exec({ sudo: true, message: cmd, }, (stream) => {
        ondata(stream)
      })
      ondata({ raw: `Install finished\r\n\r\n` })


      return this.kernel.bin.rm(installer, ondata)
    } else {
      ondata({ raw: `Must be Windows 10 or above\r\n` })
    }
  }
  async getpaths() {
    let MSVC_PATH = []
    let BUILD_PATH = []
    let CMAKE_PATH = []
    let CL_PATH = []
    const program_file_paths = [process.env["ProgramFiles(x86)"], process.env["ProgramFiles"]]
    for(let rp of program_file_paths) {
      const ROOT_PATH = path.resolve(rp, "Microsoft Visual Studio")

      const e1 = await this.kernel.bin.exists(ROOT_PATH)
      if (e1) {
        console.log("exists", ROOT_PATH)
        let vcpaths = await glob('**/VC/Tools/MSVC', { absolute: true, cwd: ROOT_PATH })
        console.log({ vcpaths })
        if (vcpaths && vcpaths.length > 0) {
          for(let vcpath of vcpaths) {
            if (/.*2019.*/.test(vcpath)) {
              MSVC_PATH.push(vcpath)
            }
          }
        }
        let buildpaths = await glob('**/VC/Auxiliary/Build', { absolute: true, cwd: ROOT_PATH })
        console.log({ buildpaths })
        if (buildpaths && buildpaths.length > 0) {
          for(let buildpath of buildpaths) {
            if (/.*2019.*/.test(buildpath)) {
              BUILD_PATH.push(buildpath)
            }
          }
        }

        let cmakepaths = await glob('**/Microsoft/CMake/CMake/bin', { absolute: true, cwd: ROOT_PATH })
        console.log({ cmakepaths })
        if (cmakepaths && cmakepaths.length > 0) {
          for(let cmakepath of cmakepaths) {
            if (/.*2019.*/.test(cmakepath)) {
              CMAKE_PATH.push(cmakepath)
            }
          }
        }
          //CL_PATH = await glob('**/Hostx64/x64/cl.exe', { absolute: true, cwd: ROOT_PATH })
        let clpaths = await glob('**/Hostx64/x64', { absolute: true, cwd: ROOT_PATH })
        console.log({ clpaths })
        if (clpaths && clpaths.length > 0) {
          for(let clpath of clpaths) {
            if (/.*2019.*/.test(clpath)) {
              CL_PATH.push(clpath)
            }
          }
        }
      }
    }
    console.log({ MSVC_PATH, BUILD_PATH, CMAKE_PATH, CL_PATH })
    return {
      // ROOT_PATH,
      MSVC_PATH,
      BUILD_PATH,
      CMAKE_PATH,
      CL_PATH,
    }

  }
  async init() {
    if (this.kernel.platform === "win32") {
      /*
      {
        BUILD_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build'
        ]
      }
      */
      this._env = await this.getpaths()
      if (this._env.BUILD_PATH.length > 0) {
        // look for vcvarsall
        for(let p of this._env.BUILD_PATH) {
          let vcvars_path = path.resolve(p, "vcvarsall.bat")
          const e = await this.kernel.bin.exists(vcvars_path)
          console.log("> vcvarsall.bat path exists?", { vcvars_path, e })
          if (e) {
            this._env.VCVARSALL_PATH = vcvars_path
            break
          }
        }
      }
      console.log("vs.init() this._env=", this._env)
    }
  }
  env () {
    if (this.kernel.platform === "win32") {
      return this._env
    }
  }
  async installed() {
    if (this.kernel.platform === "win32") {
      await this.init()
      console.log("VS INSTALLED CHECK", this._env)
      return this._env.MSVC_PATH && this._env.MSVC_PATH.length > 0 && this._env.BUILD_PATH && this._env.BUILD_PATH.length > 0 && this._env.CMAKE_PATH && this._env.CMAKE_PATH.length > 0 && this._env.VCVARSALL_PATH && this._env.VCVARSALL_PATH.length > 0
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

    let cmd
    if (mode === "repair") {
      cmd = `${filename} ${mode}`
    } else if (mode === "uninstall") {
      cmd = `${filename} ${mode}`
    } else if (mode === "install") {
      cmd = `${filename}`
    }
    //const command = `start /wait ${cmd} --passive --wait --nocache --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`
    const command = `start /wait ${cmd} --passive --wait --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended`
    return command
  }
}
module.exports = VS
