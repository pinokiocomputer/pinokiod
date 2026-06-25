const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")
const statusClientPath = path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs")

async function renderStatusClient() {
  const template = await fs.readFile(statusClientPath, "utf8")
  return ejs.render(template, {
    name: "target",
    config: { title: "Target" },
    launch_requirements_status_enabled: true
  }, {
    filename: statusClientPath
  })
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
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

test("launch requirements stop clears local status instead of rendering a stopped acknowledgement", async () => {
  const script = await renderStatusClient()
  const status = {
    state: "waiting",
    requirements: [
      {
        id: "helper",
        title: "Helper",
        state: "starting",
        script: "start.js",
        icon: "/pinokio-black.png"
      },
      {
        id: "middle",
        title: "Middle",
        state: "waiting",
        waiting_for: ["helper"],
        icon: "/pinokio-black.png"
      }
    ]
  }

  let socketCallback = null
  let cancelPosts = 0
  let refreshCalls = 0
  const dom = new JSDOM(`<!doctype html>
    <main>
      <div data-launch-requirements-status hidden></div>
    </main>
    <script>${script}</script>
  `, {
    url: "http://127.0.0.1/app",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.Socket = function Socket() {
        this.run = function run(_options, callback) {
          socketCallback = callback
          return Promise.resolve()
        }
        this.close = function close() {}
      }
      window.refresh = function refresh() {
        refreshCalls += 1
      }
      window.fetch = async function fetch(url, options = {}) {
        if (String(url).includes("/cancel") && options.method === "POST") {
          cancelPosts += 1
          return jsonResponse({ ok: true, cancelled: true })
        }
        return jsonResponse({ ok: true, status })
      }
    }
  })

  const { document } = dom.window
  const statusRoot = document.querySelector("[data-launch-requirements-status]")
  await waitFor(() => statusRoot.textContent.includes("Preparing required apps"), "initial preparation render")

  document.querySelector("[data-launch-requirements-stop]").click()
  await waitFor(() => statusRoot.hidden === true, "status card to clear")

  assert.equal(cancelPosts, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(statusRoot.hidden, true)
  assert.doesNotMatch(statusRoot.textContent, /Launch stopped/)
  assert.doesNotMatch(statusRoot.textContent, /Stopped/)

  socketCallback({
    type: "launch.requirements",
    data: { status: null }
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(statusRoot.hidden, true)
  assert.doesNotMatch(statusRoot.textContent, /Launch stopped/)

  socketCallback({
    type: "launch.requirements",
    data: {
      status: {
        state: "waiting",
        requirements: [{
          id: "other",
          title: "Other",
          state: "starting",
          script: "other.js"
        }]
      }
    }
  })
  await waitFor(() => statusRoot.textContent.includes("Preparing required apps"), "new status replaces acknowledgement")

  assert.doesNotMatch(statusRoot.textContent, /Launch stopped/)
  assert.match(statusRoot.textContent, /Other/)
})
