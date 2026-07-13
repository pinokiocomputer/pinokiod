const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM, VirtualConsole } = require("jsdom")

const repoRoot = path.resolve(__dirname, "..")
const commonScriptPath = path.join(repoRoot, "server/public/common.js")
const installViewPath = path.join(repoRoot, "server/views/install.ejs")

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

function response(payload, { ok = false, status = 423 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  }
}

async function createHarness() {
  const source = await fs.readFile(commonScriptPath, "utf8")

  const state = {
    buttonsDisabled: false,
    clearedIntervals: new Set(),
    closeCount: 0,
    fireOptions: null,
    htmlContainer: null,
    intervals: new Map(),
    nextIntervalId: 1,
    resolveFire: null,
    validationMessage: "",
    visible: false,
  }
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    throw error
  })

  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "dangerously",
    url: "http://localhost/",
    virtualConsole,
    beforeParse(window) {
      window.fetch = async () => response({}, { ok: true, status: 200 })
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      }
      window.setInterval = (callback, delay) => {
        const id = state.nextIntervalId++
        state.intervals.set(id, { callback, delay })
        return id
      }
      window.clearInterval = (id) => {
        state.clearedIntervals.add(id)
        state.intervals.delete(id)
      }
      window.Swal = {
        disableButtons() {
          state.buttonsDisabled = true
        },
        enableButtons() {
          state.buttonsDisabled = false
        },
        close() {
          if (!state.visible) return
          state.closeCount += 1
          state.visible = false
          if (state.fireOptions && typeof state.fireOptions.willClose === "function") {
            state.fireOptions.willClose()
          }
          if (state.resolveFire) state.resolveFire({ isConfirmed: false })
        },
        fire(options) {
          state.fireOptions = options
          state.htmlContainer = window.document.createElement("div")
          state.htmlContainer.innerHTML = options.html || ""
          window.document.body.appendChild(state.htmlContainer)
          state.visible = true
          if (typeof options.didOpen === "function") options.didOpen()
          return new Promise((resolve) => {
            state.resolveFire = resolve
          })
        },
        getHtmlContainer() {
          return state.htmlContainer
        },
        isVisible() {
          return state.visible
        },
        showValidationMessage(message) {
          state.validationMessage = message
        },
      }
    },
  })

  const script = dom.window.document.createElement("script")
  script.textContent = source
  dom.window.document.body.appendChild(script)

  state.dismiss = () => {
    if (!state.visible || state.buttonsDisabled) return false
    state.visible = false
    if (state.fireOptions && typeof state.fireOptions.willClose === "function") {
      state.fireOptions.willClose()
    }
    state.resolveFire({ isConfirmed: false })
    return true
  }
  state.getRetryIntervalId = () => Array.from(state.intervals.entries())
    .filter(([, interval]) => interval.delay === 2000)
    .map(([id]) => id)
    .pop()
  state.runInterval = async () => {
    const interval = state.intervals.get(state.getRetryIntervalId())
    assert.ok(interval, "expected an active retry interval")
    return await interval.callback()
  }

  return { dom, state, api: dom.window.PinokioPathRemoval }
}

test("path-removal modal renders identified blockers and escapes backend text", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  const shown = api.show({
    details: {
      blockers: [{
        name: "G <HUB>",
        serviceName: "lghub-service",
        pid: 4321,
      }],
      remainingCount: 25,
      remaining: Array.from({ length: 20 }, (_, index) => `C:\\runtime\\file-${index}.dll`),
    },
    retry: async () => ({ ok: true }),
  })

  assert.equal(state.fireOptions.title, "File removal paused")
  assert.match(state.htmlContainer.innerHTML, /G &lt;HUB&gt;/)
  assert.doesNotMatch(state.htmlContainer.innerHTML, /G <HUB>/)
  assert.match(state.htmlContainer.textContent, /lghub-service · PID 4321/)
  assert.match(state.htmlContainer.textContent, /because one or more files are still in use/)
  assert.match(state.htmlContainer.textContent, /Show first 20 of 25 remaining items/)
  assert.match(state.htmlContainer.textContent, /Close the app above/)
  assert.equal(state.htmlContainer.querySelector(".pinokio-path-blocker-icon"), null)

  const intervalId = state.getRetryIntervalId()
  state.dismiss()
  const result = await shown
  assert.equal(result.cancelled, true)
  assert.equal(state.intervals.has(intervalId), false)
})

test("path-removal modal reports unattributed EACCES without naming an application", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  const shown = api.show({
    details: {
      causeCode: "EACCES",
      blockers: [],
      remainingCount: 1,
      remaining: ["C:\\runtime\\protected.dll"],
    },
    retry: async () => ({ ok: true }),
  })

  assert.match(state.htmlContainer.textContent, /Windows couldn't remove one remaining item \(EACCES\)/)
  assert.match(state.htmlContainer.textContent, /Check permissions or security software/)
  assert.match(state.htmlContainer.textContent, /Resolve the access issue/)
  assert.doesNotMatch(state.htmlContainer.textContent, /Close the app above/)

  state.dismiss()
  assert.equal((await shown).cancelled, true)
})

test("path-removal request retries automatically without overlapping and resolves on success", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  let requestCount = 0
  let firstRequest
  let resolveRetry
  const retryResponse = new Promise((resolve) => {
    resolveRetry = resolve
  })
  dom.window.fetch = async (url, options) => {
    requestCount += 1
    if (requestCount === 1) firstRequest = { url, options }
    if (requestCount === 1) {
      return response({
        success: false,
        error: {
          code: "PINOKIO_PATH_REMOVE_BLOCKED",
          blockers: [{ name: "First blocker", pid: 10 }],
          remainingCount: 1,
          remaining: ["C:\\runtime\\first.dll"],
        },
      })
    }
    if (requestCount === 2) return await retryResponse
    return response({ ok: true }, { ok: true, status: 200 })
  }
  const resultPromise = api.remove({ type: "bin" })

  await waitFor(() => state.fireOptions, "path-removal modal")
  assert.equal(firstRequest.url, "/pinokio/delete")
  assert.equal(firstRequest.options.method, "post")
  assert.deepEqual(JSON.parse(firstRequest.options.body), { type: "bin" })
  const intervalId = state.getRetryIntervalId()
  assert.equal(state.intervals.get(intervalId).delay, 2000)
  state.htmlContainer.querySelector(".pinokio-path-blocker-files").open = true

  const firstAttempt = state.runInterval()
  assert.equal(state.buttonsDisabled, false)
  assert.equal(state.visible, true)
  await state.runInterval()
  assert.equal(requestCount, 2, "a pending retry must suppress overlapping retries")

  resolveRetry(response({
    success: false,
    error: {
      code: "PINOKIO_PATH_REMOVE_BLOCKED",
      blockers: [{ name: "Second blocker", pid: 20 }],
      remainingCount: 1,
      remaining: ["C:\\runtime\\second.dll"],
    },
  }))
  await firstAttempt
  assert.equal(state.buttonsDisabled, false)
  assert.equal(state.htmlContainer.querySelector(".pinokio-path-blocker-files").open, true)
  assert.match(state.htmlContainer.textContent, /First blocker/)
  assert.doesNotMatch(state.htmlContainer.textContent, /Second blocker/)

  await state.runInterval()
  const result = await resultPromise
  assert.equal(result.ok, true)
  assert.equal(requestCount, 3)
  assert.equal(state.closeCount, 1)
  assert.equal(state.intervals.has(intervalId), false)
  assert.ok(state.clearedIntervals.has(intervalId))
})

test("background blocked response keeps the current modal without rerendering", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  let requestCount = 0
  dom.window.fetch = async () => {
    requestCount += 1
    if (requestCount === 1) {
      return response({
        error: {
          code: "PINOKIO_PATH_REMOVE_BLOCKED",
          blockers: [{ name: "Original blocker", pid: 10 }],
          remainingCount: 1,
          remaining: ["C:\\app\\locked.dll"],
        },
      })
    }
    return response({
      error: {
        code: "PINOKIO_PATH_REMOVE_BLOCKED",
        blockers: [{ name: "Updated blocker", pid: 20 }],
        remainingCount: 1,
        remaining: ["C:\\app\\updated.dll"],
      },
    })
  }
  const shown = api.remove({ name: "app" })

  await waitFor(() => state.fireOptions, "path-removal modal")
  await state.runInterval()
  assert.equal(requestCount, 2)
  assert.equal(state.visible, true)
  assert.match(state.htmlContainer.textContent, /Original blocker/)
  assert.doesNotMatch(state.htmlContainer.textContent, /Updated blocker/)

  state.dismiss()
  assert.equal((await shown).cancelled, true)
})

test("Stop remains available during a background retry and ignores its late response", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  let resolveRetry
  const retryResponse = new Promise((resolve) => {
    resolveRetry = resolve
  })
  const shown = api.show({
    details: {
      blockers: [{ name: "Original blocker", pid: 10 }],
      remainingCount: 1,
      remaining: ["C:\\app\\original.dll"],
    },
    retry: async () => await retryResponse,
  })

  const attempt = state.runInterval()
  assert.equal(state.buttonsDisabled, false)
  assert.equal(state.dismiss(), true)
  resolveRetry({
    code: "PINOKIO_PATH_REMOVE_BLOCKED",
    blockers: [{ name: "Late blocker", pid: 20 }],
    remainingCount: 1,
    remaining: ["C:\\app\\late.dll"],
  })
  await attempt

  assert.equal((await shown).cancelled, true)
  assert.match(state.htmlContainer.textContent, /Original blocker/)
  assert.doesNotMatch(state.htmlContainer.textContent, /Late blocker/)
})

test("manual retry keeps the modal open when blocked and Stop cancels future retries", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  let retryCount = 0
  const shown = api.show({
    details: {
      blockers: [{ name: "Lock holder", pid: 99 }],
      remainingCount: 1,
      remaining: ["C:\\app\\locked.dll"],
    },
    retry: async () => {
      retryCount += 1
      return {
        code: "PINOKIO_PATH_REMOVE_BLOCKED",
        blockers: [{ name: "Lock holder", pid: 99 }],
        remainingCount: 1,
        remaining: ["C:\\app\\locked.dll"],
      }
    },
  })

  assert.equal(await state.fireOptions.preConfirm(), false)
  assert.equal(retryCount, 1)
  assert.equal(state.visible, true)
  assert.equal(state.validationMessage, "Windows still cannot remove the remaining items.")
  assert.equal(state.buttonsDisabled, false)

  const intervalId = state.getRetryIntervalId()
  state.dismiss()
  const result = await shown
  assert.equal(result.cancelled, true)
  assert.equal(state.intervals.has(intervalId), false)
  assert.ok(state.clearedIntervals.has(intervalId))
})

test("manual retry escapes unexpected error messages", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  const shown = api.show({
    details: {
      blockers: [],
      remainingCount: 1,
      remaining: ["C:\\app\\locked.dll"],
    },
    retry: async () => {
      throw new Error('<img src=x onerror="window.compromised=true">')
    },
  })

  assert.equal(await state.fireOptions.preConfirm(), false)
  assert.equal(state.validationMessage, "&lt;img src=x onerror=&quot;window.compromised=true&quot;&gt;")
  assert.equal(state.buttonsDisabled, false)

  state.dismiss()
  assert.equal((await shown).cancelled, true)
})

test("ordinary retry errors keep the modal open", async (t) => {
  const { api, dom, state } = await createHarness()
  t.after(() => dom.window.close())

  const shown = api.show({
    details: {
      blockers: [],
      remainingCount: 1,
      remaining: ["C:\\app\\locked.dll"],
    },
    retry: async () => ({ error: "Cleanup failed" }),
  })

  assert.equal(await state.fireOptions.preConfirm(), false)
  assert.equal(state.visible, true)
  assert.equal(state.validationMessage, "Cleanup failed")

  state.dismiss()
  assert.equal((await shown).cancelled, true)
})

test("successful runtime cleanup resubmits the interrupted install", async (t) => {
  const source = await fs.readFile(installViewPath, "utf8")
  const requirements = '[{"name":"conda"}]'
  const html = ejs.render(source, {
    agent: "web",
    callback: "/tools",
    requirements,
    theme: "dark",
  }, { filename: installViewPath })

  let rpc
  let cleanupPayload
  let submission
  let submitted
  const submittedPromise = new Promise((resolve) => { submitted = resolve })
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/pinokio/install",
    beforeParse(window) {
      window.fetch = async () => ({ json: async () => ({ config: {} }) })
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      window.ResizeObserver = class { observe() {} }
      window.N = class { Noty() {} }
      window.Terminal = class {
        constructor() { this.cols = 80; this.rows = 24 }
        attachCustomKeyEventHandler() {}
        focus() {}
        hasSelection() { return false }
        loadAddon() {}
        onData() {}
        open() {}
        write() {}
      }
      window.FitAddon = { FitAddon: class { fit() {} } }
      window.WebLinksAddon = { WebLinksAddon: class {} }
      window.xtermTheme = { FrontEndDelight: {} }
      window.PinokioTouch = { bindTerminalFocus() {} }
      window.PinokioPathRemoval = {
        show: async ({ retry }) => await retry(),
        tryRemove: async (payload) => {
          cleanupPayload = payload
          return { success: true }
        },
      }
      window.Socket = class {
        emit() {}
        run(request, onpacket) {
          rpc = request
          window.setTimeout(() => onpacket({
            type: "path.remove.blocked",
            data: { code: "PINOKIO_PATH_REMOVE_BLOCKED" },
          }), 0)
        }
      }
      window.HTMLFormElement.prototype.submit = function () {
        submission = {
          method: this.method,
          pathname: new URL(this.action).pathname,
          fields: Object.fromEntries(new window.FormData(this)),
        }
        submitted()
      }
    },
  })
  t.after(() => dom.window.close())

  await submittedPromise
  assert.equal(rpc.params, requirements)
  assert.equal(cleanupPayload.type, "conda-runtime")
  assert.deepEqual(submission, {
    method: "post",
    pathname: "/pinokio/install",
    fields: { requirements, callback: "/tools" },
  })
})

test("fresh install shows removal status and waits for cleanup before starting", async (t) => {
  const source = await fs.readFile(installViewPath, "utf8")
  const html = ejs.render(source, {
    agent: "web",
    callback: "/tools",
    requirements: '[{"name":"conda"}]',
    theme: "dark",
  }, { filename: installViewPath })

  let cleanupStarted = false
  let resolveCleanup
  let socketStarted = false
  const cleanup = new Promise((resolve) => { resolveCleanup = resolve })
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/pinokio/install?fresh=1",
    beforeParse(window) {
      window.fetch = async () => ({ json: async () => ({ config: {} }) })
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      window.ResizeObserver = class { observe() {} }
      window.N = class { Noty() {} }
      window.Terminal = class {
        constructor() { this.cols = 80; this.rows = 24 }
        attachCustomKeyEventHandler() {}
        focus() {}
        hasSelection() { return false }
        loadAddon() {}
        onData() {}
        open() {}
        write() {}
      }
      window.FitAddon = { FitAddon: class { fit() {} } }
      window.WebLinksAddon = { WebLinksAddon: class {} }
      window.xtermTheme = { FrontEndDelight: {} }
      window.PinokioTouch = { bindTerminalFocus() {} }
      window.PinokioPathRemoval = {
        remove: async () => {
          cleanupStarted = true
          return await cleanup
        },
      }
      window.Socket = class {
        emit() {}
        run() { socketStarted = true }
      }
    },
  })
  t.after(() => dom.window.close())

  await waitFor(() => cleanupStarted, "fresh cleanup request")
  assert.match(dom.window.document.querySelector("#status-screen").textContent, /Removing existing tools/)
  assert.match(dom.window.document.querySelector("#status-screen").textContent, /take a minute on Windows/)
  assert.equal(socketStarted, false)

  resolveCleanup({ success: true })
  await waitFor(() => socketStarted, "installer socket")
  assert.match(dom.window.document.querySelector("#status-screen").textContent, /Installing tools/)
})
