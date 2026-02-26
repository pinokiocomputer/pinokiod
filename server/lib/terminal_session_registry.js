"use strict"

const createTerminalSessionRegistry = ({ kernel, fs, path, os, parseSessionTimestamp }) => {
  let terminalSessionRegistryBootScrubbed = false
  let terminalSessionRegistryBootScrubPromise = null

  const getTerminalSessionRegistryPath = () => {
    if (kernel && typeof kernel.path === "function") {
      return kernel.path("cache", "terminals", "sessions.json")
    }
    return path.resolve(os.homedir(), "pinokio", "cache", "terminals", "sessions.json")
  }

  const coerceTerminalRegistryItems = (items) => {
    if (!Array.isArray(items)) {
      return []
    }
    return items.filter((entry) => entry && typeof entry === "object")
  }

  const readTerminalSessionRegistry = async () => {
    const registryPath = getTerminalSessionRegistryPath()
    try {
      const raw = await fs.promises.readFile(registryPath, "utf8")
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") {
        return { items: [], exists: false }
      }
      return {
        items: coerceTerminalRegistryItems(parsed.items),
        exists: true
      }
    } catch (error) {
      return { items: [], exists: false }
    }
  }

  const writeTerminalSessionRegistry = async (items) => {
    const registryPath = getTerminalSessionRegistryPath()
    const normalizedItems = coerceTerminalRegistryItems(items)
    const payload = {
      updated_at: new Date().toISOString(),
      items: normalizedItems
    }
    await fs.promises.mkdir(path.dirname(registryPath), { recursive: true })
    const tmpPath = `${registryPath}.tmp`
    await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8")
    await fs.promises.rename(tmpPath, registryPath)
    return payload
  }

  const normalizeTerminalRegistryStateBool = (value) => {
    if (value === true || value === 1) {
      return true
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()
      return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "online" || normalized === "running"
    }
    return false
  }

  const normalizeTerminalRegistryIdentity = (value) => {
    return typeof value === "string" ? value.trim() : ""
  }

  const updateTerminalSessionRegistryState = async ({ terminal_id = "", online = false } = {}) => {
    const normalizedTerminalId = normalizeTerminalRegistryIdentity(terminal_id)
    if (!normalizedTerminalId) {
      return { matched: false, updated: false }
    }
    const nextOnline = Boolean(online)
    const registry = await readTerminalSessionRegistry()
    const existingItems = coerceTerminalRegistryItems(registry.items)
    let matched = false
    let changed = false
    const updatedItems = existingItems.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry
      }
      const entryTerminalId = normalizeTerminalRegistryIdentity(entry.terminal_id)
      const isTarget = Boolean(entryTerminalId && entryTerminalId === normalizedTerminalId)
      if (!isTarget) {
        return entry
      }
      matched = true
      const currentOnline = normalizeTerminalRegistryStateBool(entry.online)
      if (currentOnline === nextOnline) {
        return entry
      }
      changed = true
      return {
        ...entry,
        online: nextOnline
      }
    })
    if (changed) {
      await writeTerminalSessionRegistry(updatedItems)
    }
    return {
      matched,
      updated: changed
    }
  }

  const updateTerminalSessionRegistrySummary = async ({ terminal_id = "", summary = "", timestamp = "" } = {}) => {
    const normalizedTerminalId = normalizeTerminalRegistryIdentity(terminal_id)
    const normalizedSummary = typeof summary === "string" ? summary.trim() : ""
    if (!normalizedTerminalId || !normalizedSummary) {
      return { matched: false, updated: false }
    }
    const parsedTimestamp = parseSessionTimestamp(timestamp)
    const resolvedTimestamp = parsedTimestamp > 0 ? new Date(parsedTimestamp).toISOString() : new Date().toISOString()
    const registry = await readTerminalSessionRegistry()
    const existingItems = coerceTerminalRegistryItems(registry.items)
    let matched = false
    let changed = false
    const updatedItems = existingItems.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry
      }
      const entryTerminalId = normalizeTerminalRegistryIdentity(entry.terminal_id)
      if (!entryTerminalId || entryTerminalId !== normalizedTerminalId) {
        return entry
      }
      matched = true
      const currentSummary = typeof entry.summary === "string" ? entry.summary : ""
      const currentTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : ""
      if (currentSummary === normalizedSummary && currentTimestamp === resolvedTimestamp) {
        return entry
      }
      changed = true
      return {
        ...entry,
        summary: normalizedSummary,
        timestamp: resolvedTimestamp
      }
    })
    if (changed) {
      await writeTerminalSessionRegistry(updatedItems)
    }
    return {
      matched,
      updated: changed,
      timestamp: resolvedTimestamp
    }
  }

  const scrubTerminalSessionRegistryOnlineStateAtBoot = async () => {
    if (terminalSessionRegistryBootScrubbed) {
      return
    }
    if (!terminalSessionRegistryBootScrubPromise) {
      terminalSessionRegistryBootScrubPromise = (async () => {
        const registry = await readTerminalSessionRegistry()
        if (!registry.exists || !Array.isArray(registry.items) || registry.items.length === 0) {
          terminalSessionRegistryBootScrubbed = true
          return
        }
        let changed = false
        const scrubbedItems = registry.items.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return entry
          }
          const onlineValue = entry.online
          const isOnline = onlineValue === true
            || onlineValue === 1
            || onlineValue === "1"
            || onlineValue === "true"
          if (!isOnline) {
            return entry
          }
          changed = true
          return {
            ...entry,
            online: false
          }
        })
        if (changed) {
          await writeTerminalSessionRegistry(scrubbedItems)
        }
        terminalSessionRegistryBootScrubbed = true
      })().finally(() => {
        terminalSessionRegistryBootScrubPromise = null
      })
    }
    return terminalSessionRegistryBootScrubPromise
  }

  return {
    coerceTerminalRegistryItems,
    readTerminalSessionRegistry,
    writeTerminalSessionRegistry,
    normalizeTerminalRegistryStateBool,
    normalizeTerminalRegistryIdentity,
    updateTerminalSessionRegistryState,
    updateTerminalSessionRegistrySummary,
    scrubTerminalSessionRegistryOnlineStateAtBoot
  }
}

module.exports = {
  createTerminalSessionRegistry
}
