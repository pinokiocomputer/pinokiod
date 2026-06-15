const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const fssync = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Environment = require("../kernel/environment")

const CACHE_KEYS = ["TMP", "TEMP", "TMPDIR", "PIP_TMPDIR", "UV_CACHE_DIR", "PIP_CACHE_DIR"]

const createKernel = (homedir) => ({
  homedir,
  exists: (...args) => new Promise((resolve) => {
    fssync.access(path.resolve(homedir, ...args), fssync.constants.F_OK, (error) => {
      resolve(!error)
    })
  })
})

const withTempHome = async (fn) => {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-cache-preflight-"))
  try {
    await fs.writeFile(path.join(homedir, "ENVIRONMENT"), "OTHER=value\n")
    await fn(homedir)
  } finally {
    await fs.rm(homedir, { recursive: true, force: true })
  }
}

test("ensurePinokioCacheDirs writes managed cache env defaults and probes directories", async () => {
  await withTempHome(async (homedir) => {
    const kernel = createKernel(homedir)
    const result = await Environment.ensurePinokioCacheDirs(kernel, { throwOnFailure: true })

    assert.equal(result.errors.length, 0)
    assert.equal(kernel.cacheDirErrors.length, 0)
    assert.equal(kernel.cacheDirPreflight.length, CACHE_KEYS.length)

    const env = await fs.readFile(path.join(homedir, "ENVIRONMENT"), "utf8")
    for (const key of CACHE_KEYS) {
      assert.match(env, new RegExp(`^${key}=\\.\\/cache\\/${key}$`, "m"))
      const stats = await fs.stat(path.join(homedir, "cache", key))
      assert.equal(stats.isDirectory(), true)
    }
  })
})

test("ensurePinokioCacheDirs repairs managed cache targets that are not writable directories", async () => {
  await withTempHome(async (homedir) => {
    await fs.mkdir(path.join(homedir, "cache"), { recursive: true })
    await fs.writeFile(path.join(homedir, "cache", "TMP"), "not a directory")

    const kernel = createKernel(homedir)
    const result = await Environment.ensurePinokioCacheDirs(kernel, { throwOnFailure: true })
    const tmpResult = result.results.find((item) => item.key === "TMP")

    assert.equal(result.errors.length, 0)
    assert.equal(tmpResult.repaired, true)
    const stats = await fs.stat(path.join(homedir, "cache", "TMP"))
    assert.equal(stats.isDirectory(), true)
  })
})
