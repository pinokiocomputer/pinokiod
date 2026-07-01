const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const { deletePluginFolder, resolvePluginDeleteTarget } = require("../server/lib/plugin_delete")

async function withHome(fn) {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-plugin-delete-"))
  const kernel = {
    homedir,
    path: (...parts) => path.join(homedir, ...parts),
  }
  try {
    return await fn({ homedir, kernel })
  } finally {
    await fs.rm(homedir, { recursive: true, force: true })
  }
}

test("deletePluginFolder removes only the selected downloaded plugin folder", async () => {
  await withHome(async ({ homedir, kernel }) => {
    const demoDir = path.join(homedir, "plugin", "demo")
    const otherDir = path.join(homedir, "plugin", "other")
    await fs.mkdir(demoDir, { recursive: true })
    await fs.mkdir(otherDir, { recursive: true })
    await fs.writeFile(path.join(demoDir, "pinokio.js"), "module.exports = { run: [] }\n")
    await fs.writeFile(path.join(demoDir, "notes.txt"), "demo\n")
    await fs.writeFile(path.join(otherDir, "pinokio.js"), "module.exports = { run: [] }\n")

    const target = await deletePluginFolder({
      kernel,
      plugin: {
        pluginPath: "/plugin/demo/pinokio.js",
        source: "local",
      },
    })

    assert.equal(target.localLabel, "plugin/demo")
    await assert.rejects(fs.stat(demoDir), /ENOENT/)
    assert.ok((await fs.stat(path.join(homedir, "plugin"))).isDirectory())
    assert.ok((await fs.stat(path.join(otherDir, "pinokio.js"))).isFile())
  })
})

test("resolvePluginDeleteTarget rejects built-in system plugins", async () => {
  await withHome(async ({ kernel }) => {
    assert.throws(
      () => resolvePluginDeleteTarget({
        kernel,
        plugin: {
          pluginPath: "/pinokio/run/plugin/demo/pinokio.js",
          source: "system",
          system: true,
        },
      }),
      /Built-in plugins cannot be deleted/
    )
  })
})

test("resolvePluginDeleteTarget rejects traversal out of downloaded plugin folders", async () => {
  await withHome(async ({ kernel }) => {
    assert.throws(
      () => resolvePluginDeleteTarget({
        kernel,
        plugin: {
          pluginPath: "/plugin/../api/demo/pinokio.js",
          source: "local",
        },
      }),
      /(Only downloaded plugin folders can be deleted|outside the downloaded plugin folder)/
    )
  })
})

test("resolvePluginDeleteTarget refuses to delete the plugin root", async () => {
  await withHome(async ({ homedir, kernel }) => {
    await fs.mkdir(path.join(homedir, "plugin"), { recursive: true })

    assert.throws(
      () => resolvePluginDeleteTarget({
        kernel,
        plugin: {
          pluginPath: "/plugin/pinokio.js",
          source: "local",
        },
      }),
      /plugin root folder cannot be deleted/
    )
  })
})

test("deletePluginFolder rejects plugin directory symlinks that resolve outside the plugin root", async () => {
  await withHome(async ({ homedir, kernel }) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-plugin-delete-outside-"))
    try {
      await fs.mkdir(path.join(homedir, "plugin"), { recursive: true })
      await fs.writeFile(path.join(outsideDir, "pinokio.js"), "module.exports = { run: [] }\n")
      await fs.symlink(outsideDir, path.join(homedir, "plugin", "linked"), "dir")

      await assert.rejects(
        deletePluginFolder({
          kernel,
          plugin: {
            pluginPath: "/plugin/linked/pinokio.js",
            source: "local",
          },
        }),
        /outside the downloaded plugin folder/
      )
      assert.ok((await fs.stat(path.join(outsideDir, "pinokio.js"))).isFile())
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

test("deletePluginFolder removes nested symlinks without following them outside the plugin folder", async () => {
  await withHome(async ({ homedir, kernel }) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-plugin-delete-outside-"))
    try {
      const pluginDir = path.join(homedir, "plugin", "demo")
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(path.join(pluginDir, "pinokio.js"), "module.exports = { run: [] }\n")
      await fs.writeFile(path.join(outsideDir, "keep.txt"), "keep\n")
      await fs.symlink(outsideDir, path.join(pluginDir, "outside-link"), "dir")

      await deletePluginFolder({
        kernel,
        plugin: {
          pluginPath: "/plugin/demo/pinokio.js",
          source: "local",
        },
      })

      await assert.rejects(fs.stat(pluginDir), /ENOENT/)
      assert.ok((await fs.stat(path.join(outsideDir, "keep.txt"))).isFile())
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
