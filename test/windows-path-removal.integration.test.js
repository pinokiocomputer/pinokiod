const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const { PATH_REMOVAL_BLOCKED_CODE, removePath } = require("../kernel/path_removal")

const waitForExit = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => child.once("exit", resolve))
}

const waitForReady = (child) => new Promise((resolve, reject) => {
  let output = ""
  const timer = setTimeout(() => reject(new Error("DLL holder did not become ready")), 10000)
  child.stdout.on("data", (chunk) => {
    output += chunk.toString()
    if (output.includes("READY")) {
      clearTimeout(timer)
      resolve()
    }
  })
  child.once("exit", (code) => {
    clearTimeout(timer)
    reject(new Error(`DLL holder exited before ready (${code})`))
  })
})

test("Windows integration: loaded DLL is diagnosed and removable after release", {
  skip: process.platform !== "win32",
  timeout: 30000,
}, async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-windows-lock-"))
  const dllPath = path.join(root, "version.dll")
  const ordinaryFile = path.join(root, "ordinary.txt")
  await fs.promises.copyFile(path.join(process.env.SystemRoot, "System32", "version.dll"), dllPath)
  await fs.promises.writeFile(ordinaryFile, "ordinary")

  const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "hold-windows-dll.js"), dllPath], {
    stdio: ["pipe", "pipe", "pipe"],
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = waitForExit(child)
      child.kill()
      await exited
    }
    await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {})
  })
  await waitForReady(child)

  await assert.rejects(
    removePath(root),
    (error) => {
      assert.equal(error.code, PATH_REMOVAL_BLOCKED_CODE)
      assert.equal(error.remaining.includes(dllPath), true)
      assert.equal(error.blockers.some((blocker) => blocker.pid === child.pid), true)
      return true
    },
  )
  assert.equal(await fs.promises.access(ordinaryFile).then(() => true).catch(() => false), false)

  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.stdin.write("release\n")
  await exited
  await removePath(root)
  assert.equal(await fs.promises.access(root).then(() => true).catch(() => false), false)
})
