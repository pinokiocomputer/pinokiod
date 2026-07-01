const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const viewPath = path.resolve(__dirname, "..", "server/views/plugin_detail.ejs")

function basePlugin(overrides = {}) {
  return {
    title: "Demo Plugin",
    description: "Demo plugin description.",
    link: "https://example.com/plugin",
    image: "",
    icon: "fa-solid fa-terminal",
    pluginPath: "/plugin/demo/pinokio.js",
    extraParams: [],
    defaultCwd: "",
    hasInstall: true,
    hasUpdate: true,
    hasUninstall: true,
    hasInstalledCheck: true,
    installed: true,
    category: "cli",
    ...overrides,
  }
}

function basePluginUi(overrides = {}) {
  return {
    badges: [{ label: "Local plugin", tone: "accent" }],
    launchSummary: "Launches inside Pinokio",
    hasChanges: false,
    changePreview: [],
    extraChangeCount: 0,
    localChangesCopy: "",
    showSidebar: true,
    sourceLabel: "Local folder",
    sourceValue: "plugin/demo",
    statusLabel: "Status",
    statusValue: "Not version tracked yet",
    canOpenFolder: false,
    canManageSource: true,
    isManagedSource: false,
    githubPanelTitle: "GitHub",
    githubPanelCopy: "",
    remoteLabel: "",
    ...overrides,
  }
}

function baseShareState(overrides = {}) {
  return {
    ownership: "local",
    manageable: true,
    canOpenFolder: false,
    dir: "",
    localLabel: "plugin/demo",
    remoteUrl: "",
    remoteWebUrl: "",
    githubConnected: false,
    gitInitialized: false,
    hasCommit: false,
    changeCount: 0,
    changes: [],
    branch: "HEAD",
    commitUrl: "",
    createUrl: "",
    pushUrl: "",
    ...overrides,
  }
}

async function renderPluginDetail({ plugin = {}, pluginUi = {}, shareState = {} } = {}) {
  const html = await ejs.renderFile(viewPath, {
    theme: "dark",
    agent: "browser",
    list: [],
    current_host: "",
    showPeerAccess: false,
    plugin: basePlugin(plugin),
    pluginUi: basePluginUi(pluginUi),
    pluginCwd: "",
    shareState: baseShareState(shareState),
    apps: [],
  })
  return new JSDOM(html).window.document
}

test("plugin detail omits the right column for built-in system plugins", async () => {
  const document = await renderPluginDetail({
    plugin: {
      title: "Antigravity CLI Auto",
      pluginPath: "/pinokio/run/plugin/antigravity-cli-auto/pinokio.js",
    },
    pluginUi: {
      badges: [{ label: "Built-in plugin", tone: "neutral" }],
      showSidebar: false,
    },
    shareState: {
      ownership: "system",
      localLabel: "plugin/antigravity-cli-auto/pinokio.js",
      manageable: false,
    },
  })

  assert.equal(document.querySelector(".task-detail-sidebar"), null)
  assert.ok(document.querySelector(".task-detail-layout-single"))
  assert.equal(document.querySelector("[data-plugin-share-next-title]"), null)
  assert.doesNotMatch(document.body.textContent, /Plugin status/)
  assert.match(document.querySelector(".task-header-actions").textContent, /Website/)
  assert.doesNotMatch(document.querySelector(".task-header-actions").textContent, /Back/)
  assert.equal(document.querySelector('.plugin-detail-breadcrumb a[href="/plugins"]')?.textContent, "Plugins")
})

test("plugin detail keeps source management column for local plugins", async () => {
  const document = await renderPluginDetail()

  assert.ok(document.querySelector(".task-detail-sidebar"))
  assert.equal(document.querySelector(".task-detail-layout-single"), null)
  assert.ok(document.querySelector("[data-plugin-share-next-title]"))
  assert.match(document.body.textContent, /Plugin status/)
  assert.equal(document.querySelector('.plugin-detail-breadcrumb a[href="/plugins"]')?.textContent, "Plugins")
  assert.equal(
    document.querySelector('.plugin-detail-breadcrumb a[aria-current="page"]')?.getAttribute("href"),
    "/plugin?path=%2Fplugin%2Fdemo%2Fpinokio.js"
  )
  assert.equal(document.querySelector(".task-header-actions"), null)
  assert.equal(document.querySelectorAll(".plugin-detail-status-row").length, 3)
  assert.equal(document.querySelectorAll(".task-detail-sidebar .task-meta-chip").length, 0)
  assert.equal(
    Array.from(document.querySelectorAll(".task-detail-sidebar h2")).some((heading) => heading.textContent.trim() === "GitHub"),
    false
  )
})
