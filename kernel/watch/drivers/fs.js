const fs = require("fs")
const path = require("path")
const ParcelWatcher = require("@parcel/watcher")

const DEFAULT_IGNORE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**"
]

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

async function nearestExistingDirectory(targetPath) {
  let current = path.resolve(targetPath)
  while (current && current !== path.dirname(current)) {
    const stats = await fs.promises.stat(current).catch(() => null)
    if (stats && stats.isDirectory()) {
      return current
    }
    current = path.dirname(current)
  }
  return current || path.parse(path.resolve(targetPath)).root
}

async function watchFs(targetPath, callback, options = {}) {
  const resolvedTarget = path.resolve(targetPath)
  const targetStats = await fs.promises.stat(resolvedTarget).catch(() => null)
  const watchRoot = targetStats && targetStats.isDirectory()
    ? resolvedTarget
    : await nearestExistingDirectory(resolvedTarget)
  const filterToTarget = watchRoot !== resolvedTarget

  const subscription = await ParcelWatcher.subscribe(
    watchRoot,
    (error, events) => {
      if (error) {
        if (typeof options.onError === "function") {
          options.onError(error)
        }
        return
      }
      const normalizedEvents = Array.isArray(events) ? events : []
      const filteredEvents = filterToTarget
        ? normalizedEvents.filter((event) => event && event.path && isInside(path.resolve(event.path), resolvedTarget))
        : normalizedEvents
      if (filteredEvents.length === 0) {
        return
      }
      callback(filteredEvents)
    },
    {
      ignore: Array.isArray(options.ignore) ? options.ignore : DEFAULT_IGNORE
    }
  )

  return async () => {
    if (subscription && typeof subscription.unsubscribe === "function") {
      await subscription.unsubscribe().catch(() => {})
    }
  }
}

module.exports = {
  watchFs
}
