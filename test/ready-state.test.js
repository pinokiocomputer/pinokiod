const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const ReadyState = require("../kernel/ready")

test("ready state clears stale script progress on lifecycle transitions", () => {
  const apiRoot = path.resolve("/tmp/pinokio-ready-state/api")
  const launchPath = path.resolve(apiRoot, "app-a", "start.js")
  const kernel = {
    memory: {
      rpc: {
        [launchPath]: {
          current: 1,
          total: 2
        }
      }
    },
    path: (name) => name === "api" ? apiRoot : path.resolve("/tmp/pinokio-ready-state", name)
  }
  const ready = new ReadyState(kernel)

  assert.deepEqual(ready.getScriptProgress(launchPath), {
    step_current: 2,
    step_total: 2
  })

  ready.markStarted(launchPath)
  assert.equal(ready.getScriptProgress(launchPath), null)
  assert.equal(ready.status.apps["app-a"].step_current, undefined)
  assert.equal(ready.status.apps["app-a"].scripts["start.js"].step_current, undefined)

  ready.markProgress(launchPath, 0, 2)
  assert.deepEqual(ready.getScriptProgress(launchPath), {
    step_current: 1,
    step_total: 2
  })

  ready.markReady(launchPath)
  assert.equal(ready.getScriptProgress(launchPath), null)
  assert.equal(ready.status.apps["app-a"].step_current, undefined)
  assert.equal(ready.status.apps["app-a"].scripts["start.js"].step_current, undefined)

  ready.markProgress(launchPath, 1, 2)
  ready.markStopped(launchPath)
  assert.equal(ready.getScriptProgress(launchPath), null)
  assert.equal(ready.status.apps["app-a"].step_current, undefined)
  assert.equal(ready.status.apps["app-a"].scripts["start.js"].step_current, undefined)
})
