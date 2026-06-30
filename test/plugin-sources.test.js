const assert = require("assert")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const PluginSources = require("../kernel/plugin_sources")

test("resolveLauncherPluginSelection returns app-dev plugin query paths", () => {
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("claude"),
    "/pinokio/run/plugin/claude/pinokio.js"
  )
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("antigravity-cli"),
    "/pinokio/run/plugin/antigravity-cli/pinokio.js"
  )
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("codex-auto"),
    "/plugin/codex-auto/pinokio.js"
  )
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("plugin/local-tool"),
    "/plugin/local-tool/pinokio.js"
  )
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("api/my-app/plugins/helper"),
    "/api/my-app/plugins/helper/pinokio.js"
  )
  assert.strictEqual(
    PluginSources.resolveLauncherPluginSelection("pinokio/run/plugin/codex-auto"),
    "/pinokio/run/plugin/codex-auto/pinokio.js"
  )
})

test("normalizeActionPathComponents maps action URLs back to filesystem roots", () => {
  assert.deepStrictEqual(
    PluginSources.normalizeActionPathComponents(["pinokio", "run", "plugin", "antigravity-cli", "pinokio.js"]),
    {
      system: true,
      pathComponents: ["plugin", "antigravity-cli", "pinokio.js"],
    }
  )
  assert.deepStrictEqual(
    PluginSources.normalizeActionPathComponents(["plugin", "local-tool", "pinokio.js"]),
    {
      system: false,
      pathComponents: ["plugin", "local-tool", "pinokio.js"],
    }
  )
  assert.deepStrictEqual(
    PluginSources.normalizeActionPathComponents(["run", "plugin", "local-tool", "pinokio.js"]),
    {
      system: false,
      pathComponents: ["plugin", "local-tool", "pinokio.js"],
    }
  )
  assert.deepStrictEqual(
    PluginSources.normalizeActionPathComponents(["api", "my-app", "plugins", "helper", "pinokio.js"]),
    {
      system: false,
      pathComponents: ["api", "my-app", "plugins", "helper", "pinokio.js"],
    }
  )
})

test("normalizeLauncherSuccessPlugin rewrites prototype plugin redirects", () => {
  assert.strictEqual(
    PluginSources.normalizeLauncherSuccessPlugin(
      "/p/example/dev?plugin=/plugin/pinokio/run/plugin/codex-auto/pinokio.js&prompt=build",
      "pinokio/run/plugin/codex-auto"
    ),
    "/p/example/dev?plugin=%2Fpinokio%2Frun%2Fplugin%2Fcodex-auto%2Fpinokio.js&prompt=build"
  )

  assert.strictEqual(
    PluginSources.normalizeLauncherSuccessPlugin(
      "/p/example/dev?plugin=/plugin/api/my-app/plugins/helper/pinokio.js",
      "api/my-app/plugins/helper"
    ),
    "/p/example/dev?plugin=%2Fapi%2Fmy-app%2Fplugins%2Fhelper%2Fpinokio.js"
  )

  assert.strictEqual(
    PluginSources.normalizeLauncherSuccessPlugin("/p/example/dev", "pinokio/run/plugin/codex-auto"),
    "/p/example/dev"
  )
})

test("isValidPluginConfig accepts only action functions and valid standalone plugin paths", () => {
  assert.strictEqual(
    PluginSources.isValidPluginConfig({ run: async () => [] }),
    true
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig({
      run: [{ method: "shell.run", params: { message: "echo ok" } }],
      install: async () => [],
      update: async () => [],
      uninstall: async () => [],
      installed: async () => true,
    }),
    true
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig({
      run: [{ method: "shell.run", params: { message: "echo ok" } }],
      helper: () => [],
    }),
    false
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig({
      run: [{ method: "shell.run", params: { message: "echo ok" } }],
      install: "install.js",
    }),
    false
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig({
      run: [{ method: "shell.run", params: { message: "echo ok" } }],
      installed: true,
    }),
    false
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig(
      { path: "plugin", run: async () => [] },
      { standalone: true }
    ),
    true
  )

  assert.strictEqual(
    PluginSources.isValidPluginConfig(
      { path: "api/example/plugins/tool", run: async () => [] },
      { standalone: true }
    ),
    false
  )
})

test("loadPluginMenu merges bundled plugins and valid standalone local plugins", async () => {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-plugin-menu-"))
  try {
    await fs.mkdir(path.join(homedir, "plugin", "local-tool"), { recursive: true })
    await fs.writeFile(path.join(homedir, "plugin", "local-tool", "pinokio.js"), `
module.exports = {
  path: "plugin",
  title: "Local Tool",
  icon: "local.png",
  run: [{ method: "shell.run", params: { message: "echo local" } }]
}
`)

    await fs.mkdir(path.join(homedir, "plugin", "code", "legacy"), { recursive: true })
    await fs.writeFile(path.join(homedir, "plugin", "code", "legacy", "pinokio.js"), `
module.exports = {
  path: "plugin",
  title: "Legacy Code Plugin",
  run: [{ method: "shell.run", params: { message: "echo legacy" } }]
}
`)

    await fs.mkdir(path.join(homedir, "plugin", "app-owned"), { recursive: true })
    await fs.writeFile(path.join(homedir, "plugin", "app-owned", "pinokio.js"), `
module.exports = {
  path: "api/example/plugins/tool",
  title: "App Owned",
  run: [{ method: "shell.run", params: { message: "echo app" } }]
}
`)

    const repoRoot = path.resolve(__dirname, "..")
    const kernel = {
      homedir,
      systemPath: (...parts) => path.join(repoRoot, "system", ...parts),
      require: async (filepath) => {
        delete require.cache[require.resolve(filepath)]
        return require(filepath)
      }
    }

    const menu = await PluginSources.loadPluginMenu(kernel)
    const systemPlugins = menu.filter((item) => item.source === "system")
    const localPlugins = menu.filter((item) => item.source === "local")

    assert.strictEqual(systemPlugins.length, 11)
    assert.ok(systemPlugins.every((item) => item.system === true))
    assert.ok(systemPlugins.every((item) => item.href.startsWith("/pinokio/run/plugin/")))
    assert.ok(systemPlugins.every((item) => item.image.startsWith("/pinokio/asset/plugin/")))

    assert.deepStrictEqual(localPlugins.map((item) => item.title), ["Local Tool"])
    assert.strictEqual(localPlugins[0].href, "/run/plugin/local-tool/pinokio.js")
    assert.strictEqual(localPlugins[0].image, "/asset/plugin/local-tool/local.png")
  } finally {
    await fs.rm(homedir, { recursive: true, force: true })
  }
})
