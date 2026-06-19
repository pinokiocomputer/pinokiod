const assert = require("assert")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

test("dev iframe checks plugin install state before posting a launch request", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "server", "views", "d.ejs"), "utf8")
  const launchStart = view.indexOf("const launchTab = async (tab) =>")
  const redirectIndex = view.indexOf("if (await redirectToPluginInstallIfNeeded(href))", launchStart)
  const postMessageIndex = view.indexOf("window.parent.postMessage", launchStart)

  assert.notStrictEqual(launchStart, -1)
  assert.ok(redirectIndex > launchStart)
  assert.ok(postMessageIndex > redirectIndex)
  assert.ok(view.includes("window.top.location.href = redirectHref"))
  assert.ok(view.includes("/api/plugin/install-state?path="))
})
