const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")

const {
  PATH_REMOVAL_BLOCKED_CODE,
  PathRemovalBlockedError,
  createPathRemover,
} = require("../kernel/path_removal")

test("removePath awaits one fixed recursive removal before any diagnosis", async () => {
  const calls = []
  let release
  let settled = false
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      rm: async (target, options) => {
        calls.push({ target, options })
        await new Promise((resolve) => { release = resolve })
      },
      lstat: async () => { throw new Error("unexpected diagnosis") },
      readdir: async () => { throw new Error("unexpected diagnosis") },
    },
    inspectLocks: async () => { throw new Error("unexpected diagnosis") },
  })

  const target = path.resolve(os.tmpdir(), "pinokio-remove-success")
  const removal = removePath(target).then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.deepEqual(calls, [{ target, options: { recursive: true, force: true } }])

  release()
  await removal
})

test("removePath rethrows the original non-Windows error", async () => {
  const original = Object.assign(new Error("busy"), { code: "EPERM" })
  const removePath = createPathRemover({
    platform: "darwin",
    fsPromises: {
      rm: async () => { throw original },
    },
  })

  await assert.rejects(removePath("/tmp/pinokio-remove-busy"), (error) => error === original)
})

test("removePath reports Windows blockers after partial deletion and succeeds on retry", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-remove-blocked-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const lockedDir = path.join(root, "pkgs", "git", "Library", "bin")
  const lockedFile = path.join(lockedDir, "zlib1.dll")
  const removableFile = path.join(root, "already-removed.txt")
  await fs.promises.mkdir(lockedDir, { recursive: true })
  await fs.promises.writeFile(lockedFile, "locked")
  await fs.promises.writeFile(removableFile, "remove me")

  let locked = true
  let registered
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      lstat: fs.promises.lstat.bind(fs.promises),
      readdir: fs.promises.readdir.bind(fs.promises),
      rm: async (target, options) => {
        if (!locked) return fs.promises.rm(target, options)
        await fs.promises.rm(removableFile, { force: true })
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" })
      },
    },
    inspectLocks: async (files) => {
      registered = files
      return [{ pid: 8544, name: "Logitech G HUB", serviceName: "" }]
    },
  })

  await assert.rejects(removePath(root), (error) => {
    assert.equal(error instanceof PathRemovalBlockedError, true)
    assert.equal(error.code, PATH_REMOVAL_BLOCKED_CODE)
    assert.equal(error.causeCode, "EPERM")
    assert.deepEqual(error.remaining, [lockedFile])
    assert.equal(error.remainingCount, 1)
    assert.deepEqual(error.blockers, [{ pid: 8544, name: "Logitech G HUB", serviceName: "" }])
    assert.deepEqual(Object.keys(error.toJSON()), [
      "code", "target", "causeCode", "remaining", "remainingCount", "blockers",
    ])
    return true
  })

  assert.equal(fs.existsSync(removableFile), false)
  assert.deepEqual(registered, [lockedFile])

  locked = false
  await removePath(root)
  assert.equal(fs.existsSync(root), false)
})

test("removePath still reports the original failure when Restart Manager fails", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-remove-denied-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const remainingFile = path.join(root, "denied.txt")
  await fs.promises.writeFile(remainingFile, "denied")

  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      lstat: fs.promises.lstat.bind(fs.promises),
      readdir: fs.promises.readdir.bind(fs.promises),
      rm: async () => { throw Object.assign(new Error("access denied"), { code: "EACCES" }) },
    },
    inspectLocks: async () => { throw new Error("diagnostic failed") },
  })

  await assert.rejects(removePath(root), (error) => {
    assert.equal(error instanceof PathRemovalBlockedError, true)
    assert.equal(error.causeCode, "EACCES")
    assert.deepEqual(error.remaining, [remainingFile])
    assert.deepEqual(error.blockers, [])
    assert.doesNotMatch(error.message, /still in use/)
    return true
  })
})

test("remainder diagnosis reports every leaf but registers only regular files", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-remove-leaves-"))
  const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-remove-outside-"))
  t.after(async () => {
    await fs.promises.rm(root, { recursive: true, force: true })
    await fs.promises.rm(outside, { recursive: true, force: true })
  })

  const regularFile = path.join(root, "regular.txt")
  const emptyDirectory = path.join(root, "empty")
  const unreadableDirectory = path.join(root, "unreadable")
  const unstatablePath = path.join(root, "unstatable")
  const link = path.join(root, "link")
  const outsideFile = path.join(outside, "outside.txt")
  const escapedPath = path.resolve(root, "../outside")
  await fs.promises.writeFile(regularFile, "regular")
  await fs.promises.mkdir(emptyDirectory)
  await fs.promises.mkdir(unreadableDirectory)
  await fs.promises.writeFile(unstatablePath, "unknown")
  await fs.promises.writeFile(outsideFile, "outside")
  await fs.promises.symlink(outside, link, process.platform === "win32" ? "junction" : "dir")

  let registered
  let escaped = false
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      rm: async () => { throw Object.assign(new Error("busy"), { code: "EPERM" }) },
      lstat: async (candidate) => {
        if (candidate === unstatablePath) {
          throw Object.assign(new Error("cannot stat"), { code: "EACCES" })
        }
        if (candidate === escapedPath) escaped = true
        return fs.promises.lstat(candidate)
      },
      readdir: async (candidate) => {
        if (candidate === unreadableDirectory) {
          throw Object.assign(new Error("cannot enumerate"), { code: "EACCES" })
        }
        const entries = await fs.promises.readdir(candidate)
        return candidate === root ? entries.concat("../outside") : entries
      },
    },
    inspectLocks: async (files) => {
      registered = files
      return []
    },
  })

  await assert.rejects(removePath(root), (error) => {
    assert.equal(error.remaining.every(path.isAbsolute), true)
    assert.deepEqual(error.remaining.slice().sort(), [
      emptyDirectory,
      link,
      regularFile,
      unreadableDirectory,
      unstatablePath,
    ].sort())
    assert.equal(error.remaining.includes(outsideFile), false)
    return true
  })

  assert.deepEqual(registered, [regularFile])
  assert.equal(registered.every(path.isAbsolute), true)
  assert.equal(escaped, false)
})

test("removePath reports an unstatable target without registering it", async () => {
  const target = path.resolve(os.tmpdir(), "pinokio-remove-unstatable")
  let inspected = false
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      rm: async () => { throw Object.assign(new Error("access denied"), { code: "EACCES" }) },
      lstat: async () => { throw Object.assign(new Error("cannot stat"), { code: "EACCES" }) },
      readdir: async () => { throw new Error("unexpected enumeration") },
    },
    inspectLocks: async () => {
      inspected = true
      return []
    },
  })

  await assert.rejects(removePath(target), (error) => {
    assert.deepEqual(error.remaining, [target])
    return true
  })
  assert.equal(inspected, false)
})

test("removePath falls back to the existing target when no leaf can be reported", async () => {
  const target = path.resolve(os.tmpdir(), "pinokio-remove-fallback")
  const vanishedChild = path.join(target, "vanished.txt")
  let inspected = false
  const directoryStat = {
    isDirectory: () => true,
    isFile: () => false,
  }
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      rm: async () => { throw Object.assign(new Error("busy"), { code: "EPERM" }) },
      lstat: async (candidate) => {
        if (candidate === target) return directoryStat
        throw Object.assign(new Error("gone"), { code: "ENOENT" })
      },
      readdir: async () => [path.basename(vanishedChild)],
    },
    inspectLocks: async () => {
      inspected = true
      return []
    },
  })

  await assert.rejects(removePath(target), (error) => {
    assert.deepEqual(error.remaining, [target])
    return true
  })
  assert.equal(inspected, false)
})

test("a target that disappears after a Windows removal failure is treated as removed", async () => {
  let statCalls = 0
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      rm: async () => { throw Object.assign(new Error("busy"), { code: "EPERM" }) },
      lstat: async () => {
        statCalls += 1
        if (statCalls === 1) {
          return { isDirectory: () => true, isFile: () => false }
        }
        throw Object.assign(new Error("gone"), { code: "ENOENT" })
      },
      readdir: async () => [],
    },
    inspectLocks: async () => { throw new Error("unexpected inspection") },
  })

  await removePath("C:\\pinokio\\bin\\miniforge")
})

test("remaining-path previews are truncated without limiting Restart Manager", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-remove-preview-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const files = Array.from({ length: 25 }, (_, index) => path.join(root, `${index}.txt`))
  await Promise.all(files.map((file) => fs.promises.writeFile(file, "remaining")))

  let registered
  const removePath = createPathRemover({
    platform: "win32",
    fsPromises: {
      lstat: fs.promises.lstat.bind(fs.promises),
      readdir: fs.promises.readdir.bind(fs.promises),
      rm: async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }) },
    },
    inspectLocks: async (files) => {
      registered = files
      return []
    },
  })

  await assert.rejects(removePath(root), (error) => {
    assert.equal(error.remainingCount, 25)
    assert.equal(error.remaining.length, 20)
    return true
  })
  assert.equal(registered.length, 25)
})
