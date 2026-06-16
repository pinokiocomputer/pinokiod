const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const crypto = require("crypto")
const https = require("https")
const childProcess = require("child_process")

const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest"

function usage() {
  return "Usage: node install.js --install-dir <path> --managed-dir <path>"
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === "--install-dir") {
      args.installDir = value
      i += 1
    } else if (key === "--managed-dir") {
      args.managedDir = value
      i += 1
    } else {
      throw new Error("Unknown argument: " + key + "\n" + usage())
    }
  }
  if (!args.installDir || !args.managedDir) {
    throw new Error(usage())
  }
  return args
}

function requestBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Pinokio Antigravity CLI installer",
      "Accept": "application/vnd.github+json, application/octet-stream"
    }
    const request = https.get(url, { headers }, (response) => {
      const statusCode = response.statusCode || 0
      const location = response.headers.location
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error("Too many redirects while fetching " + url))
          return
        }
        const nextUrl = new URL(location, url).toString()
        requestBuffer(nextUrl, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (statusCode < 200 || statusCode >= 300) {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          reject(new Error("Request failed " + statusCode + " for " + url + ": " + Buffer.concat(chunks).toString("utf8").slice(0, 300)))
        })
        return
      }
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolve(Buffer.concat(chunks)))
    })
    request.on("error", reject)
    request.setTimeout(120000, () => {
      request.destroy(new Error("Timed out fetching " + url))
    })
  })
}

async function fetchJson(url) {
  const body = await requestBuffer(url)
  return JSON.parse(body.toString("utf8"))
}

async function downloadFile(url, destination) {
  const body = await requestBuffer(url)
  await fsp.writeFile(destination, body)
}

function assetNameForPlatform() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : ""
  if (!arch) {
    throw new Error("Unsupported CPU architecture: " + process.arch)
  }
  if (process.platform === "darwin") return "agy_cli_mac_" + arch + ".tar.gz"
  if (process.platform === "linux") return "agy_cli_linux_" + arch + ".tar.gz"
  if (process.platform === "win32") return "agy_cli_windows_" + arch + ".zip"
  throw new Error("Unsupported OS: " + process.platform)
}

async function readMetadata(metadataPath) {
  try {
    return JSON.parse(await fsp.readFile(metadataPath, "utf8"))
  } catch (_) {
    return null
  }
}

async function sha256File(filepath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filepath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function run(command, args) {
  childProcess.execFileSync(command, args, { stdio: "inherit" })
}

function runQuiet(command, args) {
  childProcess.execFileSync(command, args, { stdio: "ignore" })
}

function powershellLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

async function extractPayload(assetName, payloadPath, extractDir) {
  await fsp.mkdir(extractDir, { recursive: true })
  if (assetName.endsWith(".tar.gz")) {
    run("tar", ["-xzf", payloadPath, "-C", extractDir])
    return
  }
  if (assetName.endsWith(".zip")) {
    try {
      run("tar", ["-xf", payloadPath, "-C", extractDir])
      return
    } catch (tarError) {
      if (process.platform === "win32") {
        run("powershell", [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath " + powershellLiteral(payloadPath) + " -DestinationPath " + powershellLiteral(extractDir) + " -Force"
        ])
        return
      }
      run("unzip", ["-o", payloadPath, "-d", extractDir])
      return
    }
  }
  throw new Error("Unsupported Antigravity CLI release asset: " + assetName)
}

async function findExtractedBinary(root) {
  const names = process.platform === "win32"
    ? new Set(["agy.exe", "antigravity.exe"])
    : new Set(["agy", "antigravity"])
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else if (entry.isFile() && names.has(entry.name.toLowerCase())) {
        return full
      }
    }
  }
  throw new Error("Release asset did not contain an agy binary.")
}

async function writeMetadata(metadataPath, release, asset) {
  const payload = {
    version: release.tag_name || release.name || "",
    asset: asset.name,
    digest: asset.digest || "",
    source: asset.browser_download_url || "",
    release_url: release.html_url || "",
    installed_at: new Date().toISOString()
  }
  await fsp.writeFile(metadataPath, JSON.stringify(payload, null, 2) + "\n", "utf8")
}

async function install(options) {
  const installDir = options.installDir
  const managedDir = options.managedDir
  const binPath = path.join(installDir, process.platform === "win32" ? "agy.exe" : "agy")
  const metadataPath = path.join(managedDir, "install.json")
  const stagingDir = path.join(managedDir, ".staging")

  await fsp.mkdir(installDir, { recursive: true })
  await fsp.mkdir(managedDir, { recursive: true })

  console.log("Fetching latest Antigravity CLI release from GitHub...")
  const release = await fetchJson(GITHUB_LATEST_RELEASE_API)
  const assetName = assetNameForPlatform()
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate && candidate.name === assetName)
    : null
  if (!asset || !asset.browser_download_url) {
    throw new Error("No Antigravity CLI release asset found for " + assetName)
  }
  if (typeof asset.digest !== "string" || !asset.digest.startsWith("sha256:")) {
    throw new Error("GitHub release asset is missing a SHA-256 digest: " + assetName)
  }

  const metadata = await readMetadata(metadataPath)
  if (
    metadata &&
    metadata.version === (release.tag_name || release.name || "") &&
    metadata.asset === asset.name &&
    metadata.digest === asset.digest &&
    fs.existsSync(binPath)
  ) {
    console.log("Antigravity CLI " + metadata.version + " is already installed at " + binPath)
    try {
      run(binPath, ["--version"])
    } catch (_) {
    }
    return
  }

  await fsp.rm(stagingDir, { recursive: true, force: true })
  await fsp.mkdir(stagingDir, { recursive: true })
  const payloadPath = path.join(stagingDir, asset.name)
  const extractDir = path.join(stagingDir, "extract")

  console.log("Downloading " + asset.name + " from GitHub release " + (release.tag_name || release.name || "latest") + "...")
  await downloadFile(asset.browser_download_url, payloadPath)

  const actualDigest = "sha256:" + await sha256File(payloadPath)
  if (actualDigest.toLowerCase() !== asset.digest.toLowerCase()) {
    throw new Error("Checksum mismatch for Antigravity CLI. Expected " + asset.digest + ", got " + actualDigest)
  }
  console.log("Download verified with " + asset.digest)

  await extractPayload(asset.name, payloadPath, extractDir)
  const extractedBinary = await findExtractedBinary(extractDir)
  const nextBinary = binPath + ".next"

  await fsp.rm(nextBinary, { force: true })
  await fsp.copyFile(extractedBinary, nextBinary)
  if (process.platform !== "win32") {
    await fsp.chmod(nextBinary, 0o755)
  }
  await fsp.rename(nextBinary, binPath)
  if (process.platform === "darwin") {
    try {
      runQuiet("xattr", ["-d", "com.apple.quarantine", binPath])
    } catch (_) {
    }
  }

  await writeMetadata(metadataPath, release, asset)
  await fsp.rm(stagingDir, { recursive: true, force: true })
  console.log("Antigravity CLI installed at " + binPath)
  run(binPath, ["--version"])
}

if (require.main === module) {
  install(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error))
    process.exit(1)
  })
}

module.exports = {
  assetNameForPlatform,
  install,
  parseArgs,
}
