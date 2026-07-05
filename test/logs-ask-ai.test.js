const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const root = path.resolve(__dirname, "..")
const logsScriptPath = path.resolve(root, "server/public/logs.js")
const logsTopRedactionScriptPath = path.resolve(root, "server/public/logs-top-redaction.js")

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
          <button id="logs-run-filter" type="button">Redact report</button>
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
          <button data-logs-view="latest" type="button">Issue report</button>
          <button data-logs-view="raw" type="button">Raw logs</button>
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
      window.HTMLElement.prototype.scrollIntoView = function() {}
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

function createRawLogsHtml(topRedactionScript, script) {
  return `<!doctype html>
    <html>
      <body>
        <section id="logs-root">
          <section id="logs-raw-panel">
            <button id="logs-open-log-report" type="button" aria-expanded="false">Generate log report</button>
            <div id="logs-tree"></div>
            <div id="logs-viewer-output"></div>
            <div id="logs-viewer-status"></div>
            <div id="logs-viewer-path"></div>
            <button id="logs-clear-viewer" type="button">Clear</button>
            <input id="logs-autoscroll" type="checkbox">
            <aside id="logs-top-redaction-pane" class="hidden">
              <button id="logs-redaction-collapse" type="button">Collapse</button>
              <div id="logs-top-redaction-status"></div>
              <div id="logs-top-redaction-count"></div>
              <div id="logs-top-redaction-files"></div>
              <div id="logs-top-redaction-filters"></div>
              <div id="logs-top-redaction-list"></div>
              <button id="logs-refresh-tree" type="button">Refresh files</button>
              <button id="logs-redact-top-level" type="button">Redact report</button>
              <button id="logs-generate-archive" type="button">Generate zip</button>
              <a id="logs-download-archive"></a>
              <div id="logs-zip-status"></div>
            </aside>
          </section>
          <section id="logs-latest-panel"></section>
        </section>
        <script>
          window.LOGS_PAGE_DATA = {
            rootDisplay: "~/pinokio/logs",
            downloadUrl: "/pinokio/logs.zip",
            initialView: "raw"
          };
        </script>
        <script>${topRedactionScript}</script>
        <script>${script}</script>
      </body>
    </html>`
}

async function createRawLogsDom(options = {}) {
  const script = await fs.readFile(logsScriptPath, "utf8")
  const topRedactionScript = await fs.readFile(logsTopRedactionScriptPath, "utf8")
  const archiveRequests = []
  const fileRequests = []
  const files = options.files || {
    "system.json": '{ "home": "/Users/alice", "token": "sk-proj-123456789012345678901234" }',
    "stdout.txt": 'Started from /Users/alice/pinokio with token sk-proj-abcdefghijklmnopqrstuvwx',
    "caddy.log": '127.0.0.1 request token sk-proj-caddyshouldnotbesent',
    "caddy-2026-07-02T16-04-26.109.log": '127.0.0.1 request token sk-proj-rotatedcaddyshouldnotbesent'
  }
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    throw error
  })
  const dom = new JSDOM(createRawLogsHtml(topRedactionScript, script), {
    url: "http://127.0.0.1:42000/logs",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false })
      window.HTMLElement.prototype.scrollIntoView = function() {}
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      }
      window.Worker = class {
        constructor() {
          this.listeners = new Map()
        }
        addEventListener(type, callback) {
          this.listeners.set(type, callback)
        }
        postMessage(message) {
          const text = String(message && message.text || "")
          const items = []
          const addItem = (label, value) => {
            const start = text.indexOf(value)
            if (start >= 0) {
              items.push({
                id: items.length,
                label,
                sourceStart: start,
                sourceEnd: start + value.length,
                replacement: `[${label}]`
              })
            }
          }
          addItem("private_path", "/Users/alice")
          const tokenMatch = text.match(/sk-proj-[A-Za-z0-9]+/)
          if (tokenMatch) {
            addItem("private_key", tokenMatch[0])
          }
          setTimeout(() => {
            const listener = this.listeners.get("message")
            if (listener) {
              for (const progress of (options.workerProgress || [])) {
                listener({
                  data: {
                    id: message.id,
                    ...progress
                  }
                })
              }
            }
          }, 0)
          setTimeout(() => {
            const listener = this.listeners.get("message")
            if (listener) {
              listener({
                data: {
                  type: "result",
                  id: message.id,
                  items,
                  counts: {},
                  chunks: 1
                }
              })
            }
          }, options.workerResultDelayMs || 0)
        }
      }
      window.fetch = async (url, options = {}) => {
        const href = String(url)
        const parsed = new URL(href, "http://127.0.0.1:42000")
        if (parsed.pathname === "/api/logs/tree") {
          return jsonResponse({
            entries: Object.entries(files).map(([name, text]) => ({
              name,
              path: name,
              type: "file",
              size: Buffer.byteLength(text)
            })).concat([{ name: "shell", path: "shell", type: "directory" }])
          })
        }
        if (parsed.pathname === "/pinokio/logs/file") {
          const filePath = parsed.searchParams.get("path")
          const tailLines = parsed.searchParams.get("tail_lines")
          fileRequests.push({ path: filePath, tail_lines: tailLines })
          let text = files[filePath] || ""
          if (tailLines) {
            text = text.split(/\r?\n/).slice(-Number(tailLines)).join("\n")
          }
          return jsonResponse({
            path: filePath,
            name: filePath,
            size: Buffer.byteLength(files[filePath] || ""),
            text,
            tail_lines: tailLines || null,
            truncated: Boolean(tailLines)
          })
        }
        if (parsed.pathname === "/pinokio/log") {
          const body = options.body ? JSON.parse(options.body) : {}
          archiveRequests.push(body)
          return jsonResponse({
            success: true,
            download: "/pinokio/logs.zip",
            redacted_overrides: Array.isArray(body.redacted_overrides) ? body.redacted_overrides.length : 0,
            excluded_paths: Array.isArray(body.excluded_paths) ? body.excluded_paths.length : 0
          })
        }
        return jsonResponse({})
      }
    }
  })

  const { window } = dom
  await new Promise((resolve) => window.addEventListener("DOMContentLoaded", resolve, { once: true }))
  return { dom, archiveRequests, fileRequests }
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

test("raw logs redaction sends reviewed top-level overrides when generating zip", async () => {
  const { dom, archiveRequests } = await createRawLogsDom()
  const { document } = dom.window

  document.getElementById("logs-redact-top-level").click()

  await waitFor(() => {
    return !document.getElementById("logs-top-redaction-pane").classList.contains("hidden") &&
      document.getElementById("logs-viewer-output").textContent.includes("[private_path]") &&
      document.getElementById("logs-top-redaction-count").textContent.includes("masked")
  }, "top-level redaction review")

  await waitFor(() => document.getElementById("logs-top-redaction-status").textContent.includes("Report redacted"), "top-level redaction complete")
  const fileModes = Array.from(document.querySelectorAll(".logs-top-redaction-mode"))
  assert.equal(fileModes.length > 0, true)
  assert.equal(fileModes.every((select) => select.disabled === false), true)
  assert.match(document.getElementById("logs-top-redaction-list").textContent, /private_key/)

  document.getElementById("logs-redaction-collapse").click()
  assert.equal(document.getElementById("logs-top-redaction-pane").classList.contains("hidden"), true)

  document.getElementById("logs-generate-archive").click()

  await waitFor(() => archiveRequests.length === 1, "archive request")
  await waitFor(() => /selected files/.test(document.getElementById("logs-zip-status").textContent), "archive ready status")
  assert.equal(archiveRequests[0].require_complete_overrides, true)
  const overrides = archiveRequests[0].redacted_overrides
  assert.equal(Array.isArray(overrides), true)
  assert.deepEqual(overrides.map((entry) => entry.path).sort(), ["stdout.txt", "system.json"])
  const systemOverride = overrides.find((entry) => entry.path === "system.json")
  assert.ok(systemOverride)
  assert.match(systemOverride.text, /\[private_path\]/)
  assert.match(systemOverride.text, /\[private_key\]/)
  assert.equal(systemOverride.text.includes("/Users/alice"), false)
  assert.equal(systemOverride.text.includes("sk-proj-123456789012345678901234"), false)
})

test("raw logs redaction describes model asset progress as loading", async () => {
  const { dom } = await createRawLogsDom({
    workerResultDelayMs: 50,
    workerProgress: [{
      id: null,
      type: "asset-progress",
      loaded: 25,
      total: 100
    }]
  })
  const { document } = dom.window

  document.getElementById("logs-redact-top-level").click()

  await waitFor(() => /Loading privacy filter/.test(document.getElementById("logs-top-redaction-status").textContent), "privacy filter loading status")
  assert.equal(/Downloading privacy filter/.test(document.getElementById("logs-top-redaction-status").textContent), false)
})

test("raw logs redaction shows privacy filter install progress", async () => {
  const { dom } = await createRawLogsDom({
    workerResultDelayMs: 50,
    workerProgress: [{
      id: null,
      type: "cache-install-progress",
      fileIndex: 5,
      totalFiles: 5,
      loaded: 512,
      total: 1024
    }]
  })
  const { document } = dom.window

  document.getElementById("logs-redact-top-level").click()

  await waitFor(() => {
    const status = document.getElementById("logs-top-redaction-status").textContent
    return /Installing privacy filter locally/.test(status) &&
      /5 \/ 5 files/.test(status) &&
      /512 B \/ 1\.0 KB/.test(status)
  }, "privacy filter install progress status")
})

test("raw log report drawer opens with file choices before redaction", async () => {
  const { dom, archiveRequests } = await createRawLogsDom()
  const { document } = dom.window

  document.getElementById("logs-open-log-report").click()

  await waitFor(() => {
    return !document.getElementById("logs-top-redaction-pane").classList.contains("hidden") &&
      document.getElementById("logs-top-redaction-files").textContent.includes("system.json") &&
      document.getElementById("logs-top-redaction-files").textContent.includes("stdout.txt")
  }, "pre-redaction file plan")

  assert.match(document.getElementById("logs-top-redaction-status").textContent, /original logs/)
  assert.match(document.getElementById("logs-top-redaction-count").textContent, /2 selected/)
  assert.match(document.getElementById("logs-top-redaction-list").textContent, /Run Redact report/)
  assert.equal(document.getElementById("logs-top-redaction-files").textContent.includes("caddy.log"), false)
  assert.equal(document.getElementById("logs-generate-archive").disabled, false)
  assert.equal(archiveRequests.length, 0)

  document.getElementById("logs-generate-archive").click()

  await waitFor(() => archiveRequests.length === 1, "unredacted archive request")
  assert.deepEqual(archiveRequests[0], {})
  await waitFor(() => /original logs/.test(document.getElementById("logs-zip-status").textContent), "original archive status")
})

test("raw log report applies excluded files before redaction", async () => {
  const systemLog = Array.from({ length: 600 }, (_, index) => `system line ${index}`).join("\n")
  const { dom, archiveRequests, fileRequests } = await createRawLogsDom({
    files: {
      "system.json": systemLog,
      "state.json": JSON.stringify([{
        state: "snapshot",
        id: "runtime-environment",
        group: "system",
        env: { PATH: "/usr/bin", PINOKIO_HOME: "/Users/alice/pinokio" },
        path: "/Users/alice/pinokio",
        cmd: "pinokio environment snapshot",
        done: true,
        ready: true
      }], null, 2),
      "stdout.txt": 'Started from /Users/alice/pinokio'
    }
  })
  const { document, Event } = dom.window

  document.getElementById("logs-open-log-report").click()

  await waitFor(() => {
    return document.getElementById("logs-top-redaction-files").textContent.includes("state.json")
  }, "pre-redaction file choices")

  const stateMode = document.querySelector('select[aria-label="Report handling for state.json"]')
  assert.ok(stateMode)
  stateMode.value = "exclude"
  stateMode.dispatchEvent(new Event("change", { bubbles: true }))
  const systemMode = document.querySelector('select[aria-label="Report handling for system.json"]')
  assert.ok(systemMode)
  systemMode.value = "tail-500"
  systemMode.dispatchEvent(new Event("change", { bubbles: true }))

  document.getElementById("logs-generate-archive").click()

  await waitFor(() => archiveRequests.length === 1, "configured archive request")
  assert.equal(archiveRequests[0].allow_partial_overrides, true)
  assert.deepEqual(archiveRequests[0].excluded_paths, ["state.json"])
  assert.deepEqual(archiveRequests[0].redacted_overrides.map((entry) => entry.path), ["system.json"])
  const systemRequest = fileRequests.find((request) => request.path === "system.json")
  assert.ok(systemRequest)
  assert.equal(systemRequest.tail_lines, "500")
  const systemOverride = archiveRequests[0].redacted_overrides.find((entry) => entry.path === "system.json")
  assert.match(systemOverride.text, /system line 599/)
  assert.equal(systemOverride.text.includes("system line 0"), false)
  assert.equal(JSON.stringify(archiveRequests[0]).includes("state.json excluded"), false)
})

test("raw log report uses tail mode for oversized top-level files", async () => {
  const filler = "x".repeat(1100)
  const bigStdout = [
    ...Array.from({ length: 2100 }, (_, index) => `line ${index} ${filler}`),
    "tail token sk-proj-tailtoken1234567890 from /Users/alice/pinokio"
  ].join("\n")
  const { dom, fileRequests } = await createRawLogsDom({
    files: {
      "system.json": '{ "home": "/Users/alice" }',
      "stdout.txt": bigStdout,
      "fatal.json": '{"error":"none"}'
    }
  })
  const { document } = dom.window

  document.getElementById("logs-open-log-report").click()

  await waitFor(() => {
    return document.getElementById("logs-top-redaction-files").textContent.includes("Too large") &&
      document.getElementById("logs-top-redaction-files").textContent.includes("Redact last 2000 lines")
  }, "oversized tail file choice")

  document.getElementById("logs-redact-top-level").click()

  await waitFor(() => document.getElementById("logs-top-redaction-list").textContent.includes("private_key"), "tail redaction review")
  const stdoutRequest = fileRequests.find((request) => request.path === "stdout.txt")
  assert.ok(stdoutRequest)
  assert.equal(stdoutRequest.tail_lines, "2000")
})

test("raw log report excludes selected files from reviewed zip", async () => {
  const { dom, archiveRequests } = await createRawLogsDom()
  const { document, Event } = dom.window

  document.getElementById("logs-open-log-report").click()

  await waitFor(() => {
    return document.getElementById("logs-top-redaction-files").textContent.includes("stdout.txt")
  }, "pre-redaction file choices")

  const stdoutMode = document.querySelector('select[aria-label="Report handling for stdout.txt"]')
  assert.ok(stdoutMode)
  stdoutMode.value = "exclude"
  stdoutMode.dispatchEvent(new Event("change", { bubbles: true }))

  document.getElementById("logs-redact-top-level").click()

  await waitFor(() => document.getElementById("logs-top-redaction-status").textContent.includes("Report redacted"), "redaction complete")
  document.getElementById("logs-generate-archive").click()

  await waitFor(() => archiveRequests.length === 1, "archive request")
  assert.equal(archiveRequests[0].require_complete_overrides, true)
  assert.deepEqual(archiveRequests[0].excluded_paths, ["stdout.txt"])
  assert.deepEqual(archiveRequests[0].redacted_overrides.map((entry) => entry.path), ["system.json"])
  assert.equal(JSON.stringify(archiveRequests[0]).includes("stdout.txt excluded"), false)
})
