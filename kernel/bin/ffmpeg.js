const fs = require("fs")
const path = require("path")
const { execFile } = require("child_process")
const ParcelWatcher = require("@parcel/watcher")
const semver = require("semver")
const { rimraf } = require("rimraf")

const RELEASE_VERSION = "8.0.1"
const RELEASE_RANGE = ">=8.0.1 <8.1.0"
const CONDA_SPEC = `ffmpeg=${RELEASE_VERSION}`

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
    if (activeKernel.platform === "linux") {
      env.LD_LIBRARY_PATH = [this.libraryDir(activeKernel)]
    }
    return env
  }

  binaryPath(tool, kernel = this.kernel) {
    const filename = kernel.platform === "win32" ? `${tool}.exe` : tool
    if (kernel.platform === "win32") {
      return kernel.bin.path("miniconda", "Library", "bin", filename)
    }
    return kernel.bin.path("miniconda", "bin", filename)
  }

  libraryDir(kernel = this.kernel) {
    if (kernel.platform === "win32") {
      return kernel.bin.path("miniconda", "Library", "bin")
    }
    return kernel.bin.path("miniconda", "lib")
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
    if (!this.isInstalledVersion()) {
      return
    }
    await this.syncMacUvLibraryShims()
    await this.startMacUvLibraryWatcher()
  }

  async install(req, ondata) {
    await this.cleanupLegacyStandalone(ondata)
    if (this.kernel.platform === "win32") {
      await this.installWindows(ondata)
    } else {
      await this.installStandard(ondata)
    }
    await this.syncMacUvLibraryShims(ondata)
    await this.selfTest(ondata)
  }

  async installStandard(ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
  }

  async installWindows(ondata) {
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y --download-only -c conda-forge ${this.cmd()}`
      ]
    }, ondata)

    await this.patchWindowsGdkPixbufPostLink(ondata)

    await this.kernel.bin.exec({
      message: `conda install -y --offline -c conda-forge ${this.cmd()}`
    }, ondata)
  }

  async patchWindowsGdkPixbufPostLink(ondata) {
    const pkgsDir = this.kernel.bin.path("miniconda", "pkgs")
    const entries = await fs.promises.readdir(pkgsDir, { withFileTypes: true })
    const packageDirs = entries
      .filter((entry) => entry.isDirectory() && /^gdk-pixbuf-/.test(entry.name))
      .map((entry) => path.resolve(pkgsDir, entry.name))

    if (packageDirs.length === 0) {
      throw new Error("Could not find downloaded gdk-pixbuf package in the Conda cache after --download-only")
    }

    let patchedCount = 0
    for (const packageDir of packageDirs) {
      const scripts = [
        path.resolve(packageDir, "Scripts", ".gdk-pixbuf-post-link.bat"),
        path.resolve(packageDir, "info", "recipe", "post-link.bat")
      ]

      for (const script of scripts) {
        try {
          await fs.promises.access(script)
          await fs.promises.writeFile(script, WINDOWS_GDK_PIXBUF_POST_LINK_NOOP)
          patchedCount += 1
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

    ondata({ raw: `patched ${patchedCount} gdk-pixbuf post-link script(s) in the Conda cache...\r\n` })
  }

  async installed() {
    try {
      if (!this.isInstalledVersion()) {
        return false
      }

      await fs.promises.access(this.binaryPath("ffmpeg"))
      await fs.promises.access(this.binaryPath("ffprobe"))
      await this.syncMacUvLibraryShims()
      await this.startMacUvLibraryWatcher()
      await this.selfTest()
      return true
    } catch (error) {
      console.log("conda ffmpeg installed check failed", error && error.message ? error.message : error)
      return false
    }
  }

  async uninstall(req, ondata) {
    await this.stopMacUvLibraryWatcher()
    await this.removeMacUvLibraryShims(ondata)
    await this.kernel.bin.exec({
      message: "conda remove -y ffmpeg"
    }, ondata)
    await this.cleanupLegacyStandalone(ondata)
  }

  isInstalledVersion() {
    if (!this.kernel.bin.installed?.conda?.has("ffmpeg")) {
      return false
    }
    return this.kernel.bin.installed?.conda_versions?.ffmpeg === RELEASE_VERSION
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
