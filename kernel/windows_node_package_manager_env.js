const fs = require('fs')
const os = require('os')
const path = require('path')

const windowsDirectoryLinkCache = new Map()

async function findExistingAncestor(targetPath) {
  let current = path.resolve(targetPath)
  while (true) {
    const exists = await fs.promises.access(current, fs.constants.F_OK).then(() => true).catch(() => false)
    if (exists) {
      return current
    }
    const parent = path.dirname(current)
    if (!parent || parent === current) {
      return null
    }
    current = parent
  }
}

async function windowsDirectoryLinksWork(targetPath) {
  const ancestor = await findExistingAncestor(targetPath || os.homedir())
  if (!ancestor) {
    return true
  }

  const cacheKey = path.parse(path.resolve(ancestor)).root.toLowerCase()
  if (windowsDirectoryLinkCache.has(cacheKey)) {
    return windowsDirectoryLinkCache.get(cacheKey)
  }

  const probePromise = (async () => {
    let probeDir = null
    try {
      probeDir = await fs.promises.mkdtemp(path.join(ancestor, ".pinokio-link-probe-"))
      const sourceDir = path.resolve(probeDir, "source")
      const linkDir = path.resolve(probeDir, "link")
      await fs.promises.mkdir(sourceDir)
      await fs.promises.symlink(path.resolve(sourceDir), linkDir, "junction")
      return true
    } catch (_) {
      return false
    } finally {
      if (probeDir) {
        await fs.promises.rm(probeDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })()

  windowsDirectoryLinkCache.set(cacheKey, probePromise)
  return probePromise
}

function getFirstDefinedEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return null
}

async function applyWindowsNodePackageManagerEnv(env, options = {}) {
  delete env.npm_config_symlink
  delete env.NPM_CONFIG_SYMLINK
  delete env.pnpm_config_symlink
  delete env.PNPM_CONFIG_SYMLINK

  const explicitNodeLinker = getFirstDefinedEnv(env, [
    "npm_config_node_linker",
    "NPM_CONFIG_NODE_LINKER",
    "pnpm_config_node_linker",
    "PNPM_CONFIG_NODE_LINKER",
  ])
  if (explicitNodeLinker) {
    return
  }

  const targetPath = options.targetPath || os.homedir()
  if (await windowsDirectoryLinksWork(targetPath)) {
    return
  }

  env.npm_config_node_linker = "hoisted"
  env.NPM_CONFIG_NODE_LINKER = "hoisted"
}

module.exports = {
  applyWindowsNodePackageManagerEnv,
}
