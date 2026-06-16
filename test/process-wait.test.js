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

test("process.wait shows default footer metadata for indefinite waits", async () => {
  const processApi = new Process()
  const waitPath = "/pinokio/api/demo/start.js"
  const kernel = {
    activeProcessWaits: {},
    procs: {}
  }
  const events = []
  const req = {
    parent: { path: waitPath }
  }

  const waitPromise = processApi.wait(req, (data, type) => {
    events.push({ data, type })
  }, kernel)

  assert.equal(req.params.title, "Waiting")
  assert.equal(req.params.description, "Click Stop when done.")
  assert.equal(kernel.activeProcessWaits[waitPath].title, "Waiting")
  assert.equal(kernel.activeProcessWaits[waitPath].description, "Click Stop when done.")
  assert.equal(kernel.procs[waitPath], processApi)
  assert.deepEqual(events.map((event) => event.type), ["process.wait.start"])

  processApi.resolve()
  await waitPromise

  assert.equal(kernel.activeProcessWaits[waitPath], undefined)
  assert.deepEqual(events.map((event) => event.type), [
    "process.wait.start",
    "process.wait.end"
  ])
})

test("process.wait shows message-only indefinite waits in the footer", async () => {
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
      message: "Waiting for external app"
    }
  }

  const waitPromise = processApi.wait(req, (data, type) => {
    events.push({ data, type })
  }, kernel)

  assert.equal(req.params.title, undefined)
  assert.equal(req.params.description, undefined)
  assert.equal(kernel.activeProcessWaits[waitPath].message, "Waiting for external app")
  assert.deepEqual(events.map((event) => event.type), ["process.wait.start"])

  processApi.resolve()
  await waitPromise

  assert.equal(kernel.activeProcessWaits[waitPath], undefined)
  assert.deepEqual(events.map((event) => event.type), [
    "process.wait.start",
    "process.wait.end"
  ])
})
