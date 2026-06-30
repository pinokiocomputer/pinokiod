const assert = require("node:assert/strict")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const antigravityCli = require("../system/plugin/antigravity-cli/pinokio")
const antigravityCliAuto = require("../system/plugin/antigravity-cli-auto/pinokio")
const antigravityCommon = require("../system/plugin/antigravity-cli/common")

function createKernel(root, platform = "darwin") {
  return {
    platform,
    path: (...parts) => path.join(root, ...parts),
  }
}

test("Antigravity CLI plugins expose managed lifecycle actions", () => {
  for (const plugin of [antigravityCli, antigravityCliAuto]) {
    assert.equal(typeof plugin.install, "function")
    assert.equal(typeof plugin.update, "function")
    assert.equal(typeof plugin.uninstall, "function")
    assert.equal(typeof plugin.installed, "function")
    assert.equal(typeof plugin.run, "function")
  }
})

test("Antigravity CLI install and update install agy into Pinokio bin", () => {
  const root = path.join(os.tmpdir(), "pinokio-antigravity-test")
  const kernel = createKernel(root)

  const install = antigravityCli.install(kernel, {})[0]
  const update = antigravityCli.update(kernel, {})[0]

  for (const step of [install, update]) {
    assert.equal(step.method, "shell.run")
    assert.equal(step.params.path, root)
    assert.equal(Object.prototype.hasOwnProperty.call(step.params, "conda"), false)
    assert.equal(Object.prototype.hasOwnProperty.call(step.params, "env"), false)
    assert.equal(step.params.message._[0], "node")
    assert.equal(step.params.message._[1], antigravityCommon.installerPath())
    assert.deepEqual(step.params.message._.slice(2), [
      "--install-dir",
      path.join(root, "bin"),
      "--managed-dir",
      path.join(root, "bin", "antigravity-cli"),
    ])
    assert.doesNotMatch(step.params.message._.join(" "), / -e /)
    assert.doesNotMatch(step.params.message._.join(" "), /api\.github\.com\/repos\/google-antigravity\/antigravity-cli\/releases\/latest/)
    assert.equal(Object.prototype.hasOwnProperty.call(step.params, "input"), false)
  }
})

test("Antigravity CLI installer script downloads and verifies official release assets", () => {
  const source = require("node:fs").readFileSync(antigravityCommon.installerPath(), "utf8")

  assert.match(source, /api\.github\.com\/repos\/google-antigravity\/antigravity-cli\/releases\/latest/)
  assert.match(source, /assetNameForPlatform/)
  assert.match(source, /agy_cli_mac_.*\.tar\.gz/)
  assert.match(source, /agy_cli_linux_.*\.tar\.gz/)
  assert.match(source, /agy_cli_windows_.*\.zip/)
  assert.match(source, /asset\.digest/)
  assert.match(source, /install\.json/)
  assert.doesNotMatch(source, /profile|bashrc|zshrc/)
  assert.doesNotMatch(source, /antigravity-cli-auto-updater/)
})

test("Antigravity CLI uninstall removes only the managed binary and staging directory", () => {
  const root = path.join(os.tmpdir(), "pinokio-antigravity-test")
  const kernel = createKernel(root)
  const step = antigravityCli.uninstall(kernel, {})[0]

  assert.equal(step.method, "shell.run")
  assert.equal(step.params.path, path.join(root, "bin"))
  assert.match(step.params.message, new RegExp(`rm -f '${path.join(root, "bin", "agy")}'`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(step.params.message, new RegExp(`rm -rf '${path.join(root, "bin", "antigravity-cli")}'`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.doesNotMatch(step.params.message, new RegExp(`rm -rf '${path.join(root, "bin")}'`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.equal(Object.prototype.hasOwnProperty.call(step.params, "input"), false)
})

test("Antigravity CLI run uses the Pinokio-managed binary path", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-antigravity-run-"))
  try {
    const kernel = createKernel(root)
    const bin = antigravityCommon.binaryPath(kernel, "darwin")
    await fsp.mkdir(path.dirname(bin), { recursive: true })
    await fsp.writeFile(bin, "")

    const steps = antigravityCli.run(kernel, {}, {
      args: { cwd: "/tmp/workspace", prompt: "build this" },
      input: {},
    })

    assert.equal(steps.length, 1)
    assert.equal(steps[0].method, "shell.run")
    assert.deepEqual(steps[0].params.message, {
      _: [bin, "--prompt-interactive", "build this"]
    })
    assert.equal(steps[0].params.path, "/tmp/workspace")
    assert.equal(steps[0].params.conda.skip, true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test("Antigravity CLI installed checks the Pinokio-managed agy binary", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-antigravity-installed-"))
  try {
    const kernel = createKernel(root)
    const bin = antigravityCommon.binaryPath(kernel, "darwin")

    assert.equal(antigravityCli.installed(kernel, {}), false)

    await fsp.mkdir(path.dirname(bin), { recursive: true })
    await fsp.writeFile(bin, "")

    assert.equal(antigravityCli.installed(kernel, {}), true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test("Antigravity CLI Auto adds the current permission-skip flag", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-antigravity-auto-"))
  try {
    const kernel = createKernel(root)
    const bin = antigravityCommon.binaryPath(kernel, "darwin")
    await fsp.mkdir(path.dirname(bin), { recursive: true })
    await fsp.writeFile(bin, "")

    const steps = antigravityCliAuto.run(kernel, {}, {
      args: { cwd: "/tmp/workspace" },
      input: {},
    })

    assert.deepEqual(steps[0].params.message, {
      _: [bin, "--dangerously-skip-permissions"]
    })
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test("Antigravity CLI run asks for Pinokio install when managed binary is missing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-antigravity-missing-"))
  try {
    const kernel = createKernel(root)
    const steps = antigravityCli.run(kernel, {}, {
      args: { cwd: "/tmp/workspace" },
      input: {},
    })

    assert.equal(steps[0].method, "notify")
    assert.match(steps[0].params.html, /Open the plugin page/)
    assert.equal(steps[0].params.href, "/plugin?path=%2Fpinokio%2Frun%2Fplugin%2Fantigravity-cli%2Fpinokio.js&next=install")
    assert.equal(steps[0].params.target, "_parent")
    assert.equal(steps[0].params.type, "warning")
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test("Antigravity CLI uses kernel.platform for Windows binary paths", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-antigravity-win-"))
  try {
    const kernel = createKernel(root, "win32")
    const bin = antigravityCommon.binaryPath(kernel, "win32")
    await fsp.mkdir(path.dirname(bin), { recursive: true })
    await fsp.writeFile(bin, "")

    assert.equal(bin, path.join(root, "bin", "agy.exe"))
    assert.equal(antigravityCli.installed(kernel, {}), true)

    const uninstall = antigravityCli.uninstall(kernel, {})[0]
    assert.equal(uninstall.params.shell, "powershell")
    assert.match(uninstall.params.message, /agy\.exe/)

    const run = antigravityCli.run(kernel, {}, {
      args: { cwd: "C:\\workspace" },
      input: {},
    })
    assert.deepEqual(run[0].params.message, { _: [bin] })
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})
