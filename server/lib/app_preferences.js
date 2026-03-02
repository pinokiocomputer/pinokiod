"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")

const APP_PREFERENCE_SOURCE_KEYS = ["pterm", "ui", "unknown"]
const APP_PREFERENCE_VALID_SOURCES = new Set(APP_PREFERENCE_SOURCE_KEYS)

class AppPreferencesService {
  constructor({ kernel }) {
    if (!kernel) {
      throw new Error("AppPreferencesService requires kernel")
    }
    this.kernel = kernel
    this.writeQueue = Promise.resolve()
  }

  getPreferencesPath() {
    if (this.kernel && this.kernel.homedir && typeof this.kernel.path === "function") {
      return this.kernel.path("cache", "apps", "preferences.json")
    }
    return path.resolve(os.homedir(), "pinokio", "cache", "apps", "preferences.json")
  }

  normalizeAppId(appId = "") {
    if (typeof appId !== "string") {
      return ""
    }
    const trimmed = appId.trim()
    if (!trimmed) {
      return ""
    }
    const normalized = trimmed.replace(/\\/g, "/")
    if (!normalized || normalized.includes("/") || normalized === "." || normalized === "..") {
      return ""
    }
    return normalized
  }

  normalizeLaunchSource(source = "") {
    const normalized = typeof source === "string" ? source.trim().toLowerCase() : ""
    if (!normalized) {
      return "unknown"
    }
    return APP_PREFERENCE_VALID_SOURCES.has(normalized) ? normalized : "unknown"
  }

  parseTimestampMs(value = null) {
    if (value == null) {
      return Date.now()
    }
    if (value instanceof Date) {
      const parsed = value.getTime()
      return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) {
        return Date.now()
      }
      if (value < 1e12) {
        return value * 1000
      }
      return value
    }
    const raw = String(value).trim()
    if (!raw) {
      return Date.now()
    }
    const asNumber = Number(raw)
    if (Number.isFinite(asNumber) && asNumber > 0) {
      if (asNumber < 1e12) {
        return asNumber * 1000
      }
      return asNumber
    }
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()
  }

  normalizeTimestamp(value = null) {
    const parsed = this.parseTimestampMs(value)
    return new Date(parsed).toISOString()
  }

  toCount(value = 0) {
    const parsed = Number.parseInt(String(value == null ? 0 : value), 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0
    }
    return parsed
  }

  toIsoOrNull(value) {
    if (typeof value !== "string") {
      return null
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Date.parse(trimmed)
    if (!Number.isFinite(parsed)) {
      return null
    }
    return new Date(parsed).toISOString()
  }

  coercePreferenceEntry(entry = {}) {
    const sourceCounts = {}
    for (const source of APP_PREFERENCE_SOURCE_KEYS) {
      sourceCounts[`launch_count_${source}`] = this.toCount(entry[`launch_count_${source}`])
    }
    return {
      starred: Boolean(entry && entry.starred),
      starred_at: entry && entry.starred ? this.toIsoOrNull(entry.starred_at) : null,
      last_launch_at: this.toIsoOrNull(entry && entry.last_launch_at),
      last_launch_source: this.normalizeLaunchSource(entry && entry.last_launch_source),
      launch_count_total: this.toCount(entry && entry.launch_count_total),
      ...sourceCounts
    }
  }

  coercePreferences(items) {
    if (!items || typeof items !== "object") {
      return {}
    }
    const next = {}
    for (const [key, value] of Object.entries(items)) {
      const appId = this.normalizeAppId(key)
      if (!appId) {
        continue
      }
      next[appId] = this.coercePreferenceEntry(value)
    }
    return next
  }

  withWriteLock(task) {
    const run = this.writeQueue
      .then(() => task())
      .catch((error) => {
        throw error
      })
    this.writeQueue = run.catch(() => {})
    return run
  }

  async readPreferencesUnsafe() {
    const preferencesPath = this.getPreferencesPath()
    try {
      const raw = await fs.promises.readFile(preferencesPath, "utf8")
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") {
        return { items: {}, exists: false }
      }
      const sourceItems = parsed && parsed.items && typeof parsed.items === "object"
        ? parsed.items
        : parsed
      return {
        items: this.coercePreferences(sourceItems),
        exists: true
      }
    } catch (error) {
      return { items: {}, exists: false }
    }
  }

  async writePreferencesUnsafe(items) {
    const preferencesPath = this.getPreferencesPath()
    const payload = {
      updated_at: new Date().toISOString(),
      items: this.coercePreferences(items)
    }
    await fs.promises.mkdir(path.dirname(preferencesPath), { recursive: true })
    const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const tmpPath = `${preferencesPath}.${uniqueSuffix}.tmp`
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8")
      await fs.promises.rename(tmpPath, preferencesPath)
    } finally {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {})
    }
    return payload
  }

  async readPreferences() {
    const registry = await this.readPreferencesUnsafe()
    return registry.items
  }

  async readPreferenceMap() {
    const items = await this.readPreferences()
    return new Map(Object.entries(items))
  }

  async getPreference(appId = "") {
    const normalizedAppId = this.normalizeAppId(appId)
    if (!normalizedAppId) {
      return null
    }
    const items = await this.readPreferences()
    return items[normalizedAppId] || null
  }

  async setStar(appId = "", starred = false) {
    const normalizedAppId = this.normalizeAppId(appId)
    if (!normalizedAppId) {
      return null
    }
    const shouldStar = Boolean(starred)
    return this.withWriteLock(async () => {
      const registry = await this.readPreferencesUnsafe()
      const items = { ...registry.items }
      const current = this.coercePreferenceEntry(items[normalizedAppId] || {})
      const next = {
        ...current,
        starred: shouldStar,
        starred_at: shouldStar ? (current.starred_at || this.normalizeTimestamp()) : null
      }
      items[normalizedAppId] = next
      await this.writePreferencesUnsafe(items)
      return next
    })
  }

  isPathWithin(parentPath, childPath) {
    if (!parentPath || !childPath) {
      return false
    }
    const relative = path.relative(parentPath, childPath)
    if (!relative) {
      return true
    }
    return !relative.startsWith("..") && !path.isAbsolute(relative)
  }

  resolveAppIdFromPath(scriptPath = "") {
    if (typeof scriptPath !== "string") {
      return ""
    }
    const trimmed = scriptPath.trim()
    if (!trimmed) {
      return ""
    }
    let absolutePath = trimmed
    if (!path.isAbsolute(absolutePath)) {
      if (absolutePath.startsWith("~") && this.kernel && this.kernel.api && typeof this.kernel.api.filePath === "function") {
        absolutePath = this.kernel.api.filePath(absolutePath)
      } else {
        absolutePath = path.resolve(absolutePath)
      }
    }
    if (!path.isAbsolute(absolutePath)) {
      return ""
    }
    if (!this.kernel || !this.kernel.homedir || typeof this.kernel.path !== "function") {
      return ""
    }
    const apiRoot = this.kernel.path("api")
    if (!this.isPathWithin(apiRoot, absolutePath)) {
      return ""
    }
    const relative = path.relative(apiRoot, absolutePath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return ""
    }
    const appId = relative.split(path.sep)[0]
    return this.normalizeAppId(appId)
  }

  async recordLaunchByAppId(appId = "", options = {}) {
    const normalizedAppId = this.normalizeAppId(appId)
    if (!normalizedAppId) {
      return { updated: false }
    }
    const source = this.normalizeLaunchSource(options && options.source)
    const launchedAt = this.normalizeTimestamp(options && options.timestamp)
    return this.withWriteLock(async () => {
      const registry = await this.readPreferencesUnsafe()
      const items = { ...registry.items }
      const current = this.coercePreferenceEntry(items[normalizedAppId] || {})
      const next = {
        ...current,
        last_launch_at: launchedAt,
        last_launch_source: source,
        launch_count_total: current.launch_count_total + 1,
        [`launch_count_${source}`]: this.toCount(current[`launch_count_${source}`]) + 1
      }
      items[normalizedAppId] = next
      await this.writePreferencesUnsafe(items)
      return {
        updated: true,
        app_id: normalizedAppId,
        preference: next
      }
    })
  }

  async recordLaunchByPath(scriptPath = "", options = {}) {
    const appId = this.resolveAppIdFromPath(scriptPath)
    if (!appId) {
      return { updated: false, app_id: "" }
    }
    const result = await this.recordLaunchByAppId(appId, options)
    return {
      ...result,
      app_id: appId
    }
  }
}

module.exports = AppPreferencesService
