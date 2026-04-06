const fs = require('fs')
const path = require('path')
const semver = require('semver')

class Bluefairy {
  description = "Installs Bluefairy, a standalone package freshness guard."
  version = ">=0.0.23"

  packageName() {
    return "bluefairy"
  }

  packageSpec() {
    if (process.env.PINOKIO_BLUEFAIRY_PACKAGE) {
      return process.env.PINOKIO_BLUEFAIRY_PACKAGE
    }
    return this.packageName()
  }

  npmBinDir() {
    return this.kernel.platform === "win32"
      ? this.kernel.path("bin/npm")
      : this.kernel.path("bin/npm/bin")
  }

  moduleRoot() {
    return this.kernel.platform === "win32"
      ? this.kernel.path("bin/npm/node_modules")
      : this.kernel.path("bin/npm/lib/node_modules")
  }

  packageJsonPath() {
    return path.resolve(this.moduleRoot(), this.packageName(), "package.json")
  }

  runtimeHome() {
    return this.kernel.bin.path("bluefairy")
  }

  env() {
    return {
      BLUEFAIRY_HOME: this.runtimeHome()
    }
  }

  installedArtifacts() {
    const binDir = this.npmBinDir()
    if (this.kernel.platform === "win32") {
      return [
        path.resolve(binDir, "bluefairy.cmd"),
        path.resolve(binDir, "bluefairy-activate"),
        path.resolve(binDir, "bluefairy-activate.cmd"),
        path.resolve(binDir, "bluefairy-activate.ps1"),
      ]
    }
    return [
      path.resolve(binDir, "bluefairy"),
      path.resolve(binDir, "bluefairy-activate"),
    ]
  }

  runtimeArtifacts() {
    const runtimeHome = this.runtimeHome()
    if (this.kernel.platform === "win32") {
      return [
        path.resolve(runtimeHome, "shims", "npm.cmd"),
        path.resolve(runtimeHome, "shims", "bun.cmd"),
        path.resolve(runtimeHome, "shims", "uv.cmd"),
        path.resolve(runtimeHome, "shims", "uv.exe"),
        path.resolve(runtimeHome, "state", "cli-launcher.mjs"),
        path.resolve(runtimeHome, "state", "shim-launcher.exe"),
      ]
    }
    return [
      path.resolve(runtimeHome, "shims", "npm"),
      path.resolve(runtimeHome, "shims", "bun"),
      path.resolve(runtimeHome, "shims", "uv"),
      path.resolve(runtimeHome, "state", "cli-launcher.mjs"),
    ]
  }

  isInstalledSync() {
    if (!this.installedArtifacts().every((artifact) => fs.existsSync(artifact))) {
      return false
    }
    if (!this.runtimeArtifacts().every((artifact) => fs.existsSync(artifact))) {
      return false
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(this.packageJsonPath(), "utf8"))
      const coerced = semver.coerce(pkg && pkg.version)
      return !!(coerced && semver.satisfies(coerced, this.version))
    } catch (e) {
      return false
    }
  }

  async install(req, ondata) {
    const spec = this.packageSpec().replaceAll('"', '\\"')
    await this.kernel.exec({
      message: `npm install -g "${spec}" --force`,
    }, ondata)
  }

  async installed() {
    return this.isInstalledSync()
  }

  async uninstall(req, ondata) {
    await this.kernel.exec({
      message: `npm uninstall -g ${this.packageName()}`,
    }, ondata)
  }

  activationCommands(shell) {
    if (!this.isInstalledSync()) {
      return []
    }
    if (shell.isCmdShell()) {
      return [`bluefairy-activate.cmd`]
    }
    if (shell.isPowerShell()) {
      return [`& bluefairy-activate.ps1`]
    }
    return [`. bluefairy-activate`]
  }
}

module.exports = Bluefairy
