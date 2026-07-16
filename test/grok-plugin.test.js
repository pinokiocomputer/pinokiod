const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const grok = require("../system/plugin/grok/pinokio")
const grokAuto = require("../system/plugin/grok-auto/pinokio")

test("Grok Build exposes a minimal npx-backed terminal plugin", () => {
  assert.equal(grok.title, "Grok Build")
  assert.equal(grok.icon, "grok.png")
  assert.equal(grok.link, "https://github.com/xai-org/grok-build")
  assert.equal(fs.existsSync(path.join(__dirname, "..", "system", "plugin", "grok", grok.icon)), true)

  for (const action of ["install", "update", "uninstall", "installed"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(grok, action), false)
  }

  assert.equal(grok.run.length, 2)
  for (const step of grok.run) {
    assert.equal(step.id, "run")
    assert.equal(step.method, "shell.run")
    assert.deepEqual(step.params.message, {
      _: [
        "npx",
        "-y",
        "@xai-official/grok@latest",
        "{{args.prompt || undefined}}"
      ]
    })
    assert.equal(step.params.path, "{{args.cwd}}")
    assert.equal(step.params.input, true)
    assert.equal(step.params.buffer, 1024)
  }

  assert.match(grok.run[0].when, /win32/)
  assert.match(grok.run[0].params.shell, /bash\.exe/)
  assert.equal(grok.run[0].params.conda.skip, true)
  assert.equal(Object.prototype.hasOwnProperty.call(grok.run[1].params, "shell"), false)
})

test("Grok Build Auto shares the base wrapper and enables always-approve", () => {
  assert.equal(grokAuto.title, "Grok Build Auto")
  assert.equal(grokAuto.icon, grok.icon)
  assert.equal(grokAuto.link, grok.link)
  assert.match(grokAuto.description, /automatically approved/)
  assert.equal(fs.existsSync(path.join(__dirname, "..", "system", "plugin", "grok-auto", grokAuto.icon)), true)

  for (const action of ["install", "update", "uninstall", "installed"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(grokAuto, action), false)
  }

  assert.equal(grokAuto.run.length, grok.run.length)
  for (let index = 0; index < grok.run.length; index += 1) {
    const baseStep = grok.run[index]
    const autoStep = grokAuto.run[index]

    assert.equal(autoStep.when, baseStep.when)
    assert.equal(autoStep.id, baseStep.id)
    assert.equal(autoStep.method, baseStep.method)
    assert.equal(autoStep.params.path, baseStep.params.path)
    assert.equal(autoStep.params.input, baseStep.params.input)
    assert.equal(autoStep.params.buffer, baseStep.params.buffer)
    assert.equal(autoStep.params.shell, baseStep.params.shell)
    assert.deepEqual(autoStep.params.conda, baseStep.params.conda)
    assert.deepEqual(autoStep.params.message, {
      _: [
        "npx",
        "-y",
        "@xai-official/grok@latest",
        "--always-approve",
        "{{args.prompt || undefined}}"
      ]
    })
  }

  assert.equal(grok.run.every((step) => !step.params.message._.includes("--always-approve")), true)
})
