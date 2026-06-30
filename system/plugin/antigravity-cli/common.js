const fs = require("fs")
const path = require("path")

const MANAGED_DIR_PARTS = ["bin", "antigravity-cli"]

function installDir(kernel) {
  return kernel.path("bin")
}

function managedDir(kernel) {
  return kernel.path(...MANAGED_DIR_PARTS)
}

function binaryPath(kernel, platform) {
  return kernel.path("bin", platform === "win32" ? "agy.exe" : "agy")
}

function currentPlatform(kernel) {
  return kernel.platform
}

function metadataPath(kernel) {
  return path.join(managedDir(kernel), "install.json")
}

function installerPath() {
  return path.join(__dirname, "install.js")
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function promptFor(context) {
  const args = context && context.args ? context.args : {}
  const input = context && context.input ? context.input : {}
  return args.prompt || input.prompt || ""
}

function workspaceFor(context, kernel) {
  const args = context && context.args ? context.args : {}
  return args.cwd || kernel.path("home")
}

function installSteps(kernel) {
  return [{
    id: "install",
    method: "shell.run",
    params: {
      message: {
        _: [
          "node",
          installerPath(),
          "--install-dir",
          installDir(kernel),
          "--managed-dir",
          managedDir(kernel),
        ]
      },
      path: kernel.path(),
      buffer: 1024,
    }
  }]
}

function uninstallSteps(kernel) {
  const dir = installDir(kernel)
  const managed = managedDir(kernel)
  const platform = currentPlatform(kernel)
  const bin = binaryPath(kernel, platform)
  if (platform === "win32") {
    return [{
      id: "uninstall",
      method: "shell.run",
      params: {
        shell: "powershell",
        conda: { skip: true },
        message: `Remove-Item -Force ${powershellQuote(bin)} -ErrorAction SilentlyContinue\nRemove-Item -Recurse -Force ${powershellQuote(managed)} -ErrorAction SilentlyContinue\nWrite-Host "Antigravity CLI removed from ${dir}"`,
        path: kernel.path("bin"),
      }
    }]
  }
  return [{
    id: "uninstall",
    method: "shell.run",
    params: {
      conda: { skip: true },
      message: `rm -f ${shellQuote(bin)}\nrm -rf ${shellQuote(managed)}\necho "Antigravity CLI removed from ${dir}"`,
      path: kernel.path("bin"),
    }
  }]
}

function installed(kernel) {
  return fs.existsSync(binaryPath(kernel, currentPlatform(kernel)))
}

function pluginDetailHref(options = {}) {
  const pluginName = options.auto ? "antigravity-cli-auto" : "antigravity-cli"
  return `/plugin?path=${encodeURIComponent(`/pinokio/run/plugin/${pluginName}/pinokio.js`)}&next=install`
}

function runSteps(kernel, info, context, options = {}) {
  const bin = binaryPath(kernel, currentPlatform(kernel))
  if (!fs.existsSync(bin)) {
    return [{
      method: "notify",
      params: {
        html: "Antigravity CLI is not installed in Pinokio. Open the plugin page and click Install.",
        href: pluginDetailHref(options),
        target: "_parent",
        type: "warning",
      }
    }]
  }

  const message = [bin]
  if (options.auto) {
    message.push("--dangerously-skip-permissions")
  }

  const prompt = promptFor(context)
  if (prompt) {
    message.push("--prompt-interactive", prompt)
  }

  return [{
    id: "run",
    method: "shell.run",
    params: {
      conda: { skip: true },
      message: { _: message },
      path: workspaceFor(context, kernel),
      buffer: 1024,
      input: true,
    }
  }]
}

module.exports = {
  binaryPath,
  installDir,
  installed,
  installerPath,
  installSteps,
  metadataPath,
  pluginDetailHref,
  runSteps,
  uninstallSteps,
}
