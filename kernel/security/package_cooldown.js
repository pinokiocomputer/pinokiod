const path = require("path")

const DEFAULT_COOLDOWN = "72h"
const OFF_VALUES = new Set(["0", "false", "off", "none", "disable", "disabled"])
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i

class PackageCooldown {
  constructor(kernel) {
    this.kernel = kernel
    this.warned = new Set()
  }

  apply(env, params) {
    if (!env || !this.isAppShell(params)) {
      return
    }

    const explicitNpmBefore = this.getExplicitNpmBefore(env)
    const explicitUvExcludeNewer = this.readEnvValue(env, "UV_EXCLUDE_NEWER")
    const cooldown = this.resolveCooldown(env)

    if (!cooldown) {
      return
    }

    const cutoff = new Date(Date.now() - cooldown.ms).toISOString()

    if (explicitNpmBefore) {
      this.mirrorNpmBefore(env, explicitNpmBefore)
    } else {
      env.NPM_CONFIG_BEFORE = cutoff
      env.npm_config_before = cutoff
    }

    if (!explicitUvExcludeNewer) {
      env.UV_EXCLUDE_NEWER = cutoff
    }
  }

  isAppShell(params) {
    const targetPath = (params && params.$parent && params.$parent.path)
      ? params.$parent.path
      : (params && params.path ? params.path : null)

    if (!targetPath) {
      return false
    }

    const resolvedTarget = path.resolve(targetPath)
    const apiRoot = path.resolve(this.kernel.path("api"))
    return resolvedTarget === apiRoot || resolvedTarget.startsWith(`${apiRoot}${path.sep}`)
  }

  resolveCooldown(env) {
    const configured = this.readEnvValue(env, "PINOKIO_PACKAGE_COOLDOWN")

    if (!configured) {
      return this.parseDuration(DEFAULT_COOLDOWN)
    }

    const normalized = configured.toLowerCase()
    if (OFF_VALUES.has(normalized)) {
      return null
    }

    const parsed = this.parseDuration(configured)
    if (parsed) {
      return parsed
    }

    this.warnOnce(
      `invalid:${configured}`,
      `[package_cooldown] Invalid PINOKIO_PACKAGE_COOLDOWN="${configured}". Falling back to ${DEFAULT_COOLDOWN}.`
    )
    return this.parseDuration(DEFAULT_COOLDOWN)
  }

  parseDuration(value) {
    if (typeof value !== "string") {
      return null
    }

    const trimmed = value.trim()
    const match = DURATION_RE.exec(trimmed)
    if (!match) {
      return null
    }

    const amount = Number(match[1])
    if (!Number.isFinite(amount) || amount <= 0) {
      return null
    }

    const unit = match[2].toLowerCase()
    let multiplier
    if (unit.startsWith("h")) {
      multiplier = 60 * 60 * 1000
    } else if (unit.startsWith("d")) {
      multiplier = 24 * 60 * 60 * 1000
    } else {
      multiplier = 7 * 24 * 60 * 60 * 1000
    }

    return {
      raw: trimmed,
      ms: Math.round(amount * multiplier),
    }
  }

  getExplicitNpmBefore(env) {
    const upper = this.readEnvValue(env, "NPM_CONFIG_BEFORE")
    const lower = this.readEnvValue(env, "npm_config_before")

    if (upper && lower) {
      return upper
    }
    if (upper) {
      return upper
    }
    if (lower) {
      return lower
    }
    return null
  }

  mirrorNpmBefore(env, value) {
    if (!this.readEnvValue(env, "NPM_CONFIG_BEFORE")) {
      env.NPM_CONFIG_BEFORE = value
    }
    if (!this.readEnvValue(env, "npm_config_before")) {
      env.npm_config_before = value
    }
  }

  readEnvValue(env, key) {
    const value = env[key]
    if (value == null) {
      return null
    }
    const trimmed = String(value).trim()
    return trimmed.length > 0 ? trimmed : null
  }

  warnOnce(key, message) {
    if (this.warned.has(key)) {
      return
    }
    this.warned.add(key)
    console.warn(message)
  }
}

module.exports = PackageCooldown
