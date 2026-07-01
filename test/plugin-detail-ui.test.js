const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM } = require("jsdom")

const repoRoot = path.resolve(__dirname, "..")

function visibleTextMatches(document, selector, text) {
  return Array.from(document.querySelectorAll(selector)).filter((element) => {
    if (element.textContent.trim() !== text) {
      return false
    }
    return !element.closest(".task-hidden")
  })
}

async function renderSharePanel(shareOverrides) {
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
  })

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
