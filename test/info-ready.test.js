const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const Info = require("../kernel/info")

const createInfo = ({ callerFile, scriptResolve, readyPaths = [] }) => {
  const ready = new Set(readyPaths.map((item) => path.resolve(item)))
  const info = new Info({
    script: {
      resolve: scriptResolve || (() => false)
    },
    isScriptReady: (scriptPath) => ready.has(path.resolve(scriptPath))
  })
  info.caller = () => callerFile
  return info
}

test("info.ready checks caller-relative script paths first", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinokio-info-ready-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const appRoot = path.join(root, "app")
  const callerFile = path.join(appRoot, "pinokio.js")
  const startScript = path.join(appRoot, "start.js")
  fs.mkdirSync(appRoot, { recursive: true })
  fs.writeFileSync(callerFile, "module.exports = {}")
  fs.writeFileSync(startScript, "module.exports = {}")

  let resolverCalls = 0
  const info = createInfo({
    callerFile,
    scriptResolve: () => {
      resolverCalls += 1
      return false
    },
    readyPaths: [startScript]
  })

  assert.equal(info.ready("start.js"), true)
  assert.equal(resolverCalls, 0)
})

test("info.ready falls back to Pinokio script URI resolution", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinokio-info-ready-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const callerFile = path.join(root, "caller", "pinokio.js")
  const remoteRoot = path.join(root, "api", "remote.git")
  const remoteStart = path.join(remoteRoot, "start.js")
  const remoteUri = "https://github.com/example/remote.git"
  fs.mkdirSync(path.dirname(callerFile), { recursive: true })
  fs.mkdirSync(remoteRoot, { recursive: true })
  fs.writeFileSync(callerFile, "module.exports = {}")
  fs.writeFileSync(remoteStart, "module.exports = {}")

  const info = createInfo({
    callerFile,
    scriptResolve: (...args) => {
      if (args[0] === remoteUri) {
        return path.resolve(remoteRoot, ...args.slice(1))
      }
      return false
    },
    readyPaths: [remoteStart]
  })

  assert.equal(info.ready(remoteUri, "start.js"), true)
})

test("info.ready returns false when neither relative nor URI path is ready", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinokio-info-ready-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const appRoot = path.join(root, "app")
  const callerFile = path.join(appRoot, "pinokio.js")
  fs.mkdirSync(appRoot, { recursive: true })
  fs.writeFileSync(callerFile, "module.exports = {}")

  const info = createInfo({
    callerFile,
    scriptResolve: () => false
  })

  assert.equal(info.ready("missing.js"), false)
})
