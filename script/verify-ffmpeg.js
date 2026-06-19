#!/usr/bin/env node

const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const Kernel = require("../kernel")

function parseArgs(argv) {
  const options = {
    home: process.env.PINOKIO_HOME || path.resolve(process.cwd(), ".pinokio"),
    reinstall: false,
    skipInstall: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--home" && argv[i + 1]) {
      options.home = path.resolve(argv[i + 1])
      i += 1
    } else if (arg === "--reinstall") {
      options.reinstall = true
    } else if (arg === "--skip-install") {
      options.skipInstall = true
    } else if (arg === "--help" || arg === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function usage() {
  return [
    "Usage: node script/verify-ffmpeg.js [--home <PINOKIO_HOME>] [--reinstall] [--skip-install]",
    "",
    "--reinstall   remove and reinstall FFmpeg before verification",
    "--skip-install only verify the current install state",
  ].join("\n")
}

function logOnData(event) {
  if (!event) {
    return
  }
  if (typeof event.raw === "string") {
    process.stdout.write(event.raw)
    return
  }
  if (typeof event.html === "string") {
    process.stdout.write(`${event.html.replace(/<[^>]+>/g, "")}\n`)
  }
}

function mergeEnv(baseEnv, overlay) {
  const env = { ...baseEnv }
  for (const [key, value] of Object.entries(overlay || {})) {
    if (Array.isArray(value)) {
      const prefix = value.filter(Boolean).join(path.delimiter)
      if (prefix.length === 0) {
        continue
      }
      env[key] = env[key] ? `${prefix}${path.delimiter}${env[key]}` : prefix
    } else if (value === undefined || value === null) {
      delete env[key]
    } else {
      env[key] = String(value)
    }
  }
  return env
}

function normalizePathForCompare(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase()
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function exists(target) {
  try {
    await fs.promises.access(target)
    return true
  } catch (error) {
    return false
  }
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString()
      stdout += text
      if (options.stream) {
        process.stdout.write(text)
      }
    })
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (options.stream) {
        process.stderr.write(text)
      }
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code })
      } else {
        reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stdout}${stderr}`))
      }
    })
  })
}

function prefixedValue(output, prefix) {
  const line = String(output || "").split(/\r?\n/).find((entry) => entry.startsWith(prefix))
  if (!line) {
    return ""
  }
  return line.slice(prefix.length)
}

function sectionValues(output, beginMarker, endMarker) {
  const lines = String(output || "").split(/\r?\n/)
  const begin = lines.findIndex((line) => line.trim() === beginMarker)
  const end = lines.findIndex((line, index) => index > begin && line.trim() === endMarker)
  if (begin === -1 || end === -1 || end <= begin) {
    return []
  }
  return lines.slice(begin + 1, end).map((line) => line.trim()).filter(Boolean)
}

async function verifyHookFiles(ffmpeg) {
  const hookFiles = ffmpeg.activationHookFiles()
  for (const file of hookFiles) {
    assert(await exists(file.path), `Missing activation hook: ${file.path}`)
  }
}

async function verifyWindowsPatchedCache(ffmpeg) {
  if (ffmpeg.kernel.platform !== "win32") {
    return
  }

  const pkgsDir = ffmpeg.ffmpegPkgsDir()
  const entries = await fs.promises.readdir(pkgsDir, { withFileTypes: true })
  const packageDirs = entries
    .filter((entry) => entry.isDirectory() && /^gdk-pixbuf-/.test(entry.name))
    .map((entry) => path.resolve(pkgsDir, entry.name))

  assert(packageDirs.length > 0, `No gdk-pixbuf package found under ${pkgsDir}`)

  for (const packageDir of packageDirs) {
    const scriptPath = path.resolve(packageDir, "Scripts", ".gdk-pixbuf-post-link.bat")
    assert(await exists(scriptPath), `Missing patched gdk-pixbuf script: ${scriptPath}`)

    const contents = await fs.promises.readFile(scriptPath)
    assert(
      contents.toString("utf8").includes("Pinokio intentionally skips gdk-pixbuf loader cache generation"),
      `Unexpected gdk-pixbuf post-link contents in ${scriptPath}`
    )

    const pathsJsonPath = path.resolve(packageDir, "info", "paths.json")
    const pathsJson = JSON.parse(await fs.promises.readFile(pathsJsonPath, "utf8"))
    const entry = Array.isArray(pathsJson.paths)
      ? pathsJson.paths.find((item) => item && item._path === "Scripts/.gdk-pixbuf-post-link.bat")
      : null

    assert(entry, `Missing paths.json entry for patched gdk-pixbuf script in ${pathsJsonPath}`)
    assert(entry.size_in_bytes === contents.length, `paths.json size mismatch for ${scriptPath}`)

    const sha256 = crypto.createHash("sha256").update(contents).digest("hex")
    assert(entry.sha256 === sha256, `paths.json sha256 mismatch for ${scriptPath}`)
  }
}

async function verifyPosixRuntime(ffmpeg, condaEnv) {
  const shell = "/bin/bash"
  const env = mergeEnv(process.env, condaEnv)
  const expectedFfmpeg = ffmpeg.binaryPath("ffmpeg")
  const expectedFfprobe = ffmpeg.binaryPath("ffprobe")
  const expectedBinDir = path.dirname(expectedFfmpeg)
  const expectedLibDir = ffmpeg.libraryDir()

  const command = [
    "set -e",
    'eval "$(conda shell.bash hook)"',
    "conda deactivate || true",
    "conda deactivate || true",
    "conda deactivate || true",
    "conda activate base",
    'printf "__FFMPEG__%s\\n" "$(command -v ffmpeg)"',
    'printf "__FFPROBE__%s\\n" "$(command -v ffprobe)"',
    'printf "__FFMPEG_PATH__%s\\n" "${FFMPEG_PATH-}"',
    'printf "__FFPROBE_PATH__%s\\n" "${FFPROBE_PATH-}"',
    'printf "__PATH__%s\\n" "$PATH"',
    ffmpeg.kernel.platform === "linux"
      ? 'printf "__LD_LIBRARY_PATH__%s\\n" "${LD_LIBRARY_PATH-}"'
      : 'printf "__LD_LIBRARY_PATH__%s\\n" "${LD_LIBRARY_PATH-}"',
    "ffmpeg -hide_banner -version | head -n 1",
    "ffprobe -hide_banner -version | head -n 1",
    "ffmpeg -hide_banner -encoders | grep -q libmp3lame",
  ].join(" && ")

  const { stdout } = await runCommand(shell, ["-lc", command], { env, stream: true })
  const ffmpegResolved = prefixedValue(stdout, "__FFMPEG__")
  const ffprobeResolved = prefixedValue(stdout, "__FFPROBE__")
  const ffmpegPathEnv = prefixedValue(stdout, "__FFMPEG_PATH__")
  const ffprobePathEnv = prefixedValue(stdout, "__FFPROBE_PATH__")
  const shellPath = prefixedValue(stdout, "__PATH__")
  const ldLibraryPath = prefixedValue(stdout, "__LD_LIBRARY_PATH__")

  assert(
    normalizePathForCompare(ffmpegResolved) === normalizePathForCompare(expectedFfmpeg),
    `bash resolved ffmpeg to ${ffmpegResolved}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobeResolved) === normalizePathForCompare(expectedFfprobe),
    `bash resolved ffprobe to ${ffprobeResolved}, expected ${expectedFfprobe}`
  )
  assert(
    normalizePathForCompare(ffmpegPathEnv) === normalizePathForCompare(expectedFfmpeg),
    `FFMPEG_PATH was ${ffmpegPathEnv}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobePathEnv) === normalizePathForCompare(expectedFfprobe),
    `FFPROBE_PATH was ${ffprobePathEnv}, expected ${expectedFfprobe}`
  )
  assert(
    shellPath.split(":").map((entry) => normalizePathForCompare(entry))[0] === normalizePathForCompare(expectedBinDir),
    `PATH does not start with FFmpeg bin dir: ${expectedBinDir}`
  )
  if (ffmpeg.kernel.platform === "linux") {
    assert(
      ldLibraryPath.split(":").map((entry) => normalizePathForCompare(entry))[0] === normalizePathForCompare(expectedLibDir),
      `LD_LIBRARY_PATH does not start with FFmpeg lib dir: ${expectedLibDir}`
    )
  }
}

async function verifyWindowsCmdRuntime(ffmpeg, condaEnv) {
  const env = mergeEnv(process.env, condaEnv)
  const expectedFfmpeg = ffmpeg.binaryPath("ffmpeg")
  const expectedFfprobe = ffmpeg.binaryPath("ffprobe")
  const expectedRuntimeDir = ffmpeg.libraryDir()

  const command = [
    "conda_hook",
    "conda deactivate",
    "conda deactivate",
    "conda deactivate",
    [
      "conda activate base",
      "echo __FFMPEG_PATH__%FFMPEG_PATH%",
      "echo __FFPROBE_PATH__%FFPROBE_PATH%",
      "echo __PATH__%PATH%",
      "echo __FFMPEG_BEGIN__",
      "where ffmpeg",
      "echo __FFMPEG_END__",
      "echo __FFPROBE_BEGIN__",
      "where ffprobe",
      "echo __FFPROBE_END__",
      "ffmpeg -hide_banner -version",
      "ffprobe -hide_banner -version",
      'ffmpeg -hide_banner -encoders | findstr /C:"libmp3lame"',
    ].join(" && "),
  ].join(" & ")

  const shell = process.env.ComSpec || "cmd.exe"
  const { stdout } = await runCommand(shell, ["/d", "/s", "/c", command], { env, stream: true })

  const ffmpegPathEnv = prefixedValue(stdout, "__FFMPEG_PATH__")
  const ffprobePathEnv = prefixedValue(stdout, "__FFPROBE_PATH__")
  const shellPath = prefixedValue(stdout, "__PATH__")
  const ffmpegResolved = sectionValues(stdout, "__FFMPEG_BEGIN__", "__FFMPEG_END__")[0]
  const ffprobeResolved = sectionValues(stdout, "__FFPROBE_BEGIN__", "__FFPROBE_END__")[0]

  assert(
    normalizePathForCompare(ffmpegResolved) === normalizePathForCompare(expectedFfmpeg),
    `cmd resolved ffmpeg to ${ffmpegResolved}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobeResolved) === normalizePathForCompare(expectedFfprobe),
    `cmd resolved ffprobe to ${ffprobeResolved}, expected ${expectedFfprobe}`
  )
  assert(
    normalizePathForCompare(ffmpegPathEnv) === normalizePathForCompare(expectedFfmpeg),
    `FFMPEG_PATH was ${ffmpegPathEnv}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobePathEnv) === normalizePathForCompare(expectedFfprobe),
    `FFPROBE_PATH was ${ffprobePathEnv}, expected ${expectedFfprobe}`
  )
  assert(
    shellPath.split(";").map((entry) => normalizePathForCompare(entry))[0] === normalizePathForCompare(expectedRuntimeDir),
    `PATH does not start with FFmpeg runtime dir: ${expectedRuntimeDir}`
  )
}

async function verifyWindowsPowerShellRuntime(ffmpeg, condaEnv) {
  const env = mergeEnv(process.env, condaEnv)
  const expectedFfmpeg = ffmpeg.binaryPath("ffmpeg")
  const expectedFfprobe = ffmpeg.binaryPath("ffprobe")
  const expectedRuntimeDir = ffmpeg.libraryDir()

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "conda_hook",
    "conda deactivate",
    "conda deactivate",
    "conda deactivate",
    "conda activate base",
    'Write-Output ("__FFMPEG_PATH__" + $Env:FFMPEG_PATH)',
    'Write-Output ("__FFPROBE_PATH__" + $Env:FFPROBE_PATH)',
    'Write-Output ("__PATH__" + $Env:Path)',
    'Write-Output ("__FFMPEG__" + (Get-Command ffmpeg).Source)',
    'Write-Output ("__FFPROBE__" + (Get-Command ffprobe).Source)',
    "ffmpeg -hide_banner -version | Select-Object -First 1",
    "ffprobe -hide_banner -version | Select-Object -First 1",
    "if (-not (ffmpeg -hide_banner -encoders | Select-String -SimpleMatch 'libmp3lame')) { exit 1 }",
  ].join("; ")

  const shell = process.env.SystemRoot
    ? path.resolve(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe"
  const { stdout } = await runCommand(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { env, stream: true })

  const ffmpegResolved = prefixedValue(stdout, "__FFMPEG__")
  const ffprobeResolved = prefixedValue(stdout, "__FFPROBE__")
  const ffmpegPathEnv = prefixedValue(stdout, "__FFMPEG_PATH__")
  const ffprobePathEnv = prefixedValue(stdout, "__FFPROBE_PATH__")
  const shellPath = prefixedValue(stdout, "__PATH__")

  assert(
    normalizePathForCompare(ffmpegResolved) === normalizePathForCompare(expectedFfmpeg),
    `PowerShell resolved ffmpeg to ${ffmpegResolved}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobeResolved) === normalizePathForCompare(expectedFfprobe),
    `PowerShell resolved ffprobe to ${ffprobeResolved}, expected ${expectedFfprobe}`
  )
  assert(
    normalizePathForCompare(ffmpegPathEnv) === normalizePathForCompare(expectedFfmpeg),
    `PowerShell FFMPEG_PATH was ${ffmpegPathEnv}, expected ${expectedFfmpeg}`
  )
  assert(
    normalizePathForCompare(ffprobePathEnv) === normalizePathForCompare(expectedFfprobe),
    `PowerShell FFPROBE_PATH was ${ffprobePathEnv}, expected ${expectedFfprobe}`
  )
  assert(
    shellPath.split(";").map((entry) => normalizePathForCompare(entry))[0] === normalizePathForCompare(expectedRuntimeDir),
    `PowerShell PATH does not start with FFmpeg runtime dir: ${expectedRuntimeDir}`
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  process.env.PINOKIO_HOME = options.home
  console.log(`[verify-ffmpeg] home=${options.home}`)
  console.log(`[verify-ffmpeg] platform=${os.platform()} arch=${os.arch()}`)

  const kernel = new Kernel({ store: {} })
  await kernel.init({})
  await kernel.shell.init()
  await kernel.bin.init()
  await kernel.bin.refreshInstalled()

  if (kernel.refresh_interval) {
    clearInterval(kernel.refresh_interval)
  }
  kernel.server_running = true

  const conda = kernel.bin.mod("conda")
  const ffmpeg = kernel.bin.mod("ffmpeg")

  assert(conda, "Conda module was not initialized")
  assert(ffmpeg, "FFmpeg module was not initialized")

  if (!kernel.bin.installed.conda || !(await conda.installed())) {
    console.log("[verify-ffmpeg] installing conda")
    await kernel.bin.install({
      params: [
        {
          name: "conda",
          dependencies: [],
        }
      ]
    }, logOnData)
    await kernel.bin.refreshInstalled()
  }

  if (!options.skipInstall) {
    const ffmpegInstalled = await ffmpeg.installed()
    if (options.reinstall && ffmpegInstalled) {
      console.log("[verify-ffmpeg] reinstall requested, removing existing ffmpeg")
      await ffmpeg.uninstall({}, logOnData)
      await kernel.bin.refreshInstalled()
    }
    if (options.reinstall || !(await ffmpeg.installed())) {
      console.log("[verify-ffmpeg] installing ffmpeg")
      await kernel.bin.install({
        params: [
          {
            name: "ffmpeg",
          }
        ]
      }, logOnData)
      await kernel.bin.refreshInstalled()
    }
  }

  assert(await ffmpeg.installed(), "FFmpeg module did not report installed after setup")
  await ffmpeg.selfTest(logOnData)
  await verifyHookFiles(ffmpeg)
  await verifyWindowsPatchedCache(ffmpeg)

  const condaEnv = conda.env()
  if (kernel.platform === "win32") {
    console.log("[verify-ffmpeg] verifying cmd.exe runtime")
    await verifyWindowsCmdRuntime(ffmpeg, condaEnv)
    console.log("[verify-ffmpeg] verifying PowerShell runtime")
    await verifyWindowsPowerShellRuntime(ffmpeg, condaEnv)
  } else {
    console.log("[verify-ffmpeg] verifying bash runtime")
    await verifyPosixRuntime(ffmpeg, condaEnv)
  }

  console.log("[verify-ffmpeg] all checks passed")
}

main().catch((error) => {
  console.error("[verify-ffmpeg] failed")
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
