const fs = require('fs')
const path = require('path')
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
class Conda {
  urls = {
    darwin: {
      x64: "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-MacOSX-x86_64.sh",
      arm64: "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-MacOSX-arm64.sh"
    },
    win32: {
      x64: "https://github.com/cocktailpeanut/miniconda/releases/download/v23.5.2/Miniconda3-py310_23.5.2-0-Windows-x86_64.exe",
    },
    linux: {
      x64: "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-Linux-x86_64.sh",
      arm64: "https://repo.anaconda.com/miniconda/Miniconda3-py310_23.5.2-0-Linux-aarch64.sh"
    }
  }
  installer = {
    darwin: "installer.sh",
    win32: "installer.exe",
    linux: "installer.sh"
  }
  paths = {
    darwin: [ "miniconda/bin", "miniconda/condabin", "miniconda/Library/bin", "miniconda" ],
    win32: ["miniconda/Scripts", "miniconda/condabin", "miniconda/Library/bin", "miniconda"],
    linux: ["miniconda/bin", "miniconda/condabin", "miniconda/Library/bin", "miniconda"]
  }
  env(bin) {
    let base = {
      CONDA_EXE: (bin.platform === 'win32' ? bin.path("miniconda/Scripts/conda") : bin.path("miniconda/bin/conda")),
      CONDA_PYTHON_EXE: (bin.platform === 'win32' ? bin.path("miniconda/Scripts/python") : bin.path("miniconda/bin/python")),
      CONDA_PREFIX: bin.path("miniconda"),
      PYTHON: bin.path("miniconda/python"),
      PATH: this.paths[bin.platform].map((p) => {
        return bin.path(p)
      })
    }
    if (bin.platform === 'darwin') {
      base.TCL_LIBRARY = bin.path("miniconda/lib/tcl8.6")
      base.TK_LIBRARY = bin.path("miniconda/lib/tk8.6")
    }
    return base
  }
  async install(bin, ondata) {
    const installer_url = this.urls[bin.platform][bin.arch]
    const installer = this.installer[bin.platform]
    const install_path = bin.path("miniconda")

    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await bin.download(installer_url, installer, ondata)

    // 2. run the script
    ondata({ raw: `running installer: ${installer}...\r\n` })

    let cmd
    if (bin.platform === "win32") {
      cmd = `start /wait ${installer} /InstallationType=JustMe /RegisterPython=0 /S /D=${install_path}`
    } else {
      cmd = `bash ${installer} -b -p ${install_path}`
    }
    ondata({ raw: `${cmd}\r\n` })
    ondata({ raw: `path: ${bin.path()}\r\n` })
    await bin.exec({ message: cmd, }, (stream) => {
      console.log({ stream })
      ondata(stream)
    })
    await bin.exec({ message: "conda update -y --all", }, (stream) => {
      console.log({ stream })
      ondata(stream)
    })
    ondata({ raw: `Install finished\r\n` })
    return bin.rm(installer, ondata)
  }
  async exists(bin, name) {
    let paths = this.paths[bin.platform]
    for(let p of paths) {
      let e = await bin.exists(p + "/" + name)
      if (e) return true
    }
    return false
  }

  async installed(bin) {
    let e
    for(let p of this.paths[bin.platform]) {
      let e = await bin.exists(p)
      if (e) return true
    }
    return false
  }

  uninstall(bin) {
    const install_path = bin.path("miniconda")
    return bin.rm(install_path, ondata)
  }

  onstart(bin) {
    if (bin.platform === "win32") {
      return ["conda_hook"]
    } else {
      //return ['eval \"$(conda shell.bash hook)\"']
      return ['eval "$(conda shell.bash hook)"']
    }
  }

}
module.exports = Conda
