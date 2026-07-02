const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const logRedaction = require("../server/lib/log_redaction")

test("log redaction overrides apply only safe top-level text files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-log-redaction-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  await fs.writeFile(path.join(root, "system.json"), '{"home":"raw"}', "utf8")
  await fs.mkdir(path.join(root, "shell"))
  await fs.writeFile(path.join(root, "shell", "run.log"), "raw", "utf8")

  const overrides = logRedaction.normalizeLogRedactionOverrides({
    redacted_overrides: [{
      path: "system.json",
      text: '{"home":"[private_path]"}'
    }]
  })

  assert.equal(overrides.length, 1)
  await logRedaction.assertCompleteLogRedactionOverrides(root, overrides)
  const applied = await logRedaction.applyLogRedactionOverrides(root, overrides)
  assert.equal(applied, 1)
  assert.equal(await fs.readFile(path.join(root, "system.json"), "utf8"), '{"home":"[private_path]"}')

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: "shell/run.log", text: "nope" }]
    })
  }, /Invalid redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: "../system.json", text: "nope" }]
    })
  }, /Invalid redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: ".DS_Store", text: "nope" }]
    })
  }, /Invalid redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: "caddy.log", text: "nope" }]
    })
  }, /Invalid redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: "caddy-2026-07-02T16-04-26.109.log", text: "nope" }]
    })
  }, /Invalid redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [{ path: "system.json", text: 1 }]
    })
  }, /Invalid redaction override text/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: [
        { path: "system.json", text: "one" },
        { path: "system.json", text: "two" }
      ]
    })
  }, /Duplicate redaction override path/)

  assert.throws(() => {
    logRedaction.normalizeLogRedactionOverrides({
      redacted_overrides: { "system.json": "nope" }
    })
  }, /redacted_overrides must be an array/)

  assert.deepEqual(logRedaction.normalizeLogRedactionOverrides({
    redactedOverrides: [{ path: "system.json", text: "ignored" }]
  }), [])
})

test("reviewed log archives require every top-level redactable file override", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-log-redaction-complete-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  await fs.writeFile(path.join(root, "system.json"), '{"home":"raw"}', "utf8")
  await fs.writeFile(path.join(root, "stdout.txt"), "raw", "utf8")
  await fs.writeFile(path.join(root, "caddy.log"), "raw", "utf8")
  await fs.writeFile(path.join(root, "caddy-2026-07-02T16-04-26.109.log"), "raw", "utf8")
  await fs.mkdir(path.join(root, "shell"))
  await fs.writeFile(path.join(root, "shell", "run.log"), "raw", "utf8")

  await assert.rejects(() => logRedaction.assertCompleteLogRedactionOverrides(root, [{
    path: "system.json",
    text: '{"home":"[private_path]"}'
  }]), /Missing redaction override/)

  await logRedaction.assertCompleteLogRedactionOverrides(root, [
    { path: "system.json", text: '{"home":"[private_path]"}' },
    { path: "stdout.txt", text: "raw" }
  ])
})

test("current log snapshot writes top-level state and system files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-log-snapshot-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const kernel = {
    path(relativePath) {
      return path.join(root, relativePath)
    },
    platform: "darwin",
    arch: "arm64",
    api: { running: { app: true } },
    homedir: "/Users/alice",
    vars: { PINOKIO_HOME: "/Users/alice/pinokio" },
    memory: { total: 1 },
    procs: [{ pid: 1 }],
    gpu: "Apple",
    gpus: ["Apple"],
    sysinfo: { hostname: "test-host" },
    shell: {
      shells: [{
        state: "running",
        id: "shell-1",
        group: "group-1",
        env: { TOKEN: "secret" },
        path: "/Users/alice/app",
        cmd: "node app.js",
        done: false,
        ready: true,
        ignored: "not serialized"
      }]
    }
  }

  await logRedaction.writeCurrentLogSnapshot(kernel, "9.9.9")

  const system = JSON.parse(await fs.readFile(path.join(root, "logs", "system.json"), "utf8"))
  const state = JSON.parse(await fs.readFile(path.join(root, "logs", "state.json"), "utf8"))
  assert.equal(system.version, "9.9.9")
  assert.equal(system.hostname, "test-host")
  assert.deepEqual(state, [{
    state: "running",
    id: "shell-1",
    group: "group-1",
    env: { TOKEN: "secret" },
    path: "/Users/alice/app",
    cmd: "node app.js",
    done: false,
    ready: true
  }])
})
