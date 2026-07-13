const fs = require("fs")
const path = require("path")
const { inspectWindowsFileLocks } = require("./windows_restart_manager")

const PATH_REMOVAL_BLOCKED_CODE = "PINOKIO_PATH_REMOVE_BLOCKED"
const REMAINING_PREVIEW_LIMIT = 20

class PathRemovalBlockedError extends Error {
  constructor(details, cause) {
    const blockers = Array.isArray(details.blockers) ? details.blockers : []
    const blockerReason = `${blockers.length === 1 ? "1 application" : `${blockers.length} applications`} may still be using files inside it`
    super(blockers.length > 0
      ? `Windows could not remove ${details.target} because ${blockerReason}.`
      : `Windows could not remove ${details.target}.`)
    this.name = "PathRemovalBlockedError"
    this.code = PATH_REMOVAL_BLOCKED_CODE
    this.target = details.target
    this.causeCode = cause && cause.code ? cause.code : ""
    const remaining = Array.isArray(details.remaining) ? details.remaining : []
    this.remaining = remaining.slice(0, REMAINING_PREVIEW_LIMIT)
    this.remainingCount = remaining.length
    this.blockers = blockers
  }

  toJSON() {
    return {
      code: this.code,
      target: this.target,
      causeCode: this.causeCode,
      remaining: this.remaining,
      remainingCount: this.remainingCount,
      blockers: this.blockers,
    }
  }
}

const isPathRemovalBlockedError = (error) => !!(error && error.code === PATH_REMOVAL_BLOCKED_CODE)

const isInside = (target, candidate) => {
  const relative = path.relative(target, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

const pathExists = async (target, fsPromises) => {
  try {
    await fsPromises.lstat(target)
    return true
  } catch (error) {
    return !error || error.code !== "ENOENT"
  }
}

const collectRemaining = async (target, fsPromises = fs.promises) => {
  const remaining = []
  const regularFiles = []
  const pending = [path.resolve(target)]

  while (pending.length > 0) {
    const current = pending.pop()
    let stat
    try {
      stat = await fsPromises.lstat(current)
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue
      }
      remaining.push(current)
      continue
    }

    if (!stat.isDirectory()) {
      remaining.push(current)
      if (stat.isFile()) {
        regularFiles.push(current)
      }
      continue
    }

    let entries
    try {
      entries = await fsPromises.readdir(current)
    } catch (error) {
      if (error.code !== "ENOENT") {
        remaining.push(current)
      }
      continue
    }
    if (entries.length === 0) {
      remaining.push(current)
      continue
    }
    for (const entry of entries) {
      const child = path.resolve(current, entry)
      if (isInside(target, child)) {
        pending.push(child)
      }
    }
  }

  return { remaining, regularFiles }
}

const createPathRemover = (dependencies = {}) => {
  const fsPromises = dependencies.fsPromises || fs.promises
  const platform = dependencies.platform || process.platform
  const inspectLocks = dependencies.inspectLocks || inspectWindowsFileLocks

  return async (target) => {
    const resolvedTarget = path.resolve(target)

    try {
      await fsPromises.rm(resolvedTarget, { recursive: true, force: true })
    } catch (error) {
      if (platform !== "win32") {
        throw error
      }

      if (!(await pathExists(resolvedTarget, fsPromises))) {
        return
      }
      const diagnosis = await collectRemaining(resolvedTarget, fsPromises)
      if (!(await pathExists(resolvedTarget, fsPromises))) {
        return
      }

      let blockers = []
      if (diagnosis.regularFiles.length > 0) {
        blockers = await inspectLocks(diagnosis.regularFiles).catch(() => [])
        if (!Array.isArray(blockers)) blockers = []
      }

      const remaining = diagnosis.remaining.length > 0 ? diagnosis.remaining : [resolvedTarget]

      throw new PathRemovalBlockedError({
        target: resolvedTarget,
        remaining,
        blockers,
      }, error)
    }
  }
}

const removePath = createPathRemover()

module.exports = {
  PATH_REMOVAL_BLOCKED_CODE,
  PathRemovalBlockedError,
  createPathRemover,
  isPathRemovalBlockedError,
  removePath,
}
