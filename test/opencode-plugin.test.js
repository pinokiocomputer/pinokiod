const assert = require("node:assert/strict")
const test = require("node:test")

const opencode = require("../system/plugin/opencode/pinokio")
const opencodeAuto = require("../system/plugin/opencode-auto/pinokio")

test("OpenCode installed status follows executable availability", async () => {
  const lookups = []
  const kernel = {
    which(name) {
      lookups.push(name)
      return null
    },
  }

  assert.equal(await opencode.installed(kernel, {}), false)

  kernel.which = (name) => {
    lookups.push(name)
    return "/pinokio/bin/npm/bin/opencode"
  }

  assert.equal(await opencode.installed(kernel, {}), true)
  assert.deepEqual(lookups, ["opencode", "opencode"])
})

test("OpenCode Auto shares the managed lifecycle and launches in auto mode", () => {
  for (const action of ["install", "uninstall", "update", "installed"]) {
    assert.equal(opencodeAuto[action], opencode[action])
  }

  assert.equal(opencodeAuto.run.length, opencode.run.length)
  for (let index = 0; index < opencodeAuto.run.length; index += 1) {
    const normalStep = opencode.run[index]
    const autoStep = opencodeAuto.run[index]

    assert.equal(autoStep.when, normalStep.when)
    assert.equal(autoStep.id, normalStep.id)
    assert.equal(autoStep.method, normalStep.method)
    assert.equal(autoStep.params.path, normalStep.params.path)
    assert.equal(autoStep.params.input, normalStep.params.input)
    assert.equal(autoStep.params.shell, normalStep.params.shell)
    assert.equal(autoStep.params.message, "opencode --auto")
  }
})
