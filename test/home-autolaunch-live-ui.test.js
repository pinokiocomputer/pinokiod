const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const { JSDOM } = require("jsdom")

const root = path.resolve(__dirname, "..")

async function homeAutolaunchScript(options = {}) {
  const launchComplete = options.launchComplete === true
  const view = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const start = view.indexOf("let refreshHomeStatusOnce = null")
  assert.notEqual(start, -1)
  const call = view.indexOf("startHomeAutolaunchPolling()", start)
  assert.notEqual(call, -1)
  return view
    .slice(start, call + "startHomeAutolaunchPolling()".length)
    .replace('<%= launch_complete ? "true" : "false" %>', launchComplete ? "true" : "false")
}

function createHomeDom(options = {}) {
  const running = options.running !== false
  const stopButton = options.stopButton !== false
  const appRow = `
    <div
      class="line align-top home-app-line"
      data-autolaunch-app="target"
      data-autolaunch-starting="0"
      data-autolaunch-script="start.js"
    >
      <h3><span class="title"><i class="fa-solid fa-circle"></i></span></h3>
      <div class="menu-btns">
        <button class="open-actions-modal" data-dialog-id="actions-target" type="button">menu</button>
        ${stopButton ? `
          <button class="btn shutdown" type="button" data-src="api/target/start.js">
            <i class="fa-solid fa-stop" aria-hidden="true"></i>
            <span>Stop start.js</span>
          </button>
        ` : ""}
      </div>
    </div>
  `
  return new JSDOM(`
    <!doctype html>
    <body>
      <div class="running-apps">
        ${running ? appRow : ""}
      </div>
      <div class="not-running-apps">${running ? "" : appRow}</div>
      <div id="actions-target"><div class="home-actions-title-row"></div></div>
    </body>
  `, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:42000/home"
  })
}

function createHomeDomWithApps(appIds) {
  const rows = appIds.map((appId) => `
    <div
      class="line align-top home-app-line"
      data-autolaunch-app="${appId}"
      data-autolaunch-starting="0"
      data-autolaunch-script="start.js"
    >
      <h3><span class="title"><i class="fa-solid fa-circle"></i></span></h3>
      <div class="menu-btns">
        <button class="open-actions-modal" data-dialog-id="actions-${appId}" type="button">menu</button>
      </div>
    </div>
    <div id="actions-${appId}"><div class="home-actions-title-row"></div></div>
  `).join("")
  return new JSDOM(`
    <!doctype html>
    <body>
      <div class="running-apps"></div>
      <div class="not-running-apps">${rows}</div>
    </body>
  `, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:42000/home"
  })
}

function createHomeDomForIdleOrdering() {
  const row = (appId, name, stopButton = false) => `
    <div
      class="line align-top home-app-line"
      data-name="${name}"
      data-autolaunch-app="${appId}"
      data-autolaunch-starting="0"
      data-autolaunch-script="start.js"
    >
      <h3><span class="title"><i class="fa-solid fa-circle"></i></span></h3>
      <div class="menu-btns">
        <button class="open-actions-modal" data-dialog-id="actions-${appId}" type="button">menu</button>
        ${stopButton ? `
          <button class="btn shutdown" type="button" data-src="api/${appId}/start.js">
            <i class="fa-solid fa-stop" aria-hidden="true"></i>
            <span>Stop start.js</span>
          </button>
        ` : ""}
      </div>
    </div>
    <div id="actions-${appId}"><div class="home-actions-title-row"></div></div>
  `
  return new JSDOM(`
    <!doctype html>
    <body>
      <div class="running-apps">${row("alpha", "Alpha", true)}</div>
      <div class="not-running-apps">
        ${row("beta", "Beta")}
        ${row("gamma", "Gamma")}
      </div>
    </body>
  `, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:42000/home?sort=az"
  })
}

function installHomeStatusMocks(window, responses) {
  const timeouts = []
  const intervals = []
  const clearedIntervals = []
  window.reorderHomeSectionsByPreference = () => {}
  window.setTimeout = (callback) => {
    timeouts.push(callback)
    return timeouts.length
  }
  window.setInterval = (callback) => {
    intervals.push(callback)
    return intervals.length
  }
  window.clearInterval = (id) => {
    clearedIntervals.push(id)
  }
  window.XMLHttpRequest = class {
    open() {}
    setRequestHeader() {}
    send() {
      const response = responses.shift()
      assert.ok(response, "missing mocked /pinokio/home_status response")
      this.readyState = 4
      this.status = 200
      this.responseText = JSON.stringify(response)
      this.onreadystatechange()
    }
  }
  return { timeouts, intervals, clearedIntervals }
}

async function runCallback(callback) {
  const result = callback()
  if (result && typeof result.then === "function") {
    await result
  }
  await Promise.resolve()
}

test("home live status clears a running row when it disappears from runtime status", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom()
  const { window } = dom
  const responses = [
    {
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
            script: "start.js",
            state: "ready"
          }
        }
      }
    },
    {
      launch_complete: true,
      running_apps: [],
      running_scripts: [],
      autolaunch: { apps: {} }
    }
  ]
  const { timeouts, intervals } = installHomeStatusMocks(window, responses)

  window.eval(script)
  assert.equal(timeouts.length, 1)
  assert.equal(intervals.length, 1)

  await runCallback(timeouts.shift())
  const line = window.document.querySelector(".home-app-line")
  assert.ok(line)
  assert.equal(line.querySelectorAll(".shutdown").length, 1)
  assert.equal(window.document.querySelector(".running-apps").contains(line), true)

  await runCallback(intervals[0])
  assert.equal(line.querySelectorAll(".shutdown").length, 0)
  assert.equal(window.document.querySelector(".not-running-apps").contains(line), true)
  assert.equal(line.getAttribute("data-autolaunch-starting"), "0")
})

test("home live status polling stops when launch is complete and no startup rows remain", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom({ running: false, stopButton: false })
  const { window } = dom
  const responses = [{
    launch_complete: true,
    running_apps: [],
    running_scripts: [],
    autolaunch: { apps: {} }
  }]
  const { timeouts, intervals, clearedIntervals } = installHomeStatusMocks(window, responses)

  window.eval(script)
  assert.equal(timeouts.length, 1)
  assert.equal(intervals.length, 1)

  await runCallback(timeouts.shift())
  assert.equal(clearedIntervals.length, 1)
})

test("home live status does not poll when startup is already complete and there are no startup rows", async () => {
  const script = await homeAutolaunchScript({ launchComplete: true })
  const dom = createHomeDom({ running: false, stopButton: false })
  const { window } = dom
  const { timeouts, intervals } = installHomeStatusMocks(window, [])

  window.eval(script)

  assert.equal(timeouts.length, 0)
  assert.equal(intervals.length, 0)
  assert.equal(typeof window.refreshHomeStatusOnce, "function")
})

test("home one-shot status refresh can update a stopped app row", async () => {
  const script = await homeAutolaunchScript({ launchComplete: true })
  const dom = createHomeDom()
  const { window } = dom
  const responses = [{
    launch_complete: true,
    running_apps: [],
    running_scripts: [],
    autolaunch: { apps: {} }
  }]
  const { timeouts, intervals } = installHomeStatusMocks(window, responses)

  window.eval(script)
  assert.equal(timeouts.length, 0)
  assert.equal(intervals.length, 0)
  await window.refreshHomeStatusOnce("target")

  const line = window.document.querySelector(".home-app-line")
  assert.equal(line.querySelectorAll(".shutdown").length, 0)
  assert.equal(window.document.querySelector(".not-running-apps").contains(line), true)
})

test("home one-shot status refresh preserves idle app sort order after moving stopped row", async () => {
  const script = await homeAutolaunchScript({ launchComplete: true })
  const dom = createHomeDomForIdleOrdering()
  const { window } = dom
  const responses = [{
    launch_complete: true,
    running_apps: [],
    running_scripts: [],
    autolaunch: { apps: {} }
  }]
  installHomeStatusMocks(window, responses)
  let reorderCalls = 0
  window.reorderHomeSectionsByPreference = () => {
    reorderCalls += 1
    for (const selector of [".running-apps", ".not-running-apps"]) {
      const section = window.document.querySelector(selector)
      const lines = Array.from(section.querySelectorAll(":scope > .line"))
      lines.sort((a, b) => (a.getAttribute("data-name") || "").localeCompare(b.getAttribute("data-name") || ""))
      for (const line of lines) {
        section.appendChild(line)
      }
    }
  }

  window.eval(script)
  await window.refreshHomeStatusOnce("alpha")

  const idleNames = Array.from(window.document.querySelectorAll(".not-running-apps > .line"))
    .map((line) => line.getAttribute("data-name"))
  assert.deepEqual(idleNames, ["Alpha", "Beta", "Gamma"])
  assert.equal(reorderCalls, 1)
})

test("home live status discovers a running target even when preparation status has already cleared", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom({ running: false, stopButton: false })
  const { window } = dom
  const responses = [{
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
        helper: {
          id: "helper",
          title: "Helper",
          script: "start.js",
          state: "ready"
        }
      }
    }
  }]
  const { timeouts } = installHomeStatusMocks(window, responses)

  window.eval(script)
  await runCallback(timeouts.shift())

  const line = window.document.querySelector('.home-app-line[data-autolaunch-app="target"]')
  const stopButton = line.querySelector(".shutdown")
  assert.ok(stopButton)
  assert.equal(stopButton.textContent.trim(), "Stop start.js")
  assert.equal(window.document.querySelector(".running-apps").contains(line), true)
})

test("home live status does not render owner-cancelled waiting rows as independent app status", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDomWithApps(["target", "middle", "leaf"])
  const { window } = dom
  const responses = [{
    launch_complete: true,
    running_apps: ["leaf"],
    running_scripts: [{
      app: "leaf",
      home_path: "api/leaf/start.js",
      path: "leaf/start.js",
      script_path: "start.js"
    }],
    autolaunch: {
      apps: {
        middle: {
          id: "middle",
          title: "Middle",
          script: "start.js",
          state: "waiting",
          waiting_for: ["leaf"],
          owner_app_ids: ["target"]
        },
        leaf: {
          id: "leaf",
          title: "Leaf",
          script: "start.js",
          state: "ready"
        }
      }
    }
  }]
  const { timeouts } = installHomeStatusMocks(window, responses)

  window.eval(script)
  await runCallback(timeouts.shift())

  const targetLine = window.document.querySelector('.home-app-line[data-autolaunch-app="target"]')
  const middleLine = window.document.querySelector('.home-app-line[data-autolaunch-app="middle"]')
  const leafLine = window.document.querySelector('.home-app-line[data-autolaunch-app="leaf"]')

  assert.equal(targetLine.querySelectorAll(".home-autolaunch-status").length, 0)
  assert.equal(middleLine.querySelectorAll(".home-autolaunch-status").length, 0)
  assert.equal(middleLine.classList.contains("autolaunch-waiting"), false)
  assert.equal(leafLine.querySelector(".shutdown").textContent.trim(), "Stop start.js")
})

test("home live status clears startup row when runtime status disappears after stop", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom()
  const { window } = dom
  const line = window.document.querySelector(".home-app-line")
  line.setAttribute("data-autolaunch-starting", "1")
  line.classList.add("autolaunch-starting")

  const responses = [{
    launch_complete: true,
    running_apps: [],
    running_scripts: [],
    autolaunch: {
      apps: {}
    }
  }]
  const { timeouts } = installHomeStatusMocks(window, responses)

  window.eval(script)
  await runCallback(timeouts.shift())

  assert.equal(line.querySelectorAll(".shutdown").length, 0)
  assert.equal(window.document.querySelector(".not-running-apps").contains(line), true)
  assert.equal(line.classList.contains("autolaunch-starting"), false)
})

test("home live status renders waiting state on an initially idle row", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom({ running: false, stopButton: false })
  const { window } = dom
  const responses = [{
    launch_complete: true,
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
  }]
  const { timeouts } = installHomeStatusMocks(window, responses)

  window.eval(script)
  await runCallback(timeouts.shift())

  const line = window.document.querySelector(".home-app-line")
  const chip = line.querySelector(".home-autolaunch-status")
  assert.ok(chip)
  assert.equal(chip.textContent, "Waiting for Helper")
  assert.equal(line.getAttribute("data-autolaunch-starting"), "1")
  assert.equal(line.classList.contains("autolaunch-waiting"), true)
  assert.equal(line.querySelectorAll(".shutdown").length, 0)
})

test("home live status transitions from preparing to normal stop button", async () => {
  const script = await homeAutolaunchScript()
  const dom = createHomeDom({ running: false, stopButton: false })
  const { window } = dom
  const responses = [
    {
      launch_complete: true,
      running_apps: [],
      running_scripts: [],
      autolaunch: {
        apps: {
          target: {
            id: "target",
            script: "start.js",
            state: "starting",
            step_current: 1,
            step_total: 2
          }
        }
      }
    },
    {
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
            script: "start.js",
            state: "ready"
          }
        }
      }
    }
  ]
  const { timeouts, intervals } = installHomeStatusMocks(window, responses)

  window.eval(script)
  await runCallback(timeouts.shift())

  const line = window.document.querySelector(".home-app-line")
  assert.equal(line.querySelector(".home-autolaunch-status span").textContent, "Starting start.js (1/2)")

  await runCallback(intervals[0])
  const stopButton = line.querySelector(".shutdown")
  assert.ok(stopButton)
  assert.equal(stopButton.textContent.trim(), "Stop start.js")
  assert.equal(stopButton.querySelectorAll(".home-stop-spinner").length, 0)
  assert.equal(line.querySelectorAll(".home-autolaunch-status").length, 0)
  assert.equal(line.getAttribute("data-autolaunch-starting"), "0")
})

test("home stop callback tolerates normal stop buttons without startup spinner", async () => {
  const view = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")

  assert.doesNotMatch(view, /target\.querySelector\("i\.fa-spin"\)\.classList\.add\("hidden"\)/)
  assert.match(view, /const resultSpinIcon = target\.querySelector\("i\.fa-spin"\)/)
  assert.match(view, /if \(resultSpinIcon\) \{\s*resultSpinIcon\.classList\.add\("hidden"\)\s*\}/)
})

test("static guard: home normal app stop uses one-shot status refresh with reload fallback", async () => {
  const view = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const start = view.indexOf('method: "kernel.api.stop"')
  assert.notEqual(start, -1)
  const end = view.indexOf("      })\n    }\n\n\n    return", start)
  assert.notEqual(end, -1)
  const branch = view.slice(start, end)

  assert.match(branch, /typeof refreshHomeStatusOnce === "function"/)
  assert.match(branch, /refreshHomeStatusOnce\(stoppedApp\)/)
  assert.doesNotMatch(branch, /window\.refreshHomeStatusOnce/)
  assert.match(branch, /location\.href = location\.href/)
})
