const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { execFile } = require("child_process")
const ParcelWatcher = require("@parcel/watcher")
const semver = require("semver")
const { rimraf } = require("rimraf")
const Util = require("../util")

const RELEASE_VERSION = "8.0.1"
const RELEASE_RANGE = ">=8.0.1 <8.1.0"
const CONDA_SPEC = `ffmpeg=${RELEASE_VERSION}`
const CONDA_CHANNEL_FLAGS = "--override-channels -c conda-forge"

const WINDOWS_GDK_PIXBUF_POST_LINK_NOOP = `@echo off
rem Pinokio intentionally skips gdk-pixbuf loader cache generation for FFmpeg installs.
exit /b 0
`

class Ffmpeg {
  description = "Installs FFmpeg for audio and video processing."

  cmd() {
    return CONDA_SPEC
  }

  env(kernel) {
    const activeKernel = kernel || this.kernel
    const env = {
      FFMPEG_PATH: this.binaryPath("ffmpeg", activeKernel),
      FFPROBE_PATH: this.binaryPath("ffprobe", activeKernel)
    }
    if (activeKernel.platform === "win32") {
      env.PATH = [this.libraryDir(activeKernel)]
    }
    if (activeKernel.platform === "linux") {
      env.LD_LIBRARY_PATH = [this.libraryDir(activeKernel)]
    }
    return env
  }

  ffmpegPrefix(kernel = this.kernel) {
    return kernel.bin.path("ffmpeg-env")
  }

  ffmpegPkgsDir(kernel = this.kernel) {
    return kernel.bin.path("ffmpeg-pkgs")
  }

  binaryPath(tool, kernel = this.kernel) {
    const filename = kernel.platform === "win32" ? `${tool}.exe` : tool
    if (kernel.platform === "win32") {
      return path.resolve(this.ffmpegPrefix(kernel), "Library", "bin", filename)
    }
    return path.resolve(this.ffmpegPrefix(kernel), "bin", filename)
  }

  libraryDir(kernel = this.kernel) {
    if (kernel.platform === "win32") {
      return path.resolve(this.ffmpegPrefix(kernel), "Library", "bin")
    }
    return path.resolve(this.ffmpegPrefix(kernel), "lib")
  }

  legacyStandalonePaths() {
    return [
      this.kernel.bin.path("ffmpeg"),
      this.kernel.bin.path("ffmpeg-tmp")
    ]
  }

  async start() {
    if (this.kernel.platform !== "darwin") {
      return
    }
    try {
      if (!(await this.hasInstalledBinaryPaths())) {
        await this.removeRuntimeExposure()
        return
      }
      await this.selfTest()
      await this.ensureBaseActivationHooks()
      await this.syncMacUvLibraryShims()
      await this.startMacUvLibraryWatcher()
    } catch (error) {
      await this.removeRuntimeExposure()
      console.log("conda ffmpeg start check failed", error && error.message ? error.message : error)
    }
  }

  async install(req, ondata) {
    await this.cleanupLegacyStandalone(ondata)
    if (this.kernel.platform === "win32") {
      await this.installWindows(ondata)
    } else {
      await this.installStandard(ondata)
    }
    await this.selfTest(ondata)
    await this.ensureBaseActivationHooks()
    await this.syncMacUvLibraryShims(ondata)
  }

  async installStandard(ondata) {
    await this.resetInstallPrefix()
    await this.kernel.bin.exec({
      env: {
        CONDA_PKGS_DIRS: this.ffmpegPkgsDir()
      },
      message: [
        "conda clean -y --all",
        `conda create -y -p "${this.ffmpegPrefix()}" ${CONDA_CHANNEL_FLAGS} ${this.cmd()}`
      ]
    }, ondata)
  }

  async installWindows(ondata) {
    await this.resetInstallPrefix()
    const env = {
      CONDA_PKGS_DIRS: this.ffmpegPkgsDir()
    }

    await this.kernel.bin.exec({
      env,
      message: [
        "conda clean -y --all",
        `conda create -y --download-only -p "${this.ffmpegPrefix()}" ${CONDA_CHANNEL_FLAGS} ${this.cmd()}`
      ]
    }, ondata)

    await this.patchWindowsGdkPixbufPostLink(this.ffmpegPkgsDir(), ondata)

    await this.kernel.bin.exec({
      env,
      message: `conda create -y --offline -p "${this.ffmpegPrefix()}" ${CONDA_CHANNEL_FLAGS} ${this.cmd()}`
    }, ondata)
  }

  async resetInstallPrefix() {
    await rimraf(this.ffmpegPrefix())
    await rimraf(this.ffmpegPkgsDir())
    await fs.promises.mkdir(this.ffmpegPkgsDir(), { recursive: true })
  }

  async patchWindowsGdkPixbufPostLink(pkgsDir, ondata) {
    const entries = await fs.promises.readdir(pkgsDir, { withFileTypes: true })
    const packageDirs = entries
      .filter((entry) => entry.isDirectory() && /^gdk-pixbuf-/.test(entry.name))
      .map((entry) => path.resolve(pkgsDir, entry.name))

    if (packageDirs.length === 0) {
      throw new Error("Could not find downloaded gdk-pixbuf package in the Conda cache after --download-only")
    }

    let patchedCount = 0
    let metadataCount = 0
    for (const packageDir of packageDirs) {
      const scripts = [
        {
          relativePath: "Scripts/.gdk-pixbuf-post-link.bat",
          metadataRequired: true
        },
        {
          relativePath: "info/recipe/post-link.bat",
          metadataRequired: false
        }
      ]

      for (const { relativePath, metadataRequired } of scripts) {
        const script = path.resolve(packageDir, ...relativePath.split("/"))
        try {
          await fs.promises.access(script)
          await fs.promises.writeFile(script, WINDOWS_GDK_PIXBUF_POST_LINK_NOOP)
          patchedCount += 1
          const updatedMetadata = await this.updateCondaPathsJson(packageDir, relativePath, WINDOWS_GDK_PIXBUF_POST_LINK_NOOP)
          if (updatedMetadata) {
            metadataCount += 1
          } else if (metadataRequired) {
            throw new Error(`Patched ${relativePath} in ${packageDir}, but did not find a matching info/paths.json entry`)
          }
        } catch (error) {
          if (error && error.code !== "ENOENT") {
            throw error
          }
        }
      }
    }

    if (patchedCount === 0) {
      throw new Error("Found gdk-pixbuf in the Conda cache, but did not find any post-link scripts to patch")
    }

    if (ondata) {
      ondata({
        raw: `patched ${patchedCount} gdk-pixbuf post-link script(s) in the Conda cache and refreshed ${metadataCount} paths.json entr${metadataCount === 1 ? "y" : "ies"}...\r\n`
      })
    }
  }

  async updateCondaPathsJson(packageDir, relativePath, contents) {
    const pathsJsonPath = path.resolve(packageDir, "info", "paths.json")
    let pathsJson

    try {
      pathsJson = JSON.parse(await fs.promises.readFile(pathsJsonPath, "utf8"))
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return false
      }
      throw error
    }

    if (!pathsJson || !Array.isArray(pathsJson.paths)) {
      return false
    }

    const normalizedPath = relativePath.replace(/\\/g, "/")
    const entry = pathsJson.paths.find((item) => item && item._path === normalizedPath)
    if (!entry) {
      return false
    }

    const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), "utf8")
    entry.sha256 = crypto.createHash("sha256").update(buffer).digest("hex")
    entry.size_in_bytes = buffer.length

    await fs.promises.writeFile(pathsJsonPath, `${JSON.stringify(pathsJson, null, 2)}\n`)
    return true
  }

  async hasInstalledBinaryPaths() {
    try {
      await fs.promises.access(this.binaryPath("ffmpeg"))
      await fs.promises.access(this.binaryPath("ffprobe"))
      return true
    } catch (error) {
      return false
    }
  }

  async removeRuntimeExposure(ondata) {
    await this.stopMacUvLibraryWatcher()
    await this.removeMacUvLibraryShims(ondata)
    await this.removeBaseActivationHooks()
  }

  async installed() {
    try {
      if (!(await this.hasInstalledBinaryPaths())) {
        await this.removeRuntimeExposure()
        return false
      }

      await this.selfTest()
      await this.ensureBaseActivationHooks()
      await this.syncMacUvLibraryShims()
      await this.startMacUvLibraryWatcher()
      return true
    } catch (error) {
      await this.removeRuntimeExposure()
      console.log("conda ffmpeg installed check failed", error && error.message ? error.message : error)
      return false
    }
  }

  async uninstall(req, ondata) {
    await this.removeRuntimeExposure(ondata)
    const prefix = this.ffmpegPrefix()
    const exists = await fs.promises.access(prefix).then(() => true).catch(() => false)
    if (exists) {
      try {
        await this.kernel.bin.exec({
          env: {
            CONDA_PKGS_DIRS: this.ffmpegPkgsDir()
          },
          message: `conda remove -y -p "${prefix}" --all`
        }, ondata)
      } catch (error) {
        await rimraf(prefix)
      }
    }
    await rimraf(prefix)
    await rimraf(this.ffmpegPkgsDir())
    await this.cleanupLegacyStandalone(ondata)
  }

  activationDirs() {
    return {
      activate: this.kernel.bin.path("miniconda", "etc", "conda", "activate.d"),
      deactivate: this.kernel.bin.path("miniconda", "etc", "conda", "deactivate.d")
    }
  }

  activationHookFiles() {
    const { activate, deactivate } = this.activationDirs()
    const files = [
      {
        path: path.resolve(activate, "zz_pinokio_ffmpeg.sh"),
        content: this.posixActivateSh(this.kernel.platform === "win32")
      },
      {
        path: path.resolve(deactivate, "zz_pinokio_ffmpeg.sh"),
        content: this.posixDeactivateSh(this.kernel.platform === "win32")
      }
    ]

    if (this.kernel.platform !== "win32") {
      return files
    }

    return files.concat([
      {
        path: path.resolve(activate, "zz_pinokio_ffmpeg.bat"),
        content: this.windowsActivateBat()
      },
      {
        path: path.resolve(deactivate, "zz_pinokio_ffmpeg.bat"),
        content: this.windowsDeactivateBat()
      },
      {
        path: path.resolve(activate, "zz_pinokio_ffmpeg.ps1"),
        content: this.windowsActivatePs1()
      },
      {
        path: path.resolve(deactivate, "zz_pinokio_ffmpeg.ps1"),
        content: this.windowsDeactivatePs1()
      }
    ])
  }

  async ensureBaseActivationHooks() {
    const dirs = this.activationDirs()
    await fs.promises.mkdir(dirs.activate, { recursive: true }).catch(() => {})
    await fs.promises.mkdir(dirs.deactivate, { recursive: true }).catch(() => {})
    for (const file of this.activationHookFiles()) {
      await fs.promises.writeFile(file.path, file.content)
    }
  }

  async removeBaseActivationHooks() {
    for (const file of this.activationHookFiles()) {
      await fs.promises.rm(file.path, { force: true }).catch(() => {})
    }
  }

  windowsActivateBat() {
    const prefix = this.ffmpegPrefix()
    const runtime = this.libraryDir()
    return `@echo off
set "PINOKIO_FFMPEG_PREFIX=${prefix}"
set "PINOKIO_FFMPEG_RUNTIME=${runtime}"
set "FFMPEG_PATH=%PINOKIO_FFMPEG_RUNTIME%\\ffmpeg.exe"
set "FFPROBE_PATH=%PINOKIO_FFMPEG_RUNTIME%\\ffprobe.exe"
call :pinokio_ffmpeg_remove_from_path "%PINOKIO_FFMPEG_RUNTIME%"
set "PATH=%PINOKIO_FFMPEG_RUNTIME%;%PATH%"
goto :eof

:pinokio_ffmpeg_remove_from_path
setlocal EnableDelayedExpansion
set "_pinokio_target=%~1"
set "_pinokio_path=;%PATH%;"
set "_pinokio_path=!_pinokio_path:;%_pinokio_target%;=;!"
set "_pinokio_path=!_pinokio_path:;%_pinokio_target%\\;=;!"
if "!_pinokio_path:~0,1!"==";" set "_pinokio_path=!_pinokio_path:~1!"
if "!_pinokio_path:~-1!"==";" set "_pinokio_path=!_pinokio_path:~0,-1!"
endlocal & set "PATH=%_pinokio_path%"
exit /b 0
`
  }

  windowsDeactivateBat() {
    return `@echo off
if defined PINOKIO_FFMPEG_RUNTIME call :pinokio_ffmpeg_remove_from_path "%PINOKIO_FFMPEG_RUNTIME%"
set "FFMPEG_PATH="
set "FFPROBE_PATH="
set "PINOKIO_FFMPEG_PREFIX="
set "PINOKIO_FFMPEG_RUNTIME="
goto :eof

:pinokio_ffmpeg_remove_from_path
setlocal EnableDelayedExpansion
set "_pinokio_target=%~1"
set "_pinokio_path=;%PATH%;"
set "_pinokio_path=!_pinokio_path:;%_pinokio_target%;=;!"
set "_pinokio_path=!_pinokio_path:;%_pinokio_target%\\;=;!"
if "!_pinokio_path:~0,1!"==";" set "_pinokio_path=!_pinokio_path:~1!"
if "!_pinokio_path:~-1!"==";" set "_pinokio_path=!_pinokio_path:~0,-1!"
endlocal & set "PATH=%_pinokio_path%"
exit /b 0
`
  }

  windowsActivatePs1() {
    const prefix = this.ffmpegPrefix().replace(/\\/g, "\\\\")
    const runtime = this.libraryDir().replace(/\\/g, "\\\\")
    return `$Env:PINOKIO_FFMPEG_PREFIX = "${prefix}"
$Env:PINOKIO_FFMPEG_RUNTIME = "${runtime}"
$Env:FFMPEG_PATH = Join-Path $Env:PINOKIO_FFMPEG_RUNTIME "ffmpeg.exe"
$Env:FFPROBE_PATH = Join-Path $Env:PINOKIO_FFMPEG_RUNTIME "ffprobe.exe"
$pinokioParts = @()
if ($Env:Path) {
  $pinokioParts = @($Env:Path -split ';' | Where-Object { $_ -and $_ -ne $Env:PINOKIO_FFMPEG_RUNTIME })
}
$Env:Path = (@($Env:PINOKIO_FFMPEG_RUNTIME) + $pinokioParts) -join ';'
`
  }

  windowsDeactivatePs1() {
    return `if ($Env:PINOKIO_FFMPEG_RUNTIME) {
  $pinokioParts = @()
  if ($Env:Path) {
    $pinokioParts = @($Env:Path -split ';' | Where-Object { $_ -and $_ -ne $Env:PINOKIO_FFMPEG_RUNTIME })
  }
  $Env:Path = $pinokioParts -join ';'
}
Remove-Item -Path Env:\\FFMPEG_PATH -ErrorAction SilentlyContinue
Remove-Item -Path Env:\\FFPROBE_PATH -ErrorAction SilentlyContinue
Remove-Item -Path Env:\\PINOKIO_FFMPEG_PREFIX -ErrorAction SilentlyContinue
Remove-Item -Path Env:\\PINOKIO_FFMPEG_RUNTIME -ErrorAction SilentlyContinue
`
  }

  posixActivateSh(forceWindowsPaths = false) {
    const prefix = forceWindowsPaths ? Util.p2u(this.ffmpegPrefix()) : this.ffmpegPrefix()
    const binDir = forceWindowsPaths ? Util.p2u(path.resolve(this.ffmpegPrefix(), "Library", "bin")) : path.resolve(this.ffmpegPrefix(), "bin")
    const libDir = forceWindowsPaths ? "" : this.libraryDir()
    return `pinokio_ffmpeg_prepend_path() {
  local target="$1"
  local current="\${2-}"
  local result=""
  local part
  local old_ifs="$IFS"
  IFS=':'
  for part in $current; do
    [ -n "$part" ] || continue
    [ "$part" = "$target" ] && continue
    if [ -n "$result" ]; then
      result="$result:$part"
    else
      result="$part"
    fi
  done
  IFS="$old_ifs"
  if [ -n "$result" ]; then
    printf '%s:%s' "$target" "$result"
  else
    printf '%s' "$target"
  fi
}
pinokio_ffmpeg_remove_path() {
  local target="$1"
  local current="\${2-}"
  local result=""
  local part
  local old_ifs="$IFS"
  IFS=':'
  for part in $current; do
    [ -n "$part" ] || continue
    [ "$part" = "$target" ] && continue
    if [ -n "$result" ]; then
      result="$result:$part"
    else
      result="$part"
    fi
  done
  IFS="$old_ifs"
  printf '%s' "$result"
}
export PINOKIO_FFMPEG_PREFIX="${prefix}"
export PINOKIO_FFMPEG_BIN="${binDir}"
export FFMPEG_PATH="$PINOKIO_FFMPEG_BIN/${forceWindowsPaths ? "ffmpeg.exe" : "ffmpeg"}"
export FFPROBE_PATH="$PINOKIO_FFMPEG_BIN/${forceWindowsPaths ? "ffprobe.exe" : "ffprobe"}"
export PATH="$(pinokio_ffmpeg_prepend_path "$PINOKIO_FFMPEG_BIN" "$PATH")"
${forceWindowsPaths ? "" : `if [ "$(uname -s)" = "Linux" ]; then
  export LD_LIBRARY_PATH="$(pinokio_ffmpeg_prepend_path "${libDir}" "\${LD_LIBRARY_PATH-}")"
fi
`}
unset -f pinokio_ffmpeg_prepend_path
unset -f pinokio_ffmpeg_remove_path
`
  }

  posixDeactivateSh(forceWindowsPaths = false) {
    return `pinokio_ffmpeg_remove_path() {
  local target="$1"
  local current="\${2-}"
  local result=""
  local part
  local old_ifs="$IFS"
  IFS=':'
  for part in $current; do
    [ -n "$part" ] || continue
    [ "$part" = "$target" ] && continue
    if [ -n "$result" ]; then
      result="$result:$part"
    else
      result="$part"
    fi
  done
  IFS="$old_ifs"
  printf '%s' "$result"
}
if [ -n "\${PINOKIO_FFMPEG_BIN-}" ]; then
  export PATH="$(pinokio_ffmpeg_remove_path "$PINOKIO_FFMPEG_BIN" "$PATH")"
fi
${forceWindowsPaths ? "" : `if [ "$(uname -s)" = "Linux" ] && [ -n "\${PINOKIO_FFMPEG_PREFIX-}" ]; then
  export LD_LIBRARY_PATH="$(pinokio_ffmpeg_remove_path "${this.libraryDir()}" "\${LD_LIBRARY_PATH-}")"
fi
`}
unset FFMPEG_PATH
unset FFPROBE_PATH
unset PINOKIO_FFMPEG_PREFIX
unset PINOKIO_FFMPEG_BIN
unset -f pinokio_ffmpeg_remove_path
`
  }

  async cleanupLegacyStandalone(ondata) {
    for (const target of this.legacyStandalonePaths()) {
      const exists = await fs.promises.access(target).then(() => true).catch(() => false)
      if (exists) {
        if (ondata) {
          ondata({ raw: `removing legacy standalone ffmpeg files from ${target}...\r\n` })
        }
        await rimraf(target)
      }
    }
  }

  uvPythonRoot(kernel = this.kernel) {
    return kernel.path("cache", "XDG_DATA_HOME", "uv", "python")
  }

  async startMacUvLibraryWatcher() {
    if (this.kernel.platform !== "darwin" || this.macUvLibraryWatcher) {
      return
    }

    const root = this.uvPythonRoot()
    await fs.promises.mkdir(root, { recursive: true })
    this.macUvLibraryWatcher = await ParcelWatcher.subscribe(root, (error, events) => {
      if (error) {
        console.warn("ffmpeg uv library watcher error", error && error.message ? error.message : error)
        return
      }
      if (!events || events.length === 0) {
        return
      }
      this.scheduleMacUvLibraryShimSync()
    })
  }

  async stopMacUvLibraryWatcher() {
    if (this.macUvLibraryShimSyncTimer) {
      clearTimeout(this.macUvLibraryShimSyncTimer)
      this.macUvLibraryShimSyncTimer = null
    }
    if (this.macUvLibraryWatcher) {
      await this.macUvLibraryWatcher.unsubscribe()
      this.macUvLibraryWatcher = null
    }
  }

  scheduleMacUvLibraryShimSync() {
    if (this.macUvLibraryShimSyncTimer) {
      clearTimeout(this.macUvLibraryShimSyncTimer)
    }
    this.macUvLibraryShimSyncTimer = setTimeout(async () => {
      this.macUvLibraryShimSyncTimer = null
      try {
        await this.syncMacUvLibraryShims()
      } catch (error) {
        console.warn("ffmpeg uv library shim sync error", error && error.message ? error.message : error)
      }
    }, 250)
  }

  async uvLibraryDirs(kernel = this.kernel) {
    if (kernel.platform !== "darwin") {
      return []
    }

    const root = this.uvPythonRoot(kernel)
    const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => [])
    const dirs = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const libDir = path.resolve(root, entry.name, "lib")
      const exists = await fs.promises.access(libDir).then(() => true).catch(() => false)
      if (exists) {
        dirs.push(libDir)
      }
    }

    return dirs
  }

  async ffmpegLibraryFiles(kernel = this.kernel) {
    if (kernel.platform !== "darwin") {
      return []
    }

    const dir = this.libraryDir(kernel)
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => /^lib(?:av|sw)[^.]+(?:\.\d+)*\.dylib$/i.test(name))
      .sort()
  }

  async syncMacUvLibraryShims(ondata) {
    if (this.kernel.platform !== "darwin") {
      return
    }

    const [libraryDirs, libraryFiles] = await Promise.all([
      this.uvLibraryDirs(),
      this.ffmpegLibraryFiles()
    ])

    if (libraryDirs.length === 0 || libraryFiles.length === 0) {
      return
    }

    let createdCount = 0
    let refreshedCount = 0
    const sourceDir = this.libraryDir()

    for (const libDir of libraryDirs) {
      for (const filename of libraryFiles) {
        const source = path.resolve(sourceDir, filename)
        const target = path.resolve(libDir, filename)
        const desiredLink = path.relative(libDir, source)

        let stat
        try {
          stat = await fs.promises.lstat(target)
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            throw error
          }
        }

        if (!stat) {
          await fs.promises.symlink(desiredLink, target)
          createdCount += 1
          continue
        }

        if (!stat.isSymbolicLink()) {
          continue
        }

        const currentLink = await fs.promises.readlink(target)
        if (currentLink === desiredLink) {
          continue
        }

        await fs.promises.unlink(target)
        await fs.promises.symlink(desiredLink, target)
        refreshedCount += 1
      }
    }

    if (ondata && (createdCount > 0 || refreshedCount > 0)) {
      ondata({
        raw: `synced ${createdCount + refreshedCount} FFmpeg dylib shim(s) into uv Python runtime libraries...\r\n`
      })
    }
  }

  async removeMacUvLibraryShims(ondata) {
    if (this.kernel.platform !== "darwin") {
      return
    }

    const [libraryDirs, libraryFiles] = await Promise.all([
      this.uvLibraryDirs(),
      this.ffmpegLibraryFiles()
    ])

    if (libraryDirs.length === 0 || libraryFiles.length === 0) {
      return
    }

    const sourceDir = this.libraryDir()
    let removedCount = 0

    for (const libDir of libraryDirs) {
      for (const filename of libraryFiles) {
        const target = path.resolve(libDir, filename)

        let stat
        try {
          stat = await fs.promises.lstat(target)
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            throw error
          }
        }

        if (!stat || !stat.isSymbolicLink()) {
          continue
        }

        const currentLink = await fs.promises.readlink(target)
        const resolved = path.resolve(libDir, currentLink)
        if (path.dirname(resolved) !== sourceDir) {
          continue
        }

        await fs.promises.unlink(target)
        removedCount += 1
      }
    }

    if (ondata && removedCount > 0) {
      ondata({ raw: `removed ${removedCount} FFmpeg dylib shim(s) from uv Python runtime libraries...\r\n` })
    }
  }

  async selfTest(ondata) {
    if (ondata) {
      ondata({ raw: "verifying ffmpeg installation...\r\n" })
    }

    const ffmpegVersionOutput = await this.execBinary(this.binaryPath("ffmpeg"), ["-version"])
    const ffmpegVersion = semver.coerce(ffmpegVersionOutput)
    if (!ffmpegVersion || !semver.satisfies(ffmpegVersion, RELEASE_RANGE)) {
      throw new Error(`Unexpected ffmpeg version: ${this.firstLine(ffmpegVersionOutput)}`)
    }

    const encoderOutput = await this.execBinary(this.binaryPath("ffmpeg"), ["-hide_banner", "-encoders"])
    if (!/\blibmp3lame\b/i.test(encoderOutput)) {
      throw new Error("FFmpeg was installed without libmp3lame support")
    }

    const ffprobeVersionOutput = await this.execBinary(this.binaryPath("ffprobe"), ["-version"])
    const ffprobeVersion = semver.coerce(ffprobeVersionOutput)
    if (!ffprobeVersion || !semver.satisfies(ffprobeVersion, RELEASE_RANGE)) {
      throw new Error(`Unexpected ffprobe version: ${this.firstLine(ffprobeVersionOutput)}`)
    }

    await this.assertSharedLibraries()
    return true
  }

  async assertSharedLibraries() {
    const dir = this.libraryDir()
    const entries = await fs.promises.readdir(dir).catch(() => {
      throw new Error(`Missing FFmpeg library directory: ${dir}`)
    })

    const patterns = this.sharedLibraryPatterns()
    for (const pattern of patterns) {
      if (!entries.some((name) => pattern.test(name))) {
        throw new Error(`Missing FFmpeg shared library matching ${pattern}`)
      }
    }
  }

  sharedLibraryPatterns() {
    if (this.kernel.platform === "win32") {
      return [
        /^avcodec-\d+\.dll$/i,
        /^avformat-\d+\.dll$/i,
        /^avutil-\d+\.dll$/i,
        /^swresample-\d+\.dll$/i,
        /^swscale-\d+\.dll$/i
      ]
    }

    if (this.kernel.platform === "darwin") {
      return [
        /^libavcodec(\.\d+)*\.dylib$/i,
        /^libavformat(\.\d+)*\.dylib$/i,
        /^libavutil(\.\d+)*\.dylib$/i,
        /^libswresample(\.\d+)*\.dylib$/i,
        /^libswscale(\.\d+)*\.dylib$/i
      ]
    }

    return [
      /^libavcodec\.so(\.\d+)*$/i,
      /^libavformat\.so(\.\d+)*$/i,
      /^libavutil\.so(\.\d+)*$/i,
      /^libswresample\.so(\.\d+)*$/i,
      /^libswscale\.so(\.\d+)*$/i
    ]
  }

  execBinary(file, args) {
    return new Promise((resolve, reject) => {
      execFile(file, args, {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024
      }, (error, stdout, stderr) => {
        const output = `${stdout || ""}${stderr || ""}`
        if (error) {
          reject(new Error(output || error.message))
          return
        }
        resolve(output)
      })
    })
  }

  firstLine(output) {
    return String(output || "").split(/\r?\n/).find(Boolean) || ""
  }
}

module.exports = Ffmpeg
