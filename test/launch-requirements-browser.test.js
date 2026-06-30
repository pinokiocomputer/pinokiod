const assert = require("node:assert/strict")
const fsSync = require("node:fs")
const fs = require("node:fs/promises")
const http = require("node:http")
const path = require("node:path")
const childProcess = require("node:child_process")
const test = require("node:test")
const ejs = require("ejs")

function loadPlaywright() {
  try {
    return require("playwright")
  } catch (_) {}

  try {
    const bin = childProcess.execFileSync("which", ["playwright"], { encoding: "utf8" }).trim()
    if (!bin) {
      return null
    }
    return require(path.join(path.dirname(path.dirname(bin)), "playwright"))
  } catch (_) {
    return null
  }
}

const playwright = loadPlaywright()

const root = path.resolve(__dirname, "..")
const appViewPath = path.resolve(root, "server/views/app.ejs")
const autolaunchViewPath = path.resolve(root, "server/views/autolaunch.ejs")
const statusClientPath = path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs")
const homeViewPath = path.resolve(root, "server/views/index.ejs")

const browserTest = test

function chromiumExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    playwright && playwright.chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean)
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || ""
}

async function renderAppAutolaunchScript(initialState) {
  const view = await fs.readFile(appViewPath, "utf8")
  const start = view.indexOf(';(function() {\n  const root = document.querySelector("[data-app-autolaunch]")')
  assert.notEqual(start, -1)
  const end = view.indexOf('\n\n;(function() {\n  const scroller = document.querySelector(".appcanvas > aside .menu-scroller")', start)
  assert.notEqual(end, -1)
  return ejs.render(view.slice(start, end), {
    autolaunch_app: initialState
  }, {
    filename: appViewPath
  })
}

async function renderGlobalAutolaunchScript(state) {
  const view = await fs.readFile(autolaunchViewPath, "utf8")
  const start = view.indexOf("<script>\nlet autolaunchApps =")
  assert.notEqual(start, -1)
  const end = view.indexOf("\n</script>", start)
  assert.notEqual(end, -1)
  return ejs.render(view.slice(start + "<script>".length, end), {
    appsJson: JSON.stringify([state.targetApp])
  }, {
    filename: autolaunchViewPath
  })
}

async function renderLaunchRequirementsStatusClient(enabled) {
  const template = await fs.readFile(statusClientPath, "utf8")
  return ejs.render(template, {
    name: "target",
    config: { title: "Target" },
    launch_requirements_status_enabled: !!enabled
  }, {
    filename: statusClientPath
  })
}

async function renderHomeAutolaunchScript() {
  const view = await fs.readFile(homeViewPath, "utf8")
  const start = view.indexOf("const startHomeAutolaunchPolling = () => {")
  assert.notEqual(start, -1)
  const call = view.indexOf("startHomeAutolaunchPolling()", start)
  assert.notEqual(call, -1)
  return ejs.render(view.slice(start, call + "startHomeAutolaunchPolling()".length), {
    launch_complete: false
  }, {
    filename: homeViewPath
  })
}

function html(body, script = "") {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          .hidden, [hidden] { display: none !important; }
          body { font-family: sans-serif; }
          .app-autolaunch-modal { position: fixed; inset: 20px; background: white; border: 1px solid #ccc; padding: 16px; }
          .app-autolaunch-script-option, .app-autolaunch-dependency-option, .app-autolaunch-dependency-row { display: block; margin: 6px 0; }
          .transformed-sidebar-fixture { display: flex; width: 100%; min-height: 520px; }
          .transformed-sidebar-fixture > aside { width: 280px; flex: 0 0 280px; transform: translateX(0); }
          .transformed-sidebar-fixture > main { flex: 1 1 auto; }
          .launch-requirements-card { width: 560px; margin: 40px auto; }
          .launch-requirements-row { display: grid; grid-template-columns: 32px 1fr auto; gap: 8px; align-items: center; }
        </style>
      </head>
      <body>
        ${body}
        <script>${script}</script>
      </body>
    </html>`
}

function appAutolaunchMarkup(initialApp) {
  return `
    <div class="app-autolaunch" data-app-autolaunch data-app-id="target">
      <button type="button" class="app-autolaunch-row" data-app-autolaunch-button data-enabled="${initialApp.autolaunch_enabled ? "true" : "false"}" aria-haspopup="dialog" aria-expanded="false">
        <span class="app-autolaunch-label">Autolaunch</span>
        <span class="app-autolaunch-status" data-app-autolaunch-status>${initialApp.autolaunch_enabled ? "ON" : "OFF"}</span>
      </button>
      <div class="app-autolaunch-modal hidden" data-app-autolaunch-modal role="dialog" aria-modal="true" aria-label="Autolaunch">
        <button type="button" class="app-autolaunch-switch" role="switch" aria-checked="${initialApp.autolaunch_enabled ? "true" : "false"}" data-app-autolaunch-switch aria-label="Start with Pinokio">
          <span data-app-autolaunch-switch-label>${initialApp.autolaunch_enabled ? "ON" : "OFF"}</span>
        </button>
        <button type="button" data-app-autolaunch-close>Close</button>
        <section>
          <div data-app-autolaunch-scripts></div>
        </section>
        <section>
          <div data-app-autolaunch-dependencies></div>
        </section>
        <div data-app-autolaunch-feedback></div>
      </div>
    </div>
  `
}

async function appFixtureHtml(initialApp) {
  const script = await renderAppAutolaunchScript(initialApp)
  return html(appAutolaunchMarkup(initialApp), script)
}

async function transformedSidebarAppFixtureHtml(initialApp) {
  const script = await renderAppAutolaunchScript(initialApp)
  return html(`
    <div class="appcanvas transformed-sidebar-fixture">
      <aside>
        ${appAutolaunchMarkup(initialApp)}
      </aside>
      <main></main>
    </div>
  `, script)
}

async function globalAutolaunchFixtureHtml(state) {
  const script = await renderGlobalAutolaunchScript(state)
  return html(`
    <main class="autolaunch-page">
      <strong data-enabled-count>0</strong>
      <strong data-app-count>1</strong>
      <button type="button" data-disable-all disabled>Disable startup</button>
      <input type="search" data-app-search>
      <div data-app-list></div>
      <section data-detail></section>
    </main>
  `, script)
}

async function openWithoutLaunchingHtml() {
  const script = await renderLaunchRequirementsStatusClient(false)
  return html(`
    <main>
      <div data-launch-requirements-status hidden></div>
      <div data-open-without-launching-content>Opened without launching.</div>
    </main>
  `, `
    window.Socket = function Socket() {
      throw new Error("Socket must not start for open without launching")
    };
    ${script}
  `)
}

async function statusFixtureHtml() {
  const script = await renderLaunchRequirementsStatusClient(true)
  return html(`
    <main>
      <div data-launch-requirements-status hidden></div>
    </main>
  `, `
    window.Socket = function Socket() {
      this.run = function() { return Promise.resolve() }
      this.close = function() {}
    };
    ${script}
  `)
}

async function homeFixtureHtml() {
  const script = await renderHomeAutolaunchScript()
  return html(`
    <script>
      window.reorderHomeSectionsByPreference = function() {};
    </script>
    <div class="running-apps"></div>
    <div class="not-running-apps">
      <div class="line align-top home-app-line" data-autolaunch-app="target" data-autolaunch-starting="0" data-autolaunch-script="start.js">
        <h3><span class="title"><i class="fa-solid fa-circle"></i></span><span>Target</span></h3>
        <div class="menu-btns">
          <button class="open-actions-modal" data-dialog-id="actions-target" type="button">menu</button>
        </div>
      </div>
    </div>
    <div id="actions-target"><div class="home-actions-title-row"></div></div>
  `, script)
}

function createJsonResponse(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

async function startFixtureServer(state) {
  const pages = {
    app: await appFixtureHtml(state.targetApp),
    transformedApp: await transformedSidebarAppFixtureHtml(state.targetApp),
    autolaunch: await globalAutolaunchFixtureHtml(state),
    openWithoutLaunching: await openWithoutLaunchingHtml(),
    status: await statusFixtureHtml(),
    home: await homeFixtureHtml()
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1")
      if (req.method === "GET" && url.pathname === "/app-fixture") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.app)
        return
      }
      if (req.method === "GET" && url.pathname === "/app-transformed-sidebar-fixture") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.transformedApp)
        return
      }
      if (req.method === "GET" && url.pathname === "/autolaunch-fixture") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.autolaunch)
        return
      }
      if (req.method === "GET" && url.pathname === "/open-without-launching") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.openWithoutLaunching)
        return
      }
      if (req.method === "GET" && url.pathname === "/status-fixture") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.status)
        return
      }
      if (req.method === "GET" && url.pathname === "/home-fixture") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(pages.home)
        return
      }
      if (req.method === "GET" && url.pathname === "/autolaunch/candidates") {
        const appId = url.searchParams.get("app")
        state.candidateRequests.push(appId)
        const payload = state.candidates[appId]
        createJsonResponse(res, payload ? 200 : 404, payload || { ok: false, error: "missing app" })
        return
      }
      if (req.method === "POST" && url.pathname === "/autolaunch") {
        const body = await readBody(req)
        state.autolaunchPosts.push(body)
        const app = {
          id: body.app,
          title: body.app === "helper" ? "Helper" : "Target",
          autolaunch: body.clear_script ? "" : (body.script || ""),
          autolaunch_enabled: !!body.enabled,
          autolaunch_depends: body.app === "target" ? state.targetDependencies.slice() : []
        }
        if (state.candidates.target && Array.isArray(state.candidates.target.dependency_apps)) {
          state.candidates.target.dependency_apps = state.candidates.target.dependency_apps.map((candidate) => {
            return candidate.id === app.id ? Object.assign({}, candidate, app) : candidate
          })
        }
        if (body.app === "target") {
          state.targetApp = Object.assign({}, state.targetApp, app)
          if (state.candidates.target) {
            state.candidates.target.current = app.autolaunch
            state.candidates.target.app = Object.assign({}, state.candidates.target.app, app)
          }
        }
        createJsonResponse(res, 200, { ok: true, app })
        return
      }
      if (req.method === "POST" && url.pathname === "/autolaunch/dependencies") {
        const body = await readBody(req)
        state.dependencyPosts.push(body)
        state.targetDependencies = Array.isArray(body.dependencies) ? body.dependencies.slice() : []
        const app = Object.assign({}, state.targetApp, {
          autolaunch_depends: state.targetDependencies.slice()
        })
        createJsonResponse(res, 200, { ok: true, app })
        return
      }
      if (req.method === "GET" && url.pathname.startsWith("/pinokio/launch-requirements/")) {
        state.launchRequirementsGets += 1
        createJsonResponse(res, 200, {
          ok: true,
          status: state.launchRequirementsStatus || {
            state: "waiting",
            requirements: [{ id: "helper", title: "Helper", state: "starting", script: "start.js" }]
          }
        })
        return
      }
      if (req.method === "GET" && url.pathname === "/pinokio/home_status") {
        state.homeStatusGets += 1
        createJsonResponse(res, 200, state.homeStatus)
        return
      }
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("not found")
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" })
      res.end(error && error.stack ? error.stack : String(error))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  }
}

function baseState(options = {}) {
  const targetScript = options.targetScript || ""
  const targetApp = {
    id: "target",
    title: "Target",
    autolaunch: targetScript,
    autolaunch_enabled: false,
    autolaunch_depends: []
  }
  const helperScript = Object.prototype.hasOwnProperty.call(options, "helperScript")
    ? options.helperScript
    : "start.js"
  return {
    targetApp,
    targetDependencies: [],
    candidateRequests: [],
    autolaunchPosts: [],
    dependencyPosts: [],
    launchRequirementsGets: 0,
    homeStatusGets: 0,
    homeStatus: {
      launch_complete: true,
      running_apps: [],
      running_scripts: [],
      autolaunch: { apps: {} }
    },
    candidates: {
      target: {
        ok: true,
        current: targetScript,
        app: Object.assign({}, targetApp),
        menu: [{ script: "start.js", label: "Start", menu_default: true }],
        other: [{ script: "target.custom.js", label: "Custom" }],
        dependency_apps: [{
          id: "helper",
          title: "Helper",
          workspace_path: "/Users/test/pinokio/api/helper",
          icon: "/helper.png",
          autolaunch: helperScript,
          autolaunch_enabled: false
        }]
      },
      helper: {
        ok: true,
        current: helperScript,
        app: {
          id: "helper",
          title: "Helper",
          autolaunch: helperScript,
          autolaunch_enabled: false,
          autolaunch_depends: []
        },
        menu: [{ script: "start.js", label: "Start", menu_default: true }],
        other: [{ script: "helper.custom.js", label: "Custom" }],
        dependency_apps: []
      }
    }
  }
}

async function withBrowser(state, callback) {
  assert.ok(playwright, "Playwright is required. Run: npx -y -p playwright node --test test/launch-requirements-browser.test.js")
  const { server, baseUrl } = await startFixtureServer(state)
  let browser = null
  let page = null
  const errors = []
  try {
    const executablePath = chromiumExecutablePath()
    assert.ok(executablePath, "No Chromium executable is available for browser tests")
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath
    })
    page = await browser.newPage()
    page.on("pageerror", (error) => errors.push(error.message || String(error)))
    await callback({ page, baseUrl, state })
    assert.deepEqual(errors, [])
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
    await new Promise((resolve) => server.close(resolve))
  }
}

async function textContent(page, selector) {
  return page.locator(selector).first().textContent()
}

async function waitForState(predicate, message, timeoutMs = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.ok(predicate(), message)
}

browserTest("browser: selecting a launch script from empty state persists and stays off", async () => {
  const state = baseState({ targetScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/app-fixture`)
    await page.click("[data-app-autolaunch-button]")
    await page.waitForSelector('input[name="app-autolaunch-script"][value="start.js"]')
    await page.click('input[name="app-autolaunch-script"][value="start.js"]')
    await page.waitForFunction(() => {
      const feedback = document.querySelector("[data-app-autolaunch-feedback]")
      return feedback && feedback.textContent.includes("Launch script saved.")
    })

    assert.deepEqual(state.autolaunchPosts[0], {
      app: "target",
      script: "start.js",
      enabled: false
    })
    assert.equal(await page.isChecked('input[name="app-autolaunch-script"][value="start.js"]'), true)
    assert.equal((await textContent(page, "[data-app-autolaunch-status]")).trim(), "OFF")
  })
})

browserTest("browser: app autolaunch modal is viewport sized from transformed sidebar", async () => {
  const state = baseState({ targetScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.goto(`${baseUrl}/app-transformed-sidebar-fixture`)
    await page.click("[data-app-autolaunch-button]")
    await page.waitForSelector("[data-app-autolaunch-modal]:not(.hidden)")

    const rect = await page.locator("[data-app-autolaunch-modal]").evaluate((modal) => {
      const box = modal.getBoundingClientRect()
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        parentTag: modal.parentElement ? modal.parentElement.tagName : ""
      }
    })

    assert.equal(rect.parentTag, "BODY")
    assert.ok(rect.width > 900, `modal width should span the viewport, got ${rect.width}`)
    assert.ok(Math.abs(rect.left - 20) <= 1, `modal should use viewport left inset, got ${rect.left}`)
    assert.ok(Math.abs(rect.right - 980) <= 1, `modal should use viewport right inset, got ${rect.right}`)
  })
})

browserTest("browser: startup toggle from empty selection saves the single eligible default", async () => {
  const state = baseState({ targetScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/app-fixture`)
    await page.click("[data-app-autolaunch-button]")
    await page.waitForSelector('input[name="app-autolaunch-script"][value="start.js"]')

    assert.equal(await page.isChecked('input[name="app-autolaunch-script"][value="start.js"]'), false)

    await page.click("[data-app-autolaunch-switch]")
    await waitForState(
      () => state.autolaunchPosts.length === 1,
      "Start with Pinokio should save the single eligible default"
    )

    assert.deepEqual(state.autolaunchPosts[0], {
      app: "target",
      script: "start.js",
      enabled: true
    })
    assert.equal(state.launchRequirementsGets, 0)
    assert.equal(await page.isChecked('input[name="app-autolaunch-script"][value="start.js"]'), true)
    assert.equal((await textContent(page, "[data-app-autolaunch-status]")).trim(), "ON")
  })
})

browserTest("browser: startup toggle from empty selection warns when no eligible default exists", async () => {
  const cases = [{
    name: "no default",
    menu: [{ script: "start.js", label: "Start" }],
    other: [{ script: "target.custom.js", label: "Custom" }]
  }, {
    name: "multiple defaults",
    menu: [
      { script: "start.js", label: "Start", menu_default: true },
      { script: "target.custom.js", label: "Custom", menu_default: true }
    ],
    other: []
  }, {
    name: "params default",
    menu: [{ script: "start.js", label: "Start", menu_default: true, has_params: true }],
    other: [{ script: "target.custom.js", label: "Custom" }]
  }]

  for (const scenario of cases) {
    const state = baseState({ targetScript: "" })
    state.candidates.target.menu = scenario.menu
    state.candidates.target.other = scenario.other
    await withBrowser(state, async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/app-fixture`)
      await page.click("[data-app-autolaunch-button]")
      await page.waitForSelector("[data-app-autolaunch-switch]")

      await page.click("[data-app-autolaunch-switch]")
      await page.waitForFunction(() => {
        const feedback = document.querySelector("[data-app-autolaunch-feedback]")
        return feedback && /Choose .*launch script/i.test(feedback.textContent || "")
      })

      assert.equal(state.autolaunchPosts.length, 0, scenario.name)
      assert.equal((await textContent(page, "[data-app-autolaunch-status]")).trim(), "OFF")
    })
  }
})

browserTest("browser: global startup toggle from empty selection saves the single eligible default", async () => {
  const state = baseState({ targetScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/autolaunch-fixture?app=target`)
    await page.waitForSelector('input[name="autolaunch-script"][value="start.js"]')

    assert.equal(await page.isChecked('input[name="autolaunch-script"][value="start.js"]'), false)

    await page.click("[data-autolaunch-switch]")
    await waitForState(
      () => state.autolaunchPosts.length === 1,
      "Global Start with Pinokio should save the single eligible default"
    )

    assert.deepEqual(state.autolaunchPosts[0], {
      app: "target",
      script: "start.js",
      enabled: true
    })
    assert.equal(state.launchRequirementsGets, 0)
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="autolaunch-script"][value="start.js"]')
      const enabledCount = document.querySelector("[data-enabled-count]")
      return input && input.checked && enabledCount && enabledCount.textContent.trim() === "1"
    })
    assert.equal(await page.isChecked('input[name="autolaunch-script"][value="start.js"]'), true)
    assert.equal((await textContent(page, "[data-enabled-count]")).trim(), "1")
  })
})

browserTest("browser: global startup toggle from empty selection warns when no eligible default exists", async () => {
  const cases = [{
    name: "no default",
    menu: [{ script: "start.js", label: "Start" }],
    other: [{ script: "target.custom.js", label: "Custom" }]
  }, {
    name: "multiple defaults",
    menu: [
      { script: "start.js", label: "Start", menu_default: true },
      { script: "target.custom.js", label: "Custom", menu_default: true }
    ],
    other: []
  }, {
    name: "params default",
    menu: [{ script: "start.js", label: "Start", menu_default: true, has_params: true }],
    other: [{ script: "target.custom.js", label: "Custom" }]
  }]

  for (const scenario of cases) {
    const state = baseState({ targetScript: "" })
    state.candidates.target.menu = scenario.menu
    state.candidates.target.other = scenario.other
    await withBrowser(state, async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/autolaunch-fixture?app=target`)
      await page.waitForSelector("[data-manual-script]")

      await page.click("[data-autolaunch-switch]")
      await page.waitForFunction(() => {
        const feedback = document.querySelector("[data-feedback]")
        return feedback && /Choose .*launch script/i.test(feedback.textContent || "")
      })

      assert.equal(state.autolaunchPosts.length, 0, scenario.name)
      assert.equal((await textContent(page, "[data-enabled-count]")).trim(), "0")
    })
  }
})

browserTest("browser: global startup toggle uses pending manual script before eligible default", async () => {
  const state = baseState({ targetScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/autolaunch-fixture?app=target`)
    await page.waitForSelector("[data-manual-script]")

    await page.fill("[data-manual-script]", "target.custom.js")
    await page.click("[data-autolaunch-switch]")
    await waitForState(
      () => state.autolaunchPosts.length === 1,
      "Global Start with Pinokio should save the pending manual script"
    )

    assert.deepEqual(state.autolaunchPosts[0], {
      app: "target",
      script: "target.custom.js",
      enabled: true
    })
    assert.equal(await page.isChecked('input[name="autolaunch-script"][value="start.js"]'), false)
    await page.waitForFunction(() => {
      const enabledCount = document.querySelector("[data-enabled-count]")
      return enabledCount && enabledCount.textContent.trim() === "1"
    })
    assert.equal((await textContent(page, "[data-enabled-count]")).trim(), "1")
  })
})

browserTest("browser: adding a requirement with an existing script still requires script confirmation", async () => {
  const state = baseState({ targetScript: "target.custom.js", helperScript: "start.js" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/app-fixture`)
    await page.click("[data-app-autolaunch-button]")
    await page.waitForSelector("[data-app-autolaunch-toggle-dependency-picker]")
    await page.click("[data-app-autolaunch-toggle-dependency-picker]")
    await page.click('[data-app-autolaunch-add-dependency="helper"]')

    await page.waitForSelector(".app-autolaunch-dependency-script-modal")
    assert.equal(state.dependencyPosts.length, 0)
    assert.equal(await page.isChecked('[data-app-autolaunch-dependency-script-app="helper"][value="start.js"]'), true)

    await page.click('[data-app-autolaunch-dependency-script-app="helper"][value="start.js"]')
    assert.equal(state.dependencyPosts.length, 0)
    assert.equal(state.autolaunchPosts.length, 0)
    await page.click('[data-app-autolaunch-confirm-dependency-script]')
    await page.waitForFunction(() => {
      const feedback = document.querySelector("[data-app-autolaunch-feedback]")
      return feedback && feedback.textContent.includes("Requirement saved.")
    })

    assert.deepEqual(state.autolaunchPosts.at(-1), {
      app: "helper",
      script: "start.js",
      enabled: false
    })
    assert.deepEqual(state.dependencyPosts.at(-1), {
      app: "target",
      dependencies: ["helper"]
    })
    assert.equal(await page.locator(".app-autolaunch-dependency-script-modal").count(), 0)
  })
})

browserTest("browser: blocked setup status exposes script selection and stop actions", async () => {
  const state = baseState({ targetScript: "target.custom.js", helperScript: "" })
  state.launchRequirementsStatus = {
    state: "blocked",
    blocked_reason: "Comfyui has no launch script selected",
    requirements: [{
      id: "helper",
      title: "Comfyui",
      state: "blocked",
      blocked_reason: "Comfyui has no launch script selected",
      icon: "/pinokio-black.png"
    }]
  }
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/status-fixture`)
    await page.waitForSelector("text=Launch needs setup")
    assert.equal(await page.locator('[data-launch-requirements-choose-script="helper"]').count(), 1)
    assert.equal(await page.locator("[data-launch-requirements-stop]").count(), 1)
  })
})

browserTest("browser: adding a requirement with no script requires selecting one before saving", async () => {
  const state = baseState({ targetScript: "target.custom.js", helperScript: "" })
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/app-fixture`)
    await page.click("[data-app-autolaunch-button]")
    await page.waitForSelector("[data-app-autolaunch-toggle-dependency-picker]")
    await page.click("[data-app-autolaunch-toggle-dependency-picker]")
    await page.click('[data-app-autolaunch-add-dependency="helper"]')

    await page.waitForSelector(".app-autolaunch-dependency-script-modal")
    assert.equal(state.dependencyPosts.length, 0)
	    assert.equal(await page.isChecked('[data-app-autolaunch-dependency-script-app="helper"][value="start.js"]'), false)

	    await page.click('[data-app-autolaunch-dependency-script-app="helper"][value="start.js"]')
	    assert.equal(state.dependencyPosts.length, 0)
	    assert.equal(state.autolaunchPosts.length, 0)
	    await page.click('[data-app-autolaunch-confirm-dependency-script]')
	    await page.waitForFunction(() => {
	      const feedback = document.querySelector("[data-app-autolaunch-feedback]")
	      return feedback && feedback.textContent.includes("Requirement saved.")
    })

    assert.deepEqual(state.autolaunchPosts.at(-1), {
      app: "helper",
      script: "start.js",
      enabled: false
    })
    assert.deepEqual(state.dependencyPosts.at(-1), {
      app: "target",
      dependencies: ["helper"]
    })
  })
})

browserTest("browser: open without launching does not fetch or show requirement status", async () => {
  const state = baseState()
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/open-without-launching`)
    await page.waitForTimeout(250)

    assert.equal(state.launchRequirementsGets, 0)
    assert.equal(await page.locator("[data-launch-requirements-status]").isHidden(), true)
    assert.equal(await page.locator("text=Preparing required apps").count(), 0)
  })
})

browserTest("browser: home autolaunch status appears and transitions without refresh", async () => {
  const state = baseState()
  state.homeStatus = {
    launch_complete: false,
    running_apps: [],
    running_scripts: [],
    autolaunch: {
      apps: {
        target: {
          id: "target",
          title: "Target",
          script: "start.js",
          state: "waiting",
          waiting_for: ["helper"],
          dependencies: ["helper"]
        },
        helper: {
          id: "helper",
          title: "Helper",
          state: "starting"
        }
      }
    }
  }
  await withBrowser(state, async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/home-fixture`)
    await page.waitForFunction(() => {
      const chip = document.querySelector(".home-autolaunch-status")
      return chip && chip.textContent.includes("Waiting for Helper")
    })
    assert.ok(state.homeStatusGets > 0)

    state.homeStatus = {
      launch_complete: true,
      running_apps: ["target"],
      running_scripts: [{
        app: "target",
        home_path: "api/target/start.js",
        path: "target/start.js",
        script_path: "start.js"
      }],
      autolaunch: {
        apps: {
          target: {
            id: "target",
            title: "Target",
            script: "start.js",
            state: "ready"
          }
        }
      }
    }
    await page.waitForFunction(() => {
      const button = document.querySelector(".home-app-line .shutdown")
      return button && button.textContent.includes("Stop start.js")
    })

    assert.equal(await page.locator(".home-autolaunch-status").count(), 0)
    assert.match(await textContent(page, ".home-app-line .shutdown"), /Stop start\.js/)
  })
})
