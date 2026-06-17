"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")

const DEFAULT_PREFERENCES = Object.freeze({
  show_ram: true,
  show_vram: true,
  show_cpu: false
})

class ResourceUsagePreferences {
  constructor(options = {}) {
    this.kernel = options.kernel || null
    this.writeQueue = Promise.resolve()
    this.cache = null
    this.cacheLoadedAt = 0
  }

  getPreferencesPath() {
    if (this.kernel && this.kernel.homedir && typeof this.kernel.path === "function") {
      return this.kernel.path("cache", "resource_usage", "preferences.json")
    }
    const configuredHome = (
      (this.kernel && this.kernel.store && typeof this.kernel.store.get === "function" ? this.kernel.store.get("home") : null)
      || process.env.PINOKIO_HOME
    )
    if (configuredHome) {
      return path.resolve(configuredHome, "cache", "resource_usage", "preferences.json")
    }
    return path.resolve(os.homedir(), "pinokio", "cache", "resource_usage", "preferences.json")
  }

  coerce(value = {}) {
    const source = value && typeof value === "object" ? value : {}
    return {
      show_ram: Object.prototype.hasOwnProperty.call(source, "show_ram") ? Boolean(source.show_ram) : DEFAULT_PREFERENCES.show_ram,
      show_vram: Object.prototype.hasOwnProperty.call(source, "show_vram") ? Boolean(source.show_vram) : DEFAULT_PREFERENCES.show_vram,
      show_cpu: Object.prototype.hasOwnProperty.call(source, "show_cpu") ? Boolean(source.show_cpu) : DEFAULT_PREFERENCES.show_cpu
    }
  }

  async read() {
    if (this.cache && Date.now() - this.cacheLoadedAt < 5000) {
      return this.cache
    }
    try {
      const raw = await fs.promises.readFile(this.getPreferencesPath(), "utf8")
      const parsed = JSON.parse(raw)
      this.cache = this.coerce(parsed && parsed.preferences ? parsed.preferences : parsed)
    } catch (_) {
      this.cache = this.coerce({})
    }
    this.cacheLoadedAt = Date.now()
    return this.cache
  }

  withWriteLock(task) {
    const run = this.writeQueue.then(() => task())
    this.writeQueue = run.catch(() => {})
    return run
  }

  async update(updates = {}) {
    return this.withWriteLock(async () => {
      const current = await this.read()
      const next = this.coerce({ ...current, ...(updates && typeof updates === "object" ? updates : {}) })
      const preferencesPath = this.getPreferencesPath()
      await fs.promises.mkdir(path.dirname(preferencesPath), { recursive: true })
      const payload = {
        updated_at: new Date().toISOString(),
        preferences: next
      }
      const tmpPath = `${preferencesPath}.${process.pid}-${Date.now()}.tmp`
      try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8")
        await fs.promises.rename(tmpPath, preferencesPath)
      } finally {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {})
      }
      this.cache = next
      this.cacheLoadedAt = Date.now()
      return next
    })
  }
}

module.exports = {
  DEFAULT_PREFERENCES,
  ResourceUsagePreferences
}
