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

    // 2.1. Try uninstalling first
    ondata({ raw: `uninstalling existing vs 2019 in case corrupt...\r\n` })
    await this.uninstall(req, ondata)

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
  async getpaths() {
    let MSVC_PATH
    let BUILD_PATH
    let CMAKE_PATH
    let CL_PATH
    const program_file_paths = [process.env["ProgramFiles(x86)"], process.env["ProgramFiles"]]
    for(let rp of program_file_paths) {
      const ROOT_PATH = path.resolve(rp, "Microsoft Visual Studio")

      const e1 = await this.kernel.bin.exists(ROOT_PATH)
      if (e1) {
        console.log("exists", ROOT_PATH)
        MSVC_PATH = await glob('**/VC/Tools/MSVC', { absolute: true, cwd: ROOT_PATH })
        if (MSVC_PATH && MSVC_PATH.length > 0) {
          // look for 2019 only
          MSVC_PATH = MSVC_PATH.filter((x) => {
            return /.*2019.*/.test(x)
          })
          console.log({ MSVC_PATH })
          BUILD_PATH = await glob('**/VC/Auxiliary/Build', { absolute: true, cwd: ROOT_PATH })
          if (BUILD_PATH && BUILD_PATH.length > 0) {
            BUILD_PATH = BUILD_PATH.filter((x) => {
              return /.*2019.*/.test(x)
            })
          }
          console.log({ BUILD_PATH })
          CMAKE_PATH = await glob('**/Microsoft/CMake/CMake/bin', { absolute: true, cwd: ROOT_PATH })
          if (CMAKE_PATH && CMAKE_PATH.length > 0) {
            CMAKE_PATH = CMAKE_PATH.filter((x) => {
              return /.*2019.*/.test(x)
            })
          }
          console.log({ CMAKE_PATH })
          //CL_PATH = await glob('**/Hostx64/x64/cl.exe', { absolute: true, cwd: ROOT_PATH })
          CL_PATH = await glob('**/Hostx64/x64', { absolute: true, cwd: ROOT_PATH })
          if (CL_PATH && CL_PATH.length > 0) {
            CL_PATH = CL_PATH.filter((x) => {
              return /.*2019.*/.test(x)
            })
          }
          console.log({ CL_PATH })
          break;  
        }
      }


      /*
      Example:
      {
        ROOT_PATH: "C:\Program Files (x86)\Microsoft Visual Studio"
      },
      {
        MSVC_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Tools\\MSVC'
        ]
      }
      {
        BUILD_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build'
        ]
      }
      {
        CMAKE_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin'
        ]
      }
      {
        CL_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Tools\\MSVC\\14.29.30133\\bin\\Hostx64\\x64',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.42.34433\\bin\\Hostx64\\x64'
        ]
      }
      */

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
//  async getpaths() {
//    const ROOT_PATH = process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"]
//
//    const MSVC_2019_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Tools/MSVC")
//    const MSVC_2022_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2022", "BuildTools/VC/Tools/MSVC")
//    const e1 = await this.kernel.bin.exists(MSVC_2019_PATH)
//    const e2 = await this.kernel.bin.exists(MSVC_2022_PATH)
//    let MSVC_PATH
//    if (e1) {
//      MSVC_PATH = MSVC_2019_PATH  
//    } else if (e2) {
//      MSVC_PATH = MSVC_2022_PATH  
//    }
//
//    const BUILD_2019_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/VC/Auxiliary/Build")
//    const BUILD_2022_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2022", "BuildTools/VC/Auxiliary/Build")
//    const e3 = await this.kernel.bin.exists(BUILD_2019_PATH)
//    const e4 = await this.kernel.bin.exists(BUILD_2022_PATH)
//    let BUILD_PATH
//    if (e3) {
//      BUILD_PATH = BUILD_2019_PATH
//    } else if (e4) {
//      BUILD_PATH = BUILD_2022_PATH
//    }
//
//    const CMAKE_2019_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2019", "BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin")
//    const CMAKE_2022_PATH = path.resolve(ROOT_PATH, "Microsoft Visual Studio", "2022", "BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin")
//    const e5 = await this.kernel.bin.exists(CMAKE_2019_PATH)
//    const e6 = await this.kernel.bin.exists(CMAKE_2022_PATH)
//    let CMAKE_PATH
//    if (e5) {
//      CMAKE_PATH = CMAKE_2019_PATH
//    } else if (e6) {
//      CMAKE_PATH = CMAKE_2022_PATH
//    }
//
//    console.log({
//      e1, e2, e3, e4, e5, e6,
//      ROOT_PATH,
//      MSVC_2019_PATH, MSVC_2022_PATH,
//      BUILD_2019_PATH, BUILD_2022_PATH,
//      CMAKE_2019_PATH, CMAKE_2022_PATH,
//      MSVC_PATH,
//      BUILD_PATH,
//      CMAKE_PATH
//    })
//
//    return {
//      ROOT_PATH,
//      MSVC_PATH,
//      BUILD_PATH,
//      CMAKE_PATH
//    }
//
//  }
  async init() {
    if (this.kernel.platform === "win32") {
      let paths = await this.getpaths()

      const env = {
        PATH: [
//          "C:\\Windows\\System32",
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        ],
        BUILD_PATH: paths.BUILD_PATH
      }

      if (paths.MSVC_PATH) env.PATH = env.PATH.concat(paths.MSVC_PATH)
      if (paths.BUILD_PATH) env.PATH = env.PATH.concat(paths.BUILD_PATH)
      if (paths.CMAKE_PATH) env.PATH = env.PATH.concat(paths.CMAKE_PATH)
      if (paths.CL_PATH) env.PATH = env.PATH.concat(paths.CL_PATH)

      /*
      {
        BUILD_PATH: [
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build',
          'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build'
        ]
      }
      */

      if (paths.BUILD_PATH) {
        let build_paths = paths.BUILD_PATH
        // look for vcvarsall
        // try to use 2019 first
        for(let p of build_paths) {
          if (/.*2019.*/.test(p)) {
            const e = await this.kernel.bin.exists(p)
            console.log(">1 e", {e, p})
            if (e) {
              let vcvars_path = path.resolve(p, "vcvarsall.bat")
              const e2 = await this.kernel.bin.exists(vcvars_path)
              console.log(">1 e2", e2)
              if (e2) {
                env.VCVARSALL_PATH = vcvars_path
                break
              }
            }
          }
        }

        // only if 2019 doesn't exist try others
        if (!env.VCVARSALL_PATH) {
          for(let p of build_paths) {
            const e = await this.kernel.bin.exists(p)
            console.log(">2 e", { e, p})
            if (e) {
              let vcvars_path = path.resolve(p, "vcvarsall.bat")
              const e2 = await this.kernel.bin.exists(vcvars_path)
              console.log(">2 e2", e2)
              if (e2) {
                env.VCVARSALL_PATH = vcvars_path
                break
              }
            }
          }
        }
        console.log(">>> env", env)
      }

//      const clpaths = await glob('**/bin/Hostx64/x64/cl.exe', { cwd: paths.MSVC_PATH })
//      if (clpaths && clpaths.length > 0) {
//        let win_cl_path = path.resolve(paths.MSVC_PATH, path.dirname(clpaths[0]))
//        env.PATH.push(win_cl_path)
//      }
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
      let paths = await this.getpaths()
      console.log("VS INSTALLED CHECK", paths)
      return paths.MSVC_PATH && paths.MSVC_PATH.length > 0 && paths.BUILD_PATH && paths.BUILD_PATH.length > 0 && paths.CMAKE_PATH && paths.CMAKE_PATH.length > 0
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
