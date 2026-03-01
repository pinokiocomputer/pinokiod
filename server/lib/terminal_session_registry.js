"use strict"

const createTerminalSessionRegistry = ({ kernel, fs, path, os, parseSessionTimestamp }) => {
  let registryWriteQueue = Promise.resolve()

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

  const withRegistryWriteLock = async (task) => {
    const run = registryWriteQueue
      .then(() => task())
      .catch((error) => {
        throw error
      })
    registryWriteQueue = run.catch(() => {})
    return run
  }

  const readTerminalSessionRegistryUnsafe = async () => {
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

  const readTerminalSessionRegistry = async () => {
    return readTerminalSessionRegistryUnsafe()
  }

  const writeTerminalSessionRegistryUnsafe = async (items) => {
    const registryPath = getTerminalSessionRegistryPath()
    const normalizedItems = coerceTerminalRegistryItems(items)
    const payload = {
      updated_at: new Date().toISOString(),
      items: normalizedItems
    }
    await fs.promises.mkdir(path.dirname(registryPath), { recursive: true })
    const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const tmpPath = `${registryPath}.${uniqueSuffix}.tmp`
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8")
      await fs.promises.rename(tmpPath, registryPath)
    } finally {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {})
    }
    return payload
  }

  const writeTerminalSessionRegistry = async (items) => {
    return withRegistryWriteLock(async () => writeTerminalSessionRegistryUnsafe(items))
  }

  const normalizeTerminalRegistryIdentity = (value) => {
    return typeof value === "string" ? value.trim() : ""
  }

  const updateTerminalSessionRegistrySummary = async ({ terminal_id = "", summary = "", name = "", timestamp = "" } = {}) => {
    const normalizedTerminalId = normalizeTerminalRegistryIdentity(terminal_id)
    const normalizedSummary = typeof summary === "string" ? summary.trim() : ""
    const normalizedNameInput = typeof name === "string" ? name.trim() : ""
    const resolvedName = normalizedNameInput || normalizedSummary
    if (!normalizedTerminalId || !normalizedSummary) {
      return { matched: false, updated: false }
    }
    return withRegistryWriteLock(async () => {
      const parsedTimestamp = parseSessionTimestamp(timestamp)
      const resolvedTimestamp = parsedTimestamp > 0 ? new Date(parsedTimestamp).toISOString() : new Date().toISOString()
      const registry = await readTerminalSessionRegistryUnsafe()
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
        const currentName = typeof entry.name === "string" ? entry.name : ""
        const currentTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : ""
        if (currentSummary === normalizedSummary && currentName === resolvedName && currentTimestamp === resolvedTimestamp) {
          return entry
        }
        changed = true
        return {
          ...entry,
          name: resolvedName,
          summary: normalizedSummary,
          timestamp: resolvedTimestamp
        }
      })
      if (changed) {
        await writeTerminalSessionRegistryUnsafe(updatedItems)
      }
      return {
        matched,
        updated: changed,
        name: resolvedName,
        summary: normalizedSummary,
        timestamp: resolvedTimestamp
      }
    })
  }

  const upsertTerminalSessionRegistryEntry = async (entry) => {
    if (!entry || typeof entry !== "object") {
      return { updated: false, inserted: false }
    }
    const normalizedTerminalId = normalizeTerminalRegistryIdentity(entry.terminal_id)
    const normalizedUri = typeof entry.uri === "string" ? entry.uri.trim() : ""
    if (!normalizedTerminalId) {
      throw new Error("terminal_id is required for registry upsert")
    }
    return withRegistryWriteLock(async () => {
      const registry = await readTerminalSessionRegistryUnsafe()
      const existingItems = coerceTerminalRegistryItems(registry.items)
      const nextItems = []
      let replaced = false
      for (let i = 0; i < existingItems.length; i++) {
        const existing = existingItems[i]
        if (!existing || typeof existing !== "object") {
          continue
        }
        const existingTerminalId = normalizeTerminalRegistryIdentity(existing.terminal_id)
        const existingUri = typeof existing.uri === "string" ? existing.uri.trim() : ""
        const shouldReplace = (existingTerminalId && existingTerminalId === normalizedTerminalId)
          || (normalizedUri && existingUri && existingUri === normalizedUri)
        if (shouldReplace) {
          if (!replaced) {
            nextItems.push({
              ...existing,
              ...entry,
              terminal_id: normalizedTerminalId
            })
            replaced = true
          }
          continue
        }
        nextItems.push(existing)
      }
      if (!replaced) {
        nextItems.unshift({
          ...entry,
          terminal_id: normalizedTerminalId
        })
      }
      await writeTerminalSessionRegistryUnsafe(nextItems)
      return {
        updated: replaced,
        inserted: !replaced
      }
    })
  }

  return {
    coerceTerminalRegistryItems,
    readTerminalSessionRegistry,
    writeTerminalSessionRegistry,
    normalizeTerminalRegistryIdentity,
    updateTerminalSessionRegistrySummary,
    upsertTerminalSessionRegistryEntry
  }
}

module.exports = {
  createTerminalSessionRegistry
}
