const assert = require("assert")
const test = require("node:test")
const PluginSources = require("../kernel/plugin_sources")

test("resolveLauncherPluginSelection returns app-dev plugin query paths", () => {
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
