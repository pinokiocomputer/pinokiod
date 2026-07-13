const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const root = path.resolve(__dirname, "..")
const popoverPath = path.join(root, "server/views/partials/home_server_popover.ejs")
const assetsPath = path.join(root, "server/views/partials/home_server_popover_assets.ejs")

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

async function createHarness() {
  const [popover, assets] = await Promise.all([
    fs.readFile(popoverPath, "utf8"),
    fs.readFile(assetsPath, "utf8")
  ])
  const scriptStart = assets.indexOf("<script>")
  const scriptEnd = assets.lastIndexOf("</script>")
  assert.notEqual(scriptStart, -1)
  assert.notEqual(scriptEnd, -1)
  const script = assets.slice(scriptStart + "<script>".length, scriptEnd)

  const state = {
    interval: null,
    payload: {
      status: "on",
      apps: [{
        id: "maestro",
        name: "Maestro",
        url: "",
        state: "starting"
      }],
      routes: [{
        name: "Syncthing",
        url: "http://192.168.1.10:42006"
      }]
    }
  }

  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    throw error
  })

  const dom = new JSDOM(`<!doctype html><body>${popover}<script>${script}</script></body>`, {
    url: "http://127.0.0.1:42000/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = async () => ({
        ok: true,
        json: async () => JSON.parse(JSON.stringify(state.payload))
      })
      window.setInterval = (callback, delay) => {
        state.interval = { callback, delay }
        return 1
      }
      window.clearInterval = () => {
        state.interval = null
      }
    }
  })

  await waitFor(
    () => dom.window.document.querySelector('[data-home-server-qr="http://192.168.1.10:42006"]'),
    "initial Home Server content"
  )

  return { dom, state }
}

test("Home Server polling refreshes content without closing an open QR preview", async (t) => {
  const { dom, state } = await createHarness()
  t.after(() => dom.window.close())
  const { document } = dom.window
  const panel = document.querySelector("[data-home-server-panel]")
  const panelContent = document.querySelector("[data-home-server-content]")
  const trigger = document.querySelector("[data-home-server-trigger]")

  trigger.click()
  await waitFor(() => state.interval, "Home Server polling")

  const qrButton = panelContent.querySelector('[data-home-server-qr="http://192.168.1.10:42006"]')
  qrButton.click()
  const preview = panel.querySelector("[data-home-server-qr-preview]")
  assert.ok(preview)
  assert.equal(document.activeElement, preview.querySelector("[data-home-server-qr-close]"))

  state.payload.routes[0].name = "Syncthing refreshed"
  await state.interval.callback()

  assert.equal(panel.querySelector("[data-home-server-qr-preview]"), preview)
  assert.equal(qrButton.isConnected, false)
  assert.match(panelContent.textContent, /Syncthing refreshed/)

  preview.querySelector("[data-home-server-qr-close]").click()
  const refreshedQrButton = panelContent.querySelector('[data-home-server-qr="http://192.168.1.10:42006"]')
  assert.equal(panel.querySelector("[data-home-server-qr-preview]"), null)
  assert.equal(document.activeElement, refreshedQrButton)
})
