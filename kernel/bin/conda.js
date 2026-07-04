const fs = require('fs')
const path = require('path')
const { glob } = require('glob')
const semver = require('semver')
const { buildCondaListFromMeta, managedCondaRuns } = require('./conda-meta')
const {
  CONDA_PIN_VERSION,
  PYTHON_INSTALL_SPEC,
  WINDOWS_PYTHON_SSL_FIX_SPEC,
  isExpectedPythonPinned,
} = require('./conda-pins')

const MINIFORGE_RELEASE = "26.3.2-3"
const MINIFORGE_BASE_URL = `https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_RELEASE}`
const CONDA_ROOT_DIR = "miniforge"
const LEGACY_CONDA_ROOT_DIR = "miniconda"

class Conda {
  description = "Pinokio uses Conda to install various useful programs in an isolated manner."
  urls = {
    darwin: {
      x64: `${MINIFORGE_BASE_URL}/Miniforge3-MacOSX-x86_64.sh`,
      arm64: `${MINIFORGE_BASE_URL}/Miniforge3-MacOSX-arm64.sh`
    },
    win32: {
      x64: `${MINIFORGE_BASE_URL}/Miniforge3-Windows-x86_64.exe`,
    },
    linux: {
      x64: `${MINIFORGE_BASE_URL}/Miniforge3-Linux-x86_64.sh`,
      arm64: `${MINIFORGE_BASE_URL}/Miniforge3-Linux-aarch64.sh`
    }
  }
  installer = {
    darwin: "installer.sh",
    win32: "installer.exe",
    linux: "installer.sh"
  }
  paths = {
    darwin: [ `${CONDA_ROOT_DIR}/etc/profile.d`, `${CONDA_ROOT_DIR}/bin`, `${CONDA_ROOT_DIR}/condabin`, `${CONDA_ROOT_DIR}/lib`, `${CONDA_ROOT_DIR}/Library/bin`, `${CONDA_ROOT_DIR}/pkgs`, CONDA_ROOT_DIR ],
    win32: [`${CONDA_ROOT_DIR}/etc/profile.d`, `${CONDA_ROOT_DIR}/bin`, `${CONDA_ROOT_DIR}/Scripts`, `${CONDA_ROOT_DIR}/condabin`, `${CONDA_ROOT_DIR}/lib`, `${CONDA_ROOT_DIR}/Library/bin`, `${CONDA_ROOT_DIR}/pkgs`, CONDA_ROOT_DIR],
    linux: [`${CONDA_ROOT_DIR}/etc/profile.d`, `${CONDA_ROOT_DIR}/bin`, `${CONDA_ROOT_DIR}/condabin`, `${CONDA_ROOT_DIR}/lib`, `${CONDA_ROOT_DIR}/Library/bin`, `${CONDA_ROOT_DIR}/pkgs`, CONDA_ROOT_DIR]
  }
  pinnedPackages() {
    return [
      `conda ==${CONDA_PIN_VERSION}`,
    ].join("\n")
  }
  async hasCondaMeta() {
    return await this.kernel.exists(`bin/${CONDA_ROOT_DIR}/conda-meta`)
  }
  env() {
    let base = {
      CONDA_PREFIX: this.kernel.bin.path(CONDA_ROOT_DIR),
      CONDA_ENVS_PATH: this.kernel.bin.path(`${CONDA_ROOT_DIR}/envs`),
      CONDA_PKGS_DIRS: this.kernel.bin.path(`${CONDA_ROOT_DIR}/pkgs`),
      PYTHON: this.kernel.bin.path(`${CONDA_ROOT_DIR}/python`),
      PATH: this.paths[this.kernel.platform].map((p) => {
        return this.kernel.bin.path(p)
      })
    }
    if (this.kernel.platform === "win32") {
      base.CONDA_BAT = this.kernel.bin.path(`${CONDA_ROOT_DIR}/condabin/conda.bat`)
      base.CONDA_EXE = this.kernel.bin.path(`${CONDA_ROOT_DIR}/Scripts/conda.exe`)
      base.CONDA_PYTHON_EXE = this.kernel.bin.path(`${CONDA_ROOT_DIR}/Scripts/python`)
    }
    if (this.kernel.platform === 'darwin') {
      base.TCL_LIBRARY = this.kernel.bin.path(`${CONDA_ROOT_DIR}/lib/tcl8.6`)
      base.TK_LIBRARY = this.kernel.bin.path(`${CONDA_ROOT_DIR}/lib/tk8.6`)
    }
    return base
  }
  async ensureSslCertDirOverride() {
    if (this.kernel.platform !== "win32") {
      return
    }
    const condaRootDirs = []
    for (const rootDir of [CONDA_ROOT_DIR, LEGACY_CONDA_ROOT_DIR]) {
      if (await this.kernel.exists(`bin/${rootDir}/conda-meta`)) {
        condaRootDirs.push(rootDir)
      }
    }
    if (condaRootDirs.length === 0) {
      return
    }
    const hookFiles = {
      "zz_pinokio_unset_ssl_cert_dir-win.bat": `@echo off
if "%__CONDA_OPENSSL_CERT_DIR_SET%"=="1" (
    set "SSL_CERT_DIR="
    set "__CONDA_OPENSSL_CERT_DIR_SET="
)
`,
      "zz_pinokio_unset_ssl_cert_dir-win.ps1": `if ($Env:__CONDA_OPENSSL_CERT_DIR_SET -eq "1") {
  Remove-Item -Path Env:\\SSL_CERT_DIR -ErrorAction SilentlyContinue
  Remove-Item -Path Env:\\__CONDA_OPENSSL_CERT_DIR_SET -ErrorAction SilentlyContinue
}
`,
      "zz_pinokio_unset_ssl_cert_dir-win.sh": `if [[ "\${__CONDA_OPENSSL_CERT_DIR_SET:-}" == "1" ]]; then
  unset SSL_CERT_DIR
  unset __CONDA_OPENSSL_CERT_DIR_SET
fi
`,
    }
    for (const rootDir of condaRootDirs) {
      const hookDirs = [
        this.kernel.bin.path(`${rootDir}/etc/conda/activate.d`),
        this.kernel.bin.path(`${rootDir}/etc/conda/deactivate.d`),
      ]
      for (const hookDir of hookDirs) {
        await fs.promises.mkdir(hookDir, { recursive: true }).catch(() => {})
        for (const [filename, content] of Object.entries(hookFiles)) {
          await fs.promises.writeFile(path.resolve(hookDir, filename), content)
        }
      }
    }
  }
  async init() {
    if (this.kernel.homedir) {
        console.log("condarc init")
        await fs.promises.writeFile(this.kernel.path('condarc'), `channels:
  - conda-forge
channel_priority: flexible
create_default_packages:
  - ${PYTHON_INSTALL_SPEC}
envs_dirs:
  - ${this.kernel.bin.path(`${CONDA_ROOT_DIR}/envs`)}
pkgs_dirs:
  - ${this.kernel.bin.path(`${CONDA_ROOT_DIR}/pkgs`)}
remote_connect_timeout_secs: 20.0
remote_read_timeout_secs: 300.0
remote_max_retries: 6
report_errors: false`)
      let pinned_exists = await this.hasCondaMeta()
      if (pinned_exists) {
        await fs.promises.writeFile(this.kernel.path(`bin/${CONDA_ROOT_DIR}/conda-meta/pinned`), this.pinnedPackages())
        await this.ensureCompatibilityAlias()
      }
      await this.ensureSslCertDirOverride()
    }
  }
  async check() {
    let res = await buildCondaListFromMeta(this.kernel.bin.path(CONDA_ROOT_DIR))

    let lines = res.response.split(/[\r\n]+/)
    let conda_check = {}
    let conda = new Set()
    let conda_versions = {}
    let conda_builds = {}
    let start = false
    for(let line of lines) {
      if (start) {
        let chunks = line.split(/\s+/).filter(x => x)
        if (chunks.length > 2) {
          let name = chunks[0]
          let version = chunks[1]
          let build = chunks[2]
          conda.add(name)
          conda_versions[name] = version
          conda_builds[name] = build
          if (name === "conda") {
            conda_check.conda = true
          }
          // check conda-libmamba-solver is up to date
          // sometimes it just fails silently so need to check
          if (name === "conda-libmamba-solver") {
            let coerced = semver.coerce(version)
            let mamba_requirement = ">=25.4.0"
            if (semver.satisfies(coerced, mamba_requirement)) {
              conda_check.mamba = true
            }
          }

          if (name === "python") {
            conda_check.python = isExpectedPythonPinned(this.kernel.platform, version, build)
          }
        }
      } else {
        if (/.*name.*version.*build.*channel/i.test(line)) {
          start = true 
        }
      }
    }
    this.kernel.bin.installed.conda = conda
    this.kernel.bin.installed.conda_versions = conda_versions
    this.kernel.bin.installed.conda_builds = conda_builds
    if (!(conda_check.conda && conda_check.mamba && conda_check.python)) {
      return false
    }
    return await managedCondaRuns(this.kernel.bin.path(CONDA_ROOT_DIR), this.kernel.platform)
  }
  async install(req, ondata) {
    for(let i=0; i<5; i++) {
      await this._install(req, ondata)
      let installed = await this.check()
      if (installed) {
        console.log("Conda properly installed and updated")
        return
      } else {
        console.log("Conda NOT roperly installed and updated. Trying again...")
      }
    }
  }
  async _install(req, ondata) {
    const installer_url = this.urls[this.kernel.platform][this.kernel.arch]
    const installer = this.installer[this.kernel.platform]
    const install_path = this.kernel.bin.path(CONDA_ROOT_DIR)
    const legacy_path = this.kernel.bin.path(LEGACY_CONDA_ROOT_DIR)
    let install_path_exists = await this.kernel.exists(`bin/${CONDA_ROOT_DIR}`)
    let legacy_path_exists = await this.kernel.exists(`bin/${LEGACY_CONDA_ROOT_DIR}`)
    if (install_path_exists || legacy_path_exists) {
      console.log("Install path already exists. Will replace after installer download...", install_path)
    } else {
      console.log("Install path does not exist. Installing...")
    }

    ondata({ raw: `downloading installer: ${installer_url}...\r\n` })
    await this.kernel.bin.download(installer_url, installer, ondata)

    legacy_path_exists = await this.kernel.exists(`bin/${LEGACY_CONDA_ROOT_DIR}`)
    if (legacy_path_exists) {
      console.log("Removing legacy install path...", legacy_path)
      await this.removeInstallPath(legacy_path)
    }
    install_path_exists = await this.kernel.exists(`bin/${CONDA_ROOT_DIR}`)
    if (install_path_exists) {
      console.log("Removing existing install path...", install_path)
      await this.removeInstallPath(install_path)
    }

    // 2. run the script
    ondata({ raw: `running installer: ${installer}...\r\n` })

    let cmd
    if (this.kernel.platform === "win32") {
      cmd = `start /wait ${installer} /InstallationType=JustMe /RegisterPython=0 /S /D=${install_path}`
    } else {
      cmd = `bash ${installer} -b -p ${install_path}`
    }
    ondata({ raw: `${cmd}\r\n` })
    ondata({ raw: `path: ${this.kernel.bin.path()}\r\n` })
    await this.kernel.bin.exec({ message: cmd, conda: { skip: true } }, (stream) => {
      ondata(stream)
    })

    // set pinned
    let pinned_exists = await this.kernel.exists(`bin/${CONDA_ROOT_DIR}/conda-meta`)
    if (pinned_exists) {
      await fs.promises.writeFile(this.kernel.path(`bin/${CONDA_ROOT_DIR}/conda-meta/pinned`), this.pinnedPackages())
    }

    let mods = this.kernel.bin.mods.filter((m) => {
      return req.dependencies.includes(m.name)
    }).map((m) => {
      if (m.mod.cmd) {
        return m.mod.cmd()
      } else {
        return ""
      }
    }).join(" ")
    console.log("Conda dependencies to install", { mods })

    let condaPackages = [
      this.kernel.platform === "win32" ? `"${WINDOWS_PYTHON_SSL_FIX_SPEC}"` : `"${PYTHON_INSTALL_SPEC}"`,
      `"conda-libmamba-solver>=25.4.0"`,
    ]

    let cmds = [
      "conda clean -y --all",
      `conda install -y --override-channels -c conda-forge ${condaPackages.join(" ")} ${mods}`.trim(),
    ]
    await this.kernel.bin.exec({
      message: cmds,
      env: {
        PIP_REQUIRE_VIRTUALENV: "false"
      }
    }, (stream) => {
      ondata(stream)
    })
    if (this.kernel.platform === "win32") {
      // copy python.exe to python3.exe so you can run with both python3 and python
      await fs.promises.copyFile(
        this.kernel.bin.path(CONDA_ROOT_DIR, "python.exe"),
        this.kernel.bin.path(CONDA_ROOT_DIR, "python3.exe"),
      )
    }
    await this.ensureSslCertDirOverride()
    await this.ensureCompatibilityAlias()
    ondata({ raw: `Install finished\r\n` })
    await this.kernel.bin.rm(installer, ondata)
  }
  async removeInstallPath(target) {
    try {
      const stat = await fs.promises.lstat(target).catch((error) => {
        if (error && error.code === "ENOENT") {
          return null
        }
        throw error
      })
      if (!stat) {
        return
      }
      if (stat.isSymbolicLink()) {
        await fs.promises.rm(target, { force: true })
        return
      }
      await fs.promises.rm(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250,
      })
    } catch (error) {
      const reason = error && (error.code || error.message) ? error.code || error.message : String(error)
      throw new Error([
        `Pinokio needs to replace the Conda runtime at ${target}, but it could not delete that folder.`,
        "Close Pinokio and any terminals or editors using Pinokio, delete that folder manually, then reopen Pinokio.",
        `Original error: ${reason}`,
      ].join("\n"))
    }
  }
  async ensureCompatibilityAlias() {
    const target = this.kernel.bin.path(CONDA_ROOT_DIR)
    const alias = this.kernel.bin.path(LEGACY_CONDA_ROOT_DIR)
    if (!(await this.hasCondaMeta())) {
      return
    }
    const aliasExists = await fs.promises.lstat(alias).then(() => true).catch(() => false)
    if (aliasExists) {
      return
    }
    try {
      await fs.promises.symlink(target, alias, this.kernel.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      console.warn("Could not create Conda compatibility alias", error && error.message ? error.message : error)
    }
  }
  async exists(pattern) {
    let paths = this.paths[this.kernel.platform]
    for(let p of paths) {
      const found = await glob(pattern, {
        cwd: this.kernel.bin.path(p)
      })
      if (found && found.length > 0) {
        return true
      }
    }
    return false
  }

  async installed() {
    for(let p of this.paths[this.kernel.platform]) {
      let e = await this.kernel.bin.exists(p)
      if (e && this.kernel.bin.correct_conda) {
        return true
      }
    }
    return false
  }

  async uninstall(req, ondata) {
    await this.kernel.bin.rm(LEGACY_CONDA_ROOT_DIR, ondata)
    return this.kernel.bin.rm(CONDA_ROOT_DIR, ondata)
  }

  onstart() {
    if (this.kernel.platform === "win32") {
      return ["conda_hook"]
    } else {
      //return ['eval \"$(conda shell.bash hook)\"']
      return ['eval "$(conda shell.bash hook)"']
    }
  }

}
module.exports = Conda
