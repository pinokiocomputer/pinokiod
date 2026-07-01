const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM, VirtualConsole } = require("jsdom")

const repoRoot = path.resolve(__dirname, "..")

function visibleTextMatches(document, selector, text) {
  return Array.from(document.querySelectorAll(selector)).filter((element) => {
    if (element.textContent.trim() !== text) {
      return false
    }
    return !element.closest(".task-hidden")
  })
}

async function renderSharePanel(shareOverrides, options = {}) {
  const script = await fs.readFile(path.join(repoRoot, "server/public/plugin-detail.js"), "utf8")
  const share = {
    manageable: true,
    githubConnected: false,
    gitInitialized: false,
    hasCommit: false,
    remoteUrl: "",
    remoteWebUrl: "",
    hasPublished: false,
    changeCount: 0,
    aheadCount: 0,
    createUrl: "/github/create",
    commitUrl: "/github/commit",
    pushUrl: "/github/push",
    dir: "/tmp/demo-plugin",
    ...shareOverrides,
  }
  const staticClass = share.remoteWebUrl || (share.remoteUrl && share.githubConnected) ? "" : " task-hidden"
  const remoteClass = share.remoteWebUrl ? "" : " task-hidden"
  const refreshClass = share.remoteUrl && share.githubConnected ? "" : " task-hidden"
  const bootstrap = {
    plugin: { title: "Demo Plugin", cwd: "/tmp/demo-plugin", pluginPath: "plugin/demo/pinokio.js" },
    share,
    apps: [],
    stateUrl: "",
  }

  const dom = new JSDOM(`<!doctype html>
<body>
  ${options.actionMarkup || ""}
  <section class="task-side-group">
    <div class="task-section-note" data-plugin-share-note></div>
    <div class="task-share-next-step-main">
      <h3 data-plugin-share-next-title></h3>
      <p data-plugin-share-next-copy></p>
      <div class="task-actions" data-plugin-share-next-actions></div>
    </div>
    <form class="task-share-inline-create task-hidden" data-plugin-share-create-form>
      <input type="text" data-plugin-share-repo-name>
      <select data-plugin-share-visibility><option value="public">Public</option></select>
      <button type="button" data-plugin-share-create-cancel>Cancel</button>
    </form>
    <div class="task-actions plugin-share-static-actions${staticClass}" data-plugin-share-static-actions>
      <a class="task-link-button${remoteClass}" href="${share.remoteWebUrl || "#"}" data-plugin-share-remote-link>
        <span>View on GitHub</span>
      </a>
      <button class="${refreshClass}" type="button" data-plugin-share-refresh><span>Check again</span></button>
    </div>
    <p data-plugin-share-copy></p>
    <div data-plugin-share-feedback hidden></div>
  </section>
  <script id="plugin-detail-bootstrap" type="application/json">${JSON.stringify(bootstrap)}</script>
</body>`, {
    runScripts: "dangerously",
    url: "http://localhost/plugin",
    virtualConsole: options.virtualConsole,
  })

  if (typeof options.beforeScript === "function") {
    options.beforeScript(dom.window)
  }

  const scriptElement = dom.window.document.createElement("script")
  scriptElement.textContent = script
  dom.window.document.body.appendChild(scriptElement)

  return dom.window.document
}

test("plugin detail hides static GitHub actions until a remote exists", async () => {
  const document = await renderSharePanel()
  const staticActions = document.querySelector("[data-plugin-share-static-actions]")

  assert.ok(staticActions.classList.contains("task-hidden"))
  assert.equal(visibleTextMatches(document, "a,button", "Check again").length, 1)
  assert.equal(document.querySelector("[data-plugin-share-note]").textContent, "Setup needed")
})

test("plugin detail shows one static refresh action after a remote exists", async () => {
  const document = await renderSharePanel({
    githubConnected: true,
    gitInitialized: true,
    hasCommit: true,
    remoteUrl: "git@github.com:octocat/demo-plugin.git",
    remoteWebUrl: "https://github.com/octocat/demo-plugin",
    hasPublished: true,
  })
  const staticActions = document.querySelector("[data-plugin-share-static-actions]")

  assert.ok(!staticActions.classList.contains("task-hidden"))
  assert.equal(visibleTextMatches(document, "a,button", "Check again").length, 1)
  assert.equal(visibleTextMatches(document, "a,button", "View on GitHub").length, 1)
  assert.equal(document.querySelector("[data-plugin-share-note]").textContent, "Connected")
})

test("plugin detail keeps refresh available for non-GitHub remotes", async () => {
  const document = await renderSharePanel({
    githubConnected: true,
    gitInitialized: true,
    hasCommit: true,
    remoteUrl: "https://gitlab.com/octocat/demo-plugin.git",
    remoteWebUrl: "",
    hasPublished: true,
  })
  const staticActions = document.querySelector("[data-plugin-share-static-actions]")

  assert.ok(!staticActions.classList.contains("task-hidden"))
  assert.equal(visibleTextMatches(document, "a,button", "Check again").length, 1)
  assert.equal(visibleTextMatches(document, "a,button", "View on GitHub").length, 0)
})

test("plugin detail does not duplicate refresh when auth is disconnected but a remote exists", async () => {
  const document = await renderSharePanel({
    githubConnected: false,
    gitInitialized: true,
    hasCommit: true,
    remoteUrl: "git@github.com:octocat/demo-plugin.git",
    remoteWebUrl: "https://github.com/octocat/demo-plugin",
    hasPublished: true,
  })

  assert.equal(visibleTextMatches(document, "a,button", "Check again").length, 1)
  assert.equal(visibleTextMatches(document, "a,button", "View on GitHub").length, 1)
  assert.equal(document.querySelector("[data-plugin-share-note]").textContent, "Connected")
})

test("plugin action event panel completion closes the modal and refreshes after close", async () => {
  let closeCount = 0
  let fireOptions = null
  let actionIframe = null
  let reloadCount = 0
  const unexpectedJsdomErrors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error) => {
    if (error && /Not implemented: navigation/.test(error.message || "")) {
      reloadCount += 1
      return
    }
    unexpectedJsdomErrors.push(error)
  })
  const document = await renderSharePanel({}, {
    actionMarkup: '<button type="button" data-plugin-action="install">Install</button>',
    virtualConsole,
    beforeScript(window) {
      window.Swal = {
        fire(options) {
          fireOptions = options
          const popup = window.document.createElement("div")
          popup.innerHTML = options.html || ""
          window.document.body.appendChild(popup)
          actionIframe = popup.querySelector("iframe")
          if (typeof options.didOpen === "function") {
            options.didOpen(popup)
          }
          return Promise.resolve({})
        },
        close() {
          closeCount += 1
          if (fireOptions && typeof fireOptions.didClose === "function") {
            fireOptions.didClose()
          }
        },
      }
    },
  })
  const window = document.defaultView

  document.querySelector("[data-plugin-action='install']").click()
  assert.ok(fireOptions)
  assert.match(fireOptions.html, /\/action\/install\/plugin\/demo\/pinokio\.js/)
  assert.match(fireOptions.html, /__pinokio_event_panel=1/)
  assert.ok(actionIframe && actionIframe.contentWindow)

  window.dispatchEvent(new window.MessageEvent("message", {
    origin: window.location.origin,
    data: {
      e: "pinokio:event-panel-status",
      success: true,
    },
  }))
  assert.equal(closeCount, 0)
  assert.equal(reloadCount, 0)

  window.dispatchEvent(new window.MessageEvent("message", {
    origin: window.location.origin,
    source: actionIframe.contentWindow,
    data: {
      e: "pinokio:event-panel-status",
      success: true,
    },
  }))

  assert.equal(closeCount, 1)
  assert.equal(reloadCount, 1)
  assert.deepEqual(unexpectedJsdomErrors, [])
})

test("terminal action view uses generic event panel completion", async () => {
  const terminalView = await fs.readFile(path.join(repoRoot, "server/views/terminal.ejs"), "utf8")
  const disconnectBranchStart = terminalView.indexOf("packet.type === 'disconnect'")
  const eventBranchStart = terminalView.indexOf('packet.type === "event"', disconnectBranchStart)
  const eventBranchEnd = terminalView.indexOf("//this.socket.close()", eventBranchStart)

  assert.ok(disconnectBranchStart >= 0)
  assert.ok(eventBranchStart > disconnectBranchStart)
  assert.ok(eventBranchEnd > eventBranchStart)

  assert.match(terminalView, /pinokio:event-panel-status/)
  assert.match(terminalView.slice(disconnectBranchStart, eventBranchStart), /pinokio:event-panel-status/)
  assert.match(terminalView.slice(eventBranchStart, eventBranchEnd), /eventPanelStopPending = true/)
  assert.doesNotMatch(terminalView.slice(eventBranchStart, eventBranchEnd), /pinokio:event-panel-status/)
  assert.doesNotMatch(terminalView, /pluginActionCompletion/)
  assert.doesNotMatch(terminalView, /pinokio:plugin-action-complete/)
})
