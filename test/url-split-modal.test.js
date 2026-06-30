const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const root = path.resolve(__dirname, "..")
const dropdownScriptPath = path.resolve(root, "server/public/urldropdown.js")

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload
  }
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

async function createDropdownDom() {
  const script = await fs.readFile(dropdownScriptPath, "utf8")
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    throw error
  })

  const dom = new JSDOM(`<!doctype html>
    <html>
      <head><title>Current app</title></head>
      <body>
        <form class="urlbar"><input type="url"></form>
        <div id="url-dropdown"></div>
        <script>${script}</script>
      </body>
    </html>`, {
    url: "http://127.0.0.1:42000/p/current",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = async (url) => {
        if (String(url).includes("/info/apps")) {
          return jsonResponse({
            apps: [
              { name: "MMAudio", title: "MMAudio" },
              { name: "AllTalk-TTS", title: "AllTalk-TTS v2" }
            ]
          })
        }
        if (String(url).includes("/info/procs")) {
          return jsonResponse({ info: [] })
        }
        return jsonResponse({})
      }
    }
  })

  const { window } = dom
  await new Promise((resolve) => window.addEventListener("DOMContentLoaded", resolve, { once: true }))
  window.initUrlDropdown()
  return dom
}

test("split URL modal uses inline submit and omits Files actions", async () => {
  const dom = await createDropdownDom()
  const { window } = dom
  const { document } = window

  const selection = window.PinokioUrlDropdown.openSplitModal({
    title: "Split Into Columns",
    description: "Choose a running process or use the current tab URL for the new pane.",
    confirmLabel: "Open in pane"
  })

  await waitFor(() => document.querySelector(".url-modal-content.split-mode .url-mode-button"), "split modal app rows")

  const overlay = document.getElementById("url-modal-overlay")
  const content = document.querySelector(".url-modal-content")
  const inlineSubmit = document.querySelector(".url-modal-inline-submit")
  const actions = document.querySelector(".url-modal-actions")
  const modeLabels = Array.from(document.querySelectorAll(".url-modal-content.split-mode .url-mode-button span"))
    .map((node) => node.textContent)

  assert.equal(overlay.classList.contains("split-mode"), true)
  assert.equal(content.classList.contains("split-mode"), true)
  assert.equal(inlineSubmit.textContent, "Open in pane")
  assert.ok(actions)
  assert.deepEqual([...new Set(modeLabels)].sort(), ["Dev", "Run"])
  assert.doesNotMatch(content.textContent, /\bFiles\b/)

  const input = document.querySelector(".url-modal-input")
  input.value = "http://localhost:7860"
  input.dispatchEvent(new window.Event("input", { bubbles: true }))
  assert.equal(inlineSubmit.disabled, false)
  inlineSubmit.click()

  assert.equal(await selection, "/container?url=http%3A%2F%2Flocalhost%3A7860")
})
