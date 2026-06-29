const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const root = path.resolve(__dirname, "..")
const logsScriptPath = path.resolve(root, "server/public/logs.js")

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  }
}

function createReportFixture() {
  return {
    app_id: "target",
    title: "Target",
    repo_url: "https://example.test/target.git",
    generated_at: "2026-06-28T22:00:00.000Z",
    markdown: "# Target report\n\nDetails",
    sections: [{
      file: "logs/api/run.js/latest",
      source: "api",
      script: "run.js",
      lines: 1,
      included_lines: 1,
      bytes: 7,
      content: "Details"
    }]
  }
}

function createPluginMenuFixture() {
  return {
    menu: [
      {
        title: "Claude Desktop",
        href: "/pinokio/run/plugin/claude-desktop/pinokio.js",
        image: "/pinokio/asset/plugin/claude-desktop/icon.png",
        category: "ide",
        categoryTitle: "Desktop Plugin",
        pluginPath: "/pinokio/run/plugin/claude-desktop/pinokio.js"
      },
      {
        title: "OpenAI Codex Auto",
        href: "/pinokio/run/plugin/codex-auto/pinokio.js",
        image: "/pinokio/asset/plugin/codex-auto/openai.webp",
        category: "cli",
        categoryTitle: "Terminal Plugin",
        pluginPath: "/pinokio/run/plugin/codex-auto/pinokio.js"
      }
    ]
  }
}

function createLogsHtml(script) {
  return `<!doctype html>
    <html>
      <body>
        <section id="logs-root">
          <button id="logs-copy-report" type="button">Copy</button>
          <button id="logs-refresh-report" type="button">Refresh</button>
          <button id="logs-ask-ai" type="button" disabled>Ask AI</button>
          <button id="logs-create-draft" type="button" disabled>Ask Community</button>
          <input id="logs-draft-title">
          <span id="logs-draft-title-note"></span>
          <button id="logs-run-filter" type="button">Run privacy filter</button>
          <pre id="logs-report-output"></pre>
          <div id="logs-report-status"></div>
          <div id="logs-report-files"></div>
          <div id="logs-report-generated"></div>
          <div id="logs-report-sections"></div>
          <div id="logs-draft-size-badge"></div>
          <div id="logs-draft-meter-fill"></div>
          <div id="logs-draft-status"></div>
          <div id="logs-redaction-list"></div>
          <div id="logs-redaction-filters"></div>
          <div id="logs-redaction-count"></div>
          <button id="logs-generate-archive" type="button">Generate zip</button>
          <a id="logs-download-archive"></a>
          <div id="logs-zip-status"></div>
          <button id="logs-refresh-tree" type="button">Refresh tree</button>
          <div id="logs-tree"></div>
          <div id="logs-viewer-output"></div>
          <div id="logs-viewer-status"></div>
          <div id="logs-viewer-path"></div>
          <button id="logs-clear-viewer" type="button">Clear</button>
          <input id="logs-autoscroll" type="checkbox">
          <button data-logs-view="latest" type="button">Latest</button>
          <button data-logs-view="raw" type="button">Raw</button>
          <section id="logs-latest-panel"></section>
          <section id="logs-raw-panel"></section>
        </section>
        <script>
          window.LOGS_PAGE_DATA = {
            workspace: "target",
            workspaceCwd: "/Users/x/pinokio/api/target",
            reportUrl: "/apps/logs/target/report",
            initialView: "latest"
          };
        </script>
        <script>${script}</script>
      </body>
    </html>`
}

async function createLogsDom(options = {}) {
  const script = await fs.readFile(logsScriptPath, "utf8")
  const parentWindow = options.parentWindow || null
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    throw error
  })

  const dom = new JSDOM(createLogsHtml(script), {
    url: "http://127.0.0.1:42000/logs?workspace=target&embed=1&view=latest",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false })
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      }
      window.fetch = async (url) => {
        if (String(url).startsWith("/apps/logs/target/report")) {
          return jsonResponse(createReportFixture())
        }
        if (String(url).startsWith("/api/plugin/menu")) {
          return jsonResponse(createPluginMenuFixture())
        }
        if (String(url).startsWith("/api/logs/tree")) {
          return jsonResponse({ entries: [] })
        }
        return jsonResponse({})
      }
      if (parentWindow) {
        Object.defineProperty(window, "parent", {
          configurable: true,
          value: parentWindow
        })
      }
    }
  })

  const { window } = dom
  await new Promise((resolve) => window.addEventListener("DOMContentLoaded", resolve, { once: true }))
  await waitFor(() => !window.document.getElementById("logs-ask-ai").disabled, "Ask AI button enabled")
  return { dom }
}

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

test("log Ask AI modal enables Run after assigning the default prompt", async () => {
  const { dom } = await createLogsDom()
  const { window } = dom
  const { document } = window

  window.localStorage.setItem("pinokio.universalLauncher.tool", "pinokio/run/plugin/codex-auto")
  document.getElementById("logs-ask-ai").click()

  await waitFor(() => document.querySelector(".logs-ask-ai-launcher:not([hidden])"), "Ask AI modal")
  const textarea = document.querySelector(".logs-ask-ai-launcher-textarea")
  const trigger = document.querySelector(".logs-ask-ai-tool-trigger")
  const selectedOption = document.querySelector(".logs-ask-ai-tool-sheet-body .universal-launcher-tool.selected")
  const runButton = document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary")

  assert.match(textarea.value, /Investigate what went wrong/)
  assert.equal(document.querySelector(".logs-ask-ai-tool-select"), null)
  assert.equal(trigger.querySelector(".universal-launcher-tool-trigger-label").textContent, "OpenAI Codex Auto")
  assert.equal(trigger.querySelector(".universal-launcher-tool-trigger-meta").textContent, "Terminal")
  assert.equal(selectedOption.querySelector(".universal-launcher-tool-label").textContent, "OpenAI Codex Auto")
  assert.equal(runButton.disabled, false)
})

test("log Ask AI modal uses custom plugin sheet and closes it before the modal", async () => {
  const { dom } = await createLogsDom()
  const { window } = dom
  const { document } = window

  document.getElementById("logs-ask-ai").click()
  await waitFor(() => document.querySelector(".logs-ask-ai-launcher:not([hidden])"), "Ask AI modal")

  const trigger = document.querySelector(".logs-ask-ai-tool-trigger")
  const sheet = document.querySelector(".logs-ask-ai-tool-sheet-layer")
  assert.equal(sheet.hidden, true)
  assert.equal(document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary").disabled, true)

  trigger.click()
  assert.equal(sheet.hidden, false)
  assert.equal(trigger.getAttribute("aria-expanded"), "true")
  assert.deepEqual(
    Array.from(document.querySelectorAll(".logs-ask-ai-tool-sheet-body .universal-launcher-tool-group-title")).map((node) => node.textContent),
    ["Terminal", "Desktop"]
  )

  const claudeOption = Array.from(document.querySelectorAll(".logs-ask-ai-tool-sheet-body .universal-launcher-tool"))
    .find((option) => option.querySelector(".universal-launcher-tool-label").textContent === "Claude Desktop")
  assert.ok(claudeOption)
  claudeOption.click()

  assert.equal(sheet.hidden, true)
  assert.equal(trigger.querySelector(".universal-launcher-tool-trigger-label").textContent, "Claude Desktop")
  assert.equal(window.localStorage.getItem("pinokio.universalLauncher.tool"), "pinokio/run/plugin/claude-desktop")
  assert.equal(document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary").disabled, false)

  trigger.click()
  assert.equal(sheet.hidden, false)
  document.querySelector(".logs-ask-ai-launcher").dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true
  }))
  assert.equal(sheet.hidden, true)
  assert.equal(document.querySelector(".logs-ask-ai-launcher").hidden, false)
})

test("log Ask AI launch calls a same-origin parent drawer before postMessage fallback", async () => {
  const opened = []
  const posted = []
  const parentWindow = {
    PinokioAskAiDrawer: {
      openWithAgent(payload) {
        opened.push(payload)
        return true
      }
    },
    postMessage(payload) {
      posted.push(payload)
    }
  }
  const { dom } = await createLogsDom({ parentWindow })
  const { window } = dom
  const { document } = window

  window.localStorage.setItem("pinokio.universalLauncher.tool", "pinokio/run/plugin/codex-auto")
  document.getElementById("logs-ask-ai").click()
  await waitFor(() => {
    const runButton = document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary")
    return runButton && runButton.disabled === false
  }, "enabled Run button")

  document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary").click()

  await waitFor(() => document.querySelector(".logs-ask-ai-launcher").hidden, "modal close after direct parent launch")
  assert.equal(opened.length, 1)
  assert.equal(posted.length, 0)
  assert.equal(opened[0].agentHref.includes("/pinokio/run/plugin/codex-auto/pinokio.js"), true)
  assert.equal(opened[0].agentHref.includes("prompt="), true)
  assert.equal(document.querySelector(".logs-ask-ai-launcher").hidden, true)
})

test("log Ask AI launch waits for parent postMessage acknowledgement before closing", async () => {
  let childWindow = null
  const posted = []
  const parentWindow = {
    postMessage(payload) {
      posted.push(payload)
      childWindow.dispatchEvent(new childWindow.MessageEvent("message", {
        data: {
          e: "pinokio:ask-ai-launch-result",
          launchId: payload.launchId,
          opened: true
        },
        origin: "http://127.0.0.1:42000"
      }))
    }
  }
  const { dom } = await createLogsDom({ parentWindow })
  childWindow = dom.window
  const { window } = dom
  const { document } = window

  window.localStorage.setItem("pinokio.universalLauncher.tool", "pinokio/run/plugin/codex-auto")
  document.getElementById("logs-ask-ai").click()
  await waitFor(() => {
    const runButton = document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary")
    return runButton && runButton.disabled === false
  }, "enabled Run button")

  document.querySelector(".logs-ask-ai-launcher .universal-launcher-button-primary").click()

  await waitFor(() => document.querySelector(".logs-ask-ai-launcher").hidden, "modal close after acknowledged launch")
  assert.equal(posted.length, 1)
  assert.equal(Boolean(posted[0].launchId), true)
  assert.equal(posted[0].agentHref.includes("/pinokio/run/plugin/codex-auto/pinokio.js"), true)
})
