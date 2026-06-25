#!/usr/bin/env node
const assert = require("node:assert/strict")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

const repoRoot = path.resolve(__dirname, "..")
const outputRoot = path.resolve(repoRoot, "output/playwright/launch-requirements-real-browser")
const readyPrefix = "PINOKIO_REAL_BROWSER_READY "
const resultPrefix = "PINOKIO_REAL_BROWSER_RESULT "
const serverMode = process.argv.includes("--server")

function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith("--")) {
      continue
    }
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function loadPlaywright() {
  try {
    return require("playwright")
  } catch (_) {}

  try {
    const bin = childProcess.execFileSync("which", ["playwright"], { encoding: "utf8" }).trim()
    if (bin) {
      return require(path.join(path.dirname(path.dirname(bin)), "playwright"))
    }
  } catch (_) {}

  throw new Error(
    "Playwright is required for the real-browser harness. Run: npx -y -p playwright node test/launch-requirements-real-browser.js"
  )
}

function chromiumExecutablePath(playwright) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    playwright.chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || ""
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

function jsString(value) {
  return JSON.stringify(String(value))
}

function appModule(title, description) {
  return `module.exports = {
  version: "1.0.0",
  title: ${jsString(title)},
  description: ${jsString(description)},
  icon: "icon.png",
  menu: async () => [
    { default: true, text: "Start", href: "start.js" },
    { text: "Custom", href: "custom.launch.js" },
    { text: "Update", href: "update.js" },
    { text: "Reset", href: "reset.js" }
  ]
}
`
}

function waitScript(label, seconds = 0.75, daemon = true) {
  return `module.exports = {
  daemon: ${daemon ? "true" : "false"},
  run: [
    { method: "process.wait", params: { sec: ${Number(seconds)} } },
    { method: "local.set", params: { marker: ${jsString(label)} } }
  ]
}
`
}

function envFile(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n"
}

async function writeApp(home, app) {
  const dir = path.resolve(home, "api", app.id)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.resolve(dir, "pinokio.js"), appModule(app.title, app.description || `${app.title} acceptance fixture.`))
  await fsp.writeFile(path.resolve(dir, "icon.png"), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  ))
  const scripts = app.scripts || {
    "start.js": waitScript(`${app.id}:start`, app.waitSeconds || 0.75, true),
    "custom.launch.js": waitScript(`${app.id}:custom`, app.waitSeconds || 0.35, true),
    "update.js": waitScript(`${app.id}:update`, 0.2, false),
    "reset.js": waitScript(`${app.id}:reset`, 0.2, false)
  }
  for (const [name, content] of Object.entries(scripts)) {
    await fsp.writeFile(path.resolve(dir, name), content)
  }
  if (app.env) {
    await fsp.writeFile(path.resolve(dir, "ENVIRONMENT"), envFile(app.env))
  }
  return dir
}

async function createHome(apps) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinokio-real-browser-"))
  const fakeUserHome = path.resolve(root, "user")
  const pinokioHome = path.resolve(root, "pinokio")
  await fsp.mkdir(path.resolve(pinokioHome, "api"), { recursive: true })
  await fsp.mkdir(fakeUserHome, { recursive: true })
  const runtimeBin = path.resolve(process.env.PINOKIO_REAL_BROWSER_BIN || path.join(os.homedir(), "pinokio", "bin"))
  if (fs.existsSync(runtimeBin)) {
    await fsp.symlink(runtimeBin, path.resolve(pinokioHome, "bin"), "dir")
  }
  for (const app of apps) {
    await writeApp(pinokioHome, app)
  }
  return { root, fakeUserHome, pinokioHome }
}

async function runServerMode() {
  const args = parseArgs()
  const port = Number(args.port)
  const home = path.resolve(String(args.home || ""))
  const pkg = require(path.resolve(repoRoot, "package.json"))
  const Server = require(path.resolve(repoRoot, "server"))
  const server = new Server({
    store: { store: { home, version: pkg.version } },
    agent: "test",
    newsfeed: "",
    portal: ""
  })
  server.port = port
  await server.start({ debug: true })
  process.stdout.write(`${readyPrefix}${JSON.stringify({ port, home, pid: process.pid })}\n`)
  setInterval(() => {}, 1000)
}

function waitForReady(child, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      reject(new Error(`server did not become ready in ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString()
      stdout += text
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith(readyPrefix)) {
          clearTimeout(timer)
          resolve({ ready: JSON.parse(line.slice(readyPrefix.length)), stdout, stderr })
        }
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("exit", (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`server exited before ready: code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function withRealPinokio(apps, scenarioName, callback) {
  const home = await createHome(apps)
  const port = await freePort()
  const artifacts = path.resolve(outputRoot, `${Date.now()}-${scenarioName}`)
  await fsp.mkdir(artifacts, { recursive: true })
  const env = {
    ...process.env,
    HOME: home.fakeUserHome,
    PINOKIO_HOME: home.pinokioHome,
    PINOKIO_DISABLE_WATCH: "1"
  }
  const child = childProcess.spawn(process.execPath, [
    __filename,
    "--server",
    "--port",
    String(port),
    "--home",
    home.pinokioHome
  ], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  })
  const logs = []
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()))
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()))
  const playwright = loadPlaywright()
  const executablePath = chromiumExecutablePath(playwright)
  assert.ok(executablePath, "No Chromium executable is available for real-browser acceptance")
  let browser
  let page
  try {
    await waitForReady(child)
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHttp(`${baseUrl}/home`)
    browser = await playwright.chromium.launch({ headless: true, executablePath })
    page = await browser.newPage()
    page.setDefaultTimeout(15000)
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message || String(error)))
    await callback({ page, baseUrl, artifacts, home, pageErrors })
    assert.deepEqual(pageErrors, [])
    await fsp.writeFile(path.resolve(artifacts, "server.log"), logs.join(""))
    return { artifacts, home }
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.resolve(artifacts, "failure.png"), fullPage: true }).catch(() => {})
    }
    await fsp.writeFile(path.resolve(artifacts, "server.log"), logs.join("")).catch(() => {})
    throw error
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch (_) {}
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch (_) {}
  }
}

async function screenshot(page, artifacts, name) {
  const file = path.resolve(artifacts, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function bodyText(page) {
  return await page.locator("body").innerText()
}

async function homeRows(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".home-app-line")).map((line) => ({
      app: line.getAttribute("data-autolaunch-app") || line.getAttribute("data-uri") || "",
      name: line.getAttribute("data-name") || line.getAttribute("data-title") || "",
      section: line.closest(".running-apps") ? "running" : "installed",
      text: line.innerText,
      stopButtons: Array.from(line.querySelectorAll(".shutdown")).map((button) => button.innerText.trim()),
      status: Array.from(line.querySelectorAll(".home-autolaunch-status")).map((chip) => chip.innerText.trim())
    }))
  })
}

function findRow(rows, name) {
  return rows.find((row) => row.name === name || row.text.includes(name))
}

async function waitForHomeRow(page, name, predicate, timeoutMs = 15000) {
  const start = Date.now()
  let lastRows = []
  while (Date.now() - start < timeoutMs) {
    lastRows = await homeRows(page)
    const row = findRow(lastRows, name)
    if (row && (!predicate || predicate(row, lastRows))) {
      return row
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`timed out waiting for home row ${name}; rows=${JSON.stringify(lastRows, null, 2)}`)
}

async function launchRequirementsStatus(page) {
  return await page.evaluate(async () => {
    const match = location.pathname.match(/^\/api\/([^/]+)/)
    if (!match) {
      return null
    }
    const response = await fetch(`/pinokio/launch-requirements/${encodeURIComponent(match[1])}?t=${Date.now()}`)
    return await response.json()
  })
}

async function homeStatus(page) {
  return await page.evaluate(async () => {
    const response = await fetch(`/pinokio/home_status?t=${Date.now()}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    })
    return await response.json()
  })
}

async function waitForRunningScript(page, appId, script = "start.js", timeoutMs = 30000) {
  const start = Date.now()
  let lastStatus = null
  while (Date.now() - start < timeoutMs) {
    lastStatus = await homeStatus(page)
    if (hasRunningScript(lastStatus, appId, script)) {
      return lastStatus
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`timed out waiting for ${appId}/${script} to run; home_status=${JSON.stringify(lastStatus, null, 2)}`)
}

function hasRunningScript(status, appId, script = "start.js") {
  return Array.isArray(status && status.running_scripts) && status.running_scripts.some((entry) => {
    return entry && entry.app === appId && entry.script_path === script
  })
}

async function scenarioNoEnvBaseline() {
  const apps = [{
    id: "codex-real-plain",
    title: "Codex Real Plain",
    waitSeconds: 0.2
  }]
  return await withRealPinokio(apps, "no-env-baseline", async ({ page, baseUrl, artifacts }) => {
    await page.goto(`${baseUrl}/api/codex-real-plain/custom.launch.js`, { waitUntil: "domcontentloaded" })
    await page.locator(".run .stop").waitFor({ state: "visible", timeout: 15000 })
    await screenshot(page, artifacts, "plain-custom-launch")
    const text = await bodyText(page)
    assert.doesNotMatch(text, /Preparing required apps/i)
    assert.doesNotMatch(text, /Disconnected/i)
    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    await waitForHomeRow(page, "Codex Real Plain", (row) => row.stopButtons.some((label) => /Stop custom\.launch\.js/.test(label)))
  })
}

function recursiveApps(rootStartupEnabled = true) {
  return [
    {
      id: "codex-real-root",
      title: "Codex Real Root",
      waitSeconds: 0.6,
      env: {
        PINOKIO_SCRIPT_AUTOLAUNCH: "start.js",
        PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED: rootStartupEnabled ? "true" : "false",
        PINOKIO_SCRIPT_REQUIRES: "codex-real-middle"
      }
    },
    {
      id: "codex-real-middle",
      title: "Codex Real Middle",
      waitSeconds: 0.8,
      env: {
        PINOKIO_SCRIPT_AUTOLAUNCH: "start.js",
        PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED: "false",
        PINOKIO_SCRIPT_REQUIRES: "codex-real-leaf"
      }
    },
    {
      id: "codex-real-leaf",
      title: "Codex Real Leaf",
      waitSeconds: 1.2,
      env: {
        PINOKIO_SCRIPT_AUTOLAUNCH: "start.js",
        PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED: "false"
      }
    }
  ]
}

async function scenarioStartupRecursiveHome() {
  return await withRealPinokio(recursiveApps(true), "startup-recursive-home", async ({ page, baseUrl, artifacts }) => {
    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    await screenshot(page, artifacts, "home-initial")
    await waitForHomeRow(page, "Codex Real Root", (row) => /Waiting for Codex Real Middle|Starting start\.js|Stop start\.js/.test(row.text))
    await waitForHomeRow(page, "Codex Real Middle", (row) => /Waiting for Codex Real Leaf|Starting start\.js|Stop start\.js/.test(row.text))
    await waitForHomeRow(page, "Codex Real Leaf", (row) => /Starting start\.js|Stop start\.js/.test(row.text))
    await screenshot(page, artifacts, "home-recursive-status")
    await waitForHomeRow(page, "Codex Real Root", (row) => row.stopButtons.some((label) => /Stop start\.js/.test(label)), 30000)
    await waitForHomeRow(page, "Codex Real Middle", (row) => row.stopButtons.some((label) => /Stop start\.js/.test(label)), 30000)
    await waitForHomeRow(page, "Codex Real Leaf", (row) => row.stopButtons.some((label) => /Stop start\.js/.test(label)), 30000)
    await screenshot(page, artifacts, "home-all-running")
  })
}

async function scenarioManualRequirementsStopLaunch() {
  return await withRealPinokio(recursiveApps(false), "manual-requirements-stop-launch", async ({ page, baseUrl, artifacts }) => {
    await page.goto(`${baseUrl}/api/codex-real-root/start.js`, { waitUntil: "domcontentloaded" })
    await waitForHomeText(page, /Preparing required apps/i)
    await waitForHomeText(page, /Waiting for Codex Real Leaf|Waiting for Codex Real Middle/i)
    await screenshot(page, artifacts, "manual-preparing")
    const text = await bodyText(page)
    assert.doesNotMatch(text, /Disconnected/i)
    const stop = page.getByRole("button", { name: /Stop launch/i })
    await stop.click()
    await page.waitForFunction(() => {
      const body = document.body ? document.body.innerText : ""
      return !/Preparing required apps|Launch stopped|Stopped launch/i.test(body)
    }, null, { timeout: 15000 })
    await screenshot(page, artifacts, "manual-launch-cleared")
    const status = await launchRequirementsStatus(page)
    assert.ok(status && status.ok)
    assert.equal(status.status, null)
    const runtime = await homeStatus(page)
    assert.equal(Array.isArray(runtime.running_apps) && runtime.running_apps.includes("codex-real-root"), false)
    assert.equal(hasRunningScript(runtime, "codex-real-root"), false)
  })
}

async function scenarioStartupAppStopTarget() {
  const apps = recursiveApps(true).map((app) => (
    app.id === "codex-real-leaf" ? { ...app, waitSeconds: 8 } : app
  ))
  return await withRealPinokio(apps, "startup-app-stop-target", async ({ page, baseUrl, artifacts }) => {
    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    await waitForHomeRow(page, "Codex Real Root", (row) => {
      return /Waiting for Codex Real Middle|Starting start\.js|Preparing/i.test(row.text)
    }, 15000)
    await screenshot(page, artifacts, "startup-home-root-preparing")

    await page.locator(".home-app-line", { hasText: "Codex Real Root" }).first().click()
    await page.getByRole("button", { name: /Stop launch/i }).waitFor({ state: "visible", timeout: 15000 })
    await screenshot(page, artifacts, "startup-root-app-preparing")
    await page.getByRole("button", { name: /Stop launch/i }).click()
    await page.waitForFunction(() => {
      const body = document.body ? document.body.innerText : ""
      return !/Preparing required apps|Launch stopped|Stopped launch/i.test(body)
    }, null, { timeout: 15000 })
    await screenshot(page, artifacts, "startup-root-app-cleared")

    const appPageRuntime = await homeStatus(page)
    assert.equal(Array.isArray(appPageRuntime.running_apps) && appPageRuntime.running_apps.includes("codex-real-root"), false)
    assert.equal(hasRunningScript(appPageRuntime, "codex-real-root"), false)

    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    try {
      await waitForHomeRow(page, "Codex Real Root", (row) => {
        return row.section !== "running" &&
          row.stopButtons.length === 0 &&
          !/Starting start\.js|Waiting for Codex Real Middle|Stop start\.js/i.test(row.text)
      }, 30000)
    } catch (error) {
      const runtime = await homeStatus(page)
      const status = await page.evaluate(async () => {
        const response = await fetch(`/pinokio/launch-requirements/codex-real-root?t=${Date.now()}`)
        return await response.json()
      })
      throw new Error(`${error.message}\nhome_status=${JSON.stringify(runtime, null, 2)}\nlaunch_status=${JSON.stringify(status, null, 2)}`)
    }
    await screenshot(page, artifacts, "startup-home-root-not-running")

    const runtime = await homeStatus(page)
    assert.equal(Array.isArray(runtime.running_apps) && runtime.running_apps.includes("codex-real-root"), false)
    assert.equal(hasRunningScript(runtime, "codex-real-root"), false)

    await page.locator(".home-app-line", { hasText: "Codex Real Root" }).first().click()
    await waitForRunningScript(page, "codex-real-root", "start.js", 45000)
    await screenshot(page, artifacts, "startup-root-reopened-default-running")
  })
}

async function waitForHomeText(page, pattern, timeoutMs = 15000) {
  const start = Date.now()
  let text = ""
  while (Date.now() - start < timeoutMs) {
    text = await bodyText(page)
    if (pattern.test(text)) {
      return text
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`timed out waiting for text ${pattern}; body=${text}`)
}

async function scenarioHomeStopNoReload() {
  const apps = [{
    id: "codex-real-stop",
    title: "Codex Real Stop",
    waitSeconds: 0.2
  }]
  return await withRealPinokio(apps, "home-stop-no-reload", async ({ page, baseUrl, artifacts }) => {
    await page.addInitScript(() => {
      const value = Number(window.localStorage.getItem("codexHomeLoadCount") || "0") + 1
      window.localStorage.setItem("codexHomeLoadCount", String(value))
    })
    await page.goto(`${baseUrl}/api/codex-real-stop/start.js`, { waitUntil: "domcontentloaded" })
    await page.locator(".run .stop").waitFor({ state: "visible", timeout: 15000 })
    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    const beforeLoads = await page.evaluate(() => window.localStorage.getItem("codexHomeLoadCount"))
    const row = await waitForHomeRow(page, "Codex Real Stop", (candidate) => candidate.stopButtons.some((label) => /Stop start\.js/.test(label)))
    assert.equal(row.section, "running")
    await screenshot(page, artifacts, "home-before-stop")
    await page.locator(".home-app-line", { hasText: "Codex Real Stop" }).locator(".shutdown").first().click()
    await waitForHomeRow(page, "Codex Real Stop", (candidate) => candidate.stopButtons.length === 0 && candidate.section !== "running", 15000)
    const afterLoads = await page.evaluate(() => window.localStorage.getItem("codexHomeLoadCount"))
    assert.equal(afterLoads, beforeLoads, "Home stop caused a full page reload")
    await screenshot(page, artifacts, "home-after-stop")
  })
}

async function scenarioRequirementStartedNormalStop() {
  const apps = recursiveApps(false).map((app) => (
    app.id === "codex-real-leaf" ? { ...app, waitSeconds: 8 } : app
  ))
  return await withRealPinokio(apps, "requirement-started-normal-stop", async ({ page, baseUrl, artifacts }) => {
    await page.goto(`${baseUrl}/api/codex-real-root/start.js`, { waitUntil: "domcontentloaded" })
    await waitForHomeText(page, /Preparing required apps/i)
    await waitForHomeText(page, /Codex Real Leaf/i)
    await screenshot(page, artifacts, "root-preparing-before-leaf-stop")

    await page.goto(`${baseUrl}/api/codex-real-leaf/start.js`, { waitUntil: "domcontentloaded" })
    await page.locator(".run .stop").waitFor({ state: "visible", timeout: 15000 })
    await screenshot(page, artifacts, "leaf-before-normal-stop")
    await page.locator(".run .stop").click()
    await page.waitForTimeout(1200)
    await screenshot(page, artifacts, "leaf-after-normal-stop")

    await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" })
    await waitForHomeRow(page, "Codex Real Leaf", (row) => {
      return row.stopButtons.length === 0 && !/Starting start\.js|Stop start\.js/.test(row.text)
    }, 15000)
    const rows = await homeRows(page)
    const root = findRow(rows, "Codex Real Root")
    const middle = findRow(rows, "Codex Real Middle")
    const leaf = findRow(rows, "Codex Real Leaf")
    assert.ok(root, "root row should remain visible as an installed app")
    assert.ok(middle, "middle row should remain visible as an installed app")
    assert.ok(leaf, "leaf row should remain visible as an installed app")
    assert.equal(root.stopButtons.some((label) => /Stop start\.js/.test(label)), false)
    assert.equal(middle.stopButtons.some((label) => /Stop start\.js/.test(label)), false)
    assert.equal(leaf.stopButtons.some((label) => /Stop start\.js/.test(label)), false)
    assert.doesNotMatch(root.text, /Starting start\.js|Waiting for Codex Real Middle/)
    assert.doesNotMatch(middle.text, /Starting start\.js|Waiting for Codex Real Leaf/)
    assert.doesNotMatch(leaf.text, /Starting start\.js/)
    await screenshot(page, artifacts, "home-after-leaf-normal-stop")
  })
}

const scenarios = {
  "no-env-baseline": scenarioNoEnvBaseline,
  "startup-recursive-home": scenarioStartupRecursiveHome,
  "manual-requirements-stop-launch": scenarioManualRequirementsStopLaunch,
  "startup-app-stop-target": scenarioStartupAppStopTarget,
  "home-stop-no-reload": scenarioHomeStopNoReload,
  "requirement-started-normal-stop": scenarioRequirementStartedNormalStop
}

async function runParentMode() {
  const args = parseArgs()
  const only = args.case ? String(args.case).split(",").map((item) => item.trim()).filter(Boolean) : Object.keys(scenarios)
  const unknown = only.filter((name) => !scenarios[name])
  assert.deepEqual(unknown, [], `Unknown real-browser scenario(s): ${unknown.join(", ")}`)
  await fsp.mkdir(outputRoot, { recursive: true })
  const results = []
  for (const name of only) {
    const started = Date.now()
    try {
      const result = await scenarios[name]()
      results.push({ name, ok: true, ms: Date.now() - started, artifacts: result.artifacts })
      process.stdout.write(`${resultPrefix}${JSON.stringify(results[results.length - 1])}\n`)
    } catch (error) {
      results.push({ name, ok: false, ms: Date.now() - started, error: error && error.stack ? error.stack : String(error) })
      process.stdout.write(`${resultPrefix}${JSON.stringify(results[results.length - 1])}\n`)
      throw error
    }
  }
  process.stdout.write(`${resultPrefix}${JSON.stringify({ ok: true, results })}\n`)
}

if (serverMode) {
  runServerMode().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
} else {
  runParentMode().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
}
