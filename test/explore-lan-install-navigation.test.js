const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const commonScriptPath = path.resolve(__dirname, "../server/public/common.js")
const exploreTemplatePath = path.resolve(__dirname, "../server/views/explore.ejs")

async function createHarness(
  url = "http://192.168.1.50:42000/home?mode=explore",
  frameUrl = "https://pinokio.co/?embed=1&theme=dark",
) {
  const source = await fs.readFile(commonScriptPath, "utf8")
  const virtualConsole = new VirtualConsole()
  const navigationErrors = []
  virtualConsole.on("jsdomError", (error) => {
    if (error && /Not implemented: navigation/.test(error.message || "")) {
      navigationErrors.push(error)
      return
    }
    throw error
  })
  const dom = new JSDOM('<!doctype html><body><main><iframe name="pinokio-explore"></iframe></main></body>', {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url,
    virtualConsole,
    beforeParse(window) {
      const NativeURL = window.URL
      window.__pinokioConstructedUrls = []
      window.URL = class extends NativeURL {
        constructor(value, base) {
          super(value, base)
          window.__pinokioConstructedUrls.push(this.toString())
        }
      }
      window.fetch = async () => ({ ok: true, json: async () => ({}) })
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      }
    },
  })
  const script = dom.window.document.createElement("script")
  script.textContent = source
  dom.window.document.body.appendChild(script)
  const frame = dom.window.document.querySelector("iframe")
  frame.src = frameUrl
  frame.focus()
  assert.equal(dom.window.document.activeElement, frame)
  return { dom, frame, navigationErrors }
}

function navigate(dom, frame, target, options = {}) {
  dom.window.__pinokioConstructedUrls.length = 0
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { e: "pinokio:navigate", url: target },
    origin: options.origin || "https://pinokio.co",
    source: options.source === undefined ? frame.contentWindow : options.source,
  }))
}

function assertParentNavigation(dom, frame, navigationErrors, originalFrameUrl, expectedUrl) {
  assert.ok(dom.window.__pinokioConstructedUrls.includes(expectedUrl))
  assert.equal(navigationErrors.length, 1)
  assert.equal(frame.src, originalFrameUrl)
}

test("Explore uses a stable frame identity instead of the launcher schema", async () => {
  const source = await fs.readFile(exploreTemplatePath, "utf8")

  assert.equal(source.match(/name="pinokio-explore"/g)?.length, 2)
  assert.doesNotMatch(source, /name="<%=schema%>"/)
})

test("LAN Explore trusts the configured registry origin", async (t) => {
  const { dom, frame, navigationErrors } = await createHarness(
    undefined,
    "https://beta.pinokio.co/?embed=1&theme=dark",
  )
  t.after(() => dom.window.close())
  const originalFrameUrl = frame.src

  navigate(
    dom,
    frame,
    "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo&path=api&branch=dev",
    { origin: "https://beta.pinokio.co" },
  )

  assertParentNavigation(
    dom,
    frame,
    navigationErrors,
    originalFrameUrl,
    "http://192.168.1.50:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo&path=api&branch=dev",
  )
})

test("LAN Explore handles registry installs when mobile Safari leaves the parent body focused", async (t) => {
  const { dom, frame, navigationErrors } = await createHarness()
  t.after(() => dom.window.close())
  const originalFrameUrl = frame.src
  dom.window.document.body.tabIndex = -1
  dom.window.document.body.focus()
  assert.equal(dom.window.document.activeElement, dom.window.document.body)

  navigate(dom, frame, "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo&path=api")

  assertParentNavigation(
    dom,
    frame,
    navigationErrors,
    originalFrameUrl,
    "http://192.168.1.50:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo&path=api",
  )
})

test("LAN Explore rebases valid checkpoint installs onto the Home Server origin", async (t) => {
  const { dom, frame, navigationErrors } = await createHarness()
  t.after(() => dom.window.close())
  const originalFrameUrl = frame.src
  const hash = `sha256%3A${"a".repeat(64)}`

  navigate(dom, frame, `http://localhost:42000/checkpoints?registry=https%3A%2F%2Fapi.pinokio.co&hash=${hash}&path=api`)

  assertParentNavigation(
    dom,
    frame,
    navigationErrors,
    originalFrameUrl,
    `http://192.168.1.50:42000/checkpoints?registry=https%3A%2F%2Fapi.pinokio.co&hash=${hash}&path=api`,
  )
})

test("localhost Explore replaces itself for registry installs instead of nesting Pinokio", async (t) => {
  const { dom, frame, navigationErrors } = await createHarness("http://localhost:42000/home?mode=explore")
  t.after(() => dom.window.close())
  const originalFrameUrl = frame.src
  const target = "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo&path=api"

  navigate(dom, frame, target)

  assertParentNavigation(dom, frame, navigationErrors, originalFrameUrl, target)
})

const blockedCases = [
  ["unrelated local route", "http://localhost:42000/tasker?vars=url", {}],
  ["download without a URI", "http://localhost:42000/pinokio/download", {}],
  ["checkpoint with an invalid hash", "http://localhost:42000/checkpoints?registry=https%3A%2F%2Fapi.pinokio.co&hash=abc", {}],
  ["different message origin", "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo", { origin: "https://example.com" }],
  ["different message source", "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo", { source: null }],
]

for (const [label, target, options] of blockedCases) {
  test(`LAN Explore leaves ${label} blocked`, async (t) => {
    const { dom, frame } = await createHarness()
    t.after(() => dom.window.close())
    const original = frame.src

    navigate(dom, frame, target, options)

    assert.equal(frame.src, original)
  })
}

test("the additive branch does not run outside Explore", async (t) => {
  const { dom, frame } = await createHarness("http://192.168.1.50:42000/home")
  t.after(() => dom.window.close())
  const original = frame.src

  navigate(dom, frame, "http://localhost:42000/pinokio/download?uri=https%3A%2F%2Fgithub.com%2Facme%2Fdemo")

  assert.equal(frame.src, original)
})

test("localhost keeps the existing same-origin navigation behavior", async (t) => {
  const { dom, frame } = await createHarness("http://localhost:42000/home?mode=explore")
  t.after(() => dom.window.close())

  navigate(dom, frame, "http://localhost:42000/existing-local-route?value=1")

  assert.equal(frame.src, "http://localhost:42000/existing-local-route?value=1")
})

test("LAN keeps the existing same-origin navigation behavior", async (t) => {
  const { dom, frame } = await createHarness()
  t.after(() => dom.window.close())

  navigate(dom, frame, "http://192.168.1.50:42000/existing-lan-route?value=1")

  assert.equal(frame.src, "http://192.168.1.50:42000/existing-lan-route?value=1")
})
