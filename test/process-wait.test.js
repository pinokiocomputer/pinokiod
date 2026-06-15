const assert = require("node:assert/strict")
const test = require("node:test")

const Process = require("../kernel/api/process")

test("process.wait tracks active waits with metadata and clears them when done", async () => {
  const processApi = new Process()
  const waitPath = "/pinokio/api/demo/start.js"
  const kernel = {
    activeProcessWaits: {},
    procs: {}
  }
  const events = []
  const req = {
    parent: { path: waitPath },
    params: {
      sec: 0.001,
      title: "Launching",
      description: "Waiting for app",
      message: "Hold on"
    }
  }

  const waitPromise = processApi.wait(req, (data, type) => {
    events.push({ data, type })
  }, kernel)

  assert.equal(kernel.activeProcessWaits[waitPath].path, waitPath)
  assert.equal(kernel.activeProcessWaits[waitPath].title, "Launching")
  assert.equal(kernel.activeProcessWaits[waitPath].description, "Waiting for app")
  assert.equal(kernel.activeProcessWaits[waitPath].message, "Hold on")
  assert.equal(kernel.activeProcessWaits[waitPath].params, req.params)

  await waitPromise

  assert.equal(kernel.activeProcessWaits[waitPath], undefined)
  assert.deepEqual(events.map((event) => event.type), [
    "process.wait.start",
    "process.wait.end"
  ])
})

test("process.wait preserves existing no-metadata waits without footer events", async () => {
  const processApi = new Process()
  const waitPath = "/pinokio/api/demo/start.js"
  const kernel = {
    activeProcessWaits: {},
    procs: {}
  }
  const events = []
  const req = {
    parent: { path: waitPath },
    params: { sec: 0.001 }
  }

  const waitPromise = processApi.wait(req, (data, type) => {
    events.push({ data, type })
  }, kernel)

  assert.equal(kernel.activeProcessWaits[waitPath].path, waitPath)
  await waitPromise

  assert.equal(kernel.activeProcessWaits[waitPath], undefined)
  assert.deepEqual(events, [])
})
