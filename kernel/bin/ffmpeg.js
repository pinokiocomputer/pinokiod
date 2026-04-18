const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { execFile } = require("child_process")
const semver = require("semver")
const { rimraf } = require("rimraf")
const decompress = require("decompress")

const RELEASE_VERSION = "8.1"
const RELEASE_RANGE = ">=8.1.0 <8.2.0"

const ARTIFACTS = {
  win32: {
    x64: {
      version: RELEASE_VERSION,
      source: "Gyan Windows essentials build",
      archives: [{
        url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1-essentials_build.zip",
        sha256: "8748283d821613d930b0e7be685aaa9df4ca6f0ad4d0c42fd02622b3623463c6",
        binaries: {
          ffmpeg: "ffmpeg.exe",
          ffprobe: "ffprobe.exe"
        }
      }]
    }
  },
  darwin: {
    x64: {
      version: RELEASE_VERSION,
      source: "Martin Riedl macOS amd64 release",
      archives: [{
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1774556648_8.1/ffmpeg.zip",
        sha256: "eaa8aa619f8eccc7f548a730097f5d299cbf2d418888421c137557344d821130",
        binaries: {
          ffmpeg: "ffmpeg"
        }
      }, {
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1774556648_8.1/ffprobe.zip",
        sha256: "221bd0716dc15daf5745c5503773e5c23264c10c5ea956aa17ef492bbc0b0ac7",
        binaries: {
          ffprobe: "ffprobe"
        }
      }]
    },
    arm64: {
      version: RELEASE_VERSION,
      source: "Martin Riedl macOS arm64 release",
      archives: [{
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1774549676_8.1/ffmpeg.zip",
        sha256: "cc3a7e0cce36c5eca6c17eeb93830984c657637a8e710dc98f19c8051201fa3a",
        binaries: {
          ffmpeg: "ffmpeg"
        }
      }, {
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1774549676_8.1/ffprobe.zip",
        sha256: "fd2e6b7fad9c9aa2bec17c0d7211b5afcc00b4b5c9b63c120985e80c3c198af6",
        binaries: {
          ffprobe: "ffprobe"
        }
      }]
    }
  },
  linux: {
    x64: {
      version: RELEASE_VERSION,
      source: "Martin Riedl Linux amd64 release",
      archives: [{
        url: "https://ffmpeg.martin-riedl.de/download/linux/amd64/1774550169_8.1/ffmpeg.zip",
        sha256: "49f9a3642387626f82fd70dd6a268807efe23e0560d6934a6531d6e3e668f18f",
        binaries: {
          ffmpeg: "ffmpeg"
        }
      }, {
        url: "https://ffmpeg.martin-riedl.de/download/linux/amd64/1774550169_8.1/ffprobe.zip",
        sha256: "422082501af33fabb3946d101d098e5105f44492e5a16357c3fac79421544b0e",
        binaries: {
          ffprobe: "ffprobe"
        }
      }]
    },
    arm64: {
      version: RELEASE_VERSION,
      source: "Martin Riedl Linux arm64 release",
      archives: [{
        url: "https://ffmpeg.martin-riedl.de/download/linux/arm64/1774548896_8.1/ffmpeg.zip",
        sha256: "87000dd625a4f409a5baf71ac177c22210db04ea144e01241713ab196ed39689",
        binaries: {
          ffmpeg: "ffmpeg"
        }
      }, {
        url: "https://ffmpeg.martin-riedl.de/download/linux/arm64/1774548896_8.1/ffprobe.zip",
        sha256: "eb56a190dea6bdd08da2c1e63d7c7523817384eff4dff227f4b088e56205414b",
        binaries: {
          ffprobe: "ffprobe"
        }
      }]
    }
  }
}

class Ffmpeg {
  description = "Installs standalone FFmpeg and FFprobe binaries with MP3 export support."

  artifact() {
    const platform = this.kernel.platform
    const arch = this.kernel.arch
    const spec = ARTIFACTS[platform] && ARTIFACTS[platform][arch]
    if (!spec) {
      throw new Error(`Standalone FFmpeg is not configured for ${platform}/${arch}`)
    }
    return spec
  }

  rootPath() {
    return this.kernel.bin.path("ffmpeg")
  }

  binDir() {
    return this.kernel.bin.path("ffmpeg", "bin")
  }

  tempDir() {
    return this.kernel.bin.path("ffmpeg-tmp")
  }

  manifestPath() {
    return this.kernel.bin.path("ffmpeg", "INSTALL.json")
  }

  binaryFilename(tool) {
    return this.kernel.platform === "win32" ? `${tool}.exe` : tool
  }

  binaryPath(tool) {
    return path.resolve(this.binDir(), this.binaryFilename(tool))
  }

  env() {
    return {
      PATH: [this.binDir()],
      FFMPEG_PATH: this.binaryPath("ffmpeg"),
      FFPROBE_PATH: this.binaryPath("ffprobe")
    }
  }

  hasLegacyCondaFfmpeg() {
    const condaInstalled = this.kernel.bin.installed && this.kernel.bin.installed.conda
    return !!(condaInstalled && condaInstalled.has("ffmpeg"))
  }

  async install(req, ondata) {
    const spec = this.artifact()
    const rootPath = this.rootPath()
    const tempDir = this.tempDir()
    const binDir = this.binDir()
    const downloads = []

    ondata({ raw: `preparing standalone ffmpeg ${spec.version} (${this.kernel.platform}/${this.kernel.arch})...\r\n` })
    await rimraf(tempDir)
    await rimraf(rootPath)

    try {
      await fs.promises.mkdir(tempDir, { recursive: true })
      await fs.promises.mkdir(binDir, { recursive: true })

      for (let index = 0; index < spec.archives.length; index++) {
        const archive = spec.archives[index]
        const filename = `${this.kernel.platform}-${this.kernel.arch}-${index}-${path.basename(new URL(archive.url).pathname)}`
        const archivePath = this.kernel.bin.path(filename)
        const extractDir = path.resolve(tempDir, `archive-${index}`)

        downloads.push(archivePath)
        await this.kernel.bin.download(archive.url, filename, ondata)
        await this.verifyChecksum(archivePath, archive.sha256)

        ondata({ raw: `extracting ${filename}...\r\n` })
        await fs.promises.mkdir(extractDir, { recursive: true })
        await decompress(archivePath, extractDir)

        for (const [tool, expectedName] of Object.entries(archive.binaries)) {
          const source = await this.findFileByName(extractDir, expectedName)
          if (!source) {
            throw new Error(`Could not find ${expectedName} inside ${filename}`)
          }
          const destination = this.binaryPath(tool)
          await fs.promises.copyFile(source, destination)
          if (this.kernel.platform !== "win32") {
            await fs.promises.chmod(destination, 0o755)
          }
        }
      }

      await this.writeManifest(spec)
      await this.selfTest(ondata)
      await this.ensureLegacyCondaFfmpegRemoved(ondata)
      ondata({ raw: `ffmpeg ${spec.version} installed from ${spec.source}\r\n` })
    } catch (error) {
      await rimraf(rootPath)
      throw error
    } finally {
      for (const download of downloads) {
        await fs.promises.rm(download, { force: true }).catch(() => {})
      }
      await rimraf(tempDir)
    }
  }

  async installed() {
    try {
      await fs.promises.access(this.binaryPath("ffmpeg"))
      await fs.promises.access(this.binaryPath("ffprobe"))
      if (this.hasLegacyCondaFfmpeg()) {
        console.log("standalone ffmpeg installed check failed: legacy conda ffmpeg is still present")
        return false
      }
      await this.selfTest()
      return true
    } catch (error) {
      console.log("standalone ffmpeg installed check failed", error && error.message ? error.message : error)
      return false
    }
  }

  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    await rimraf(this.rootPath())
    await rimraf(this.tempDir())
    ondata({ raw: "finished cleaning up\r\n" })
  }

  async selfTest(ondata) {
    if (ondata) {
      ondata({ raw: "verifying ffmpeg binaries...\r\n" })
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

    return true
  }

  async ensureLegacyCondaFfmpegRemoved(ondata) {
    await this.kernel.bin.refreshInstalled()
    if (!this.hasLegacyCondaFfmpeg()) {
      return
    }

    ondata({ raw: "removing legacy conda ffmpeg from the base environment...\r\n" })
    await this.kernel.bin.exec({
      message: "conda remove -y ffmpeg"
    }, ondata)
    await this.kernel.bin.refreshInstalled()
    if (this.hasLegacyCondaFfmpeg()) {
      throw new Error("Legacy conda ffmpeg is still installed in the base environment")
    }
  }

  async verifyChecksum(filePath, expectedHash) {
    const actualHash = await this.sha256(filePath)
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${path.basename(filePath)}: expected ${expectedHash}, got ${actualHash}`)
    }
  }

  async sha256(filePath) {
    const buffer = await fs.promises.readFile(filePath)
    return crypto.createHash("sha256").update(buffer).digest("hex")
  }

  async writeManifest(spec) {
    const manifest = {
      version: spec.version,
      platform: this.kernel.platform,
      arch: this.kernel.arch,
      source: spec.source,
      installed_at: new Date().toISOString(),
      binaries: {
        ffmpeg: this.binaryPath("ffmpeg"),
        ffprobe: this.binaryPath("ffprobe")
      }
    }
    await fs.promises.writeFile(this.manifestPath(), JSON.stringify(manifest, null, 2))
  }

  async findFileByName(root, targetName) {
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.resolve(root, entry.name)
      if (entry.isDirectory()) {
        const found = await this.findFileByName(fullPath, targetName)
        if (found) {
          return found
        }
      } else if (entry.name === targetName) {
        return fullPath
      }
    }
    return null
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
