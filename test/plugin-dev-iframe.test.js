const assert = require("assert")
const ejs = require("ejs")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const viewPath = path.join(__dirname, "..", "server", "views", "d.ejs")

test("dev iframe checks plugin install state before posting a launch request", () => {
  const view = fs.readFileSync(viewPath, "utf8")
  const launchStart = view.indexOf("const launchTab = async (tab) =>")
  const redirectIndex = view.indexOf("if (await redirectToPluginInstallIfNeeded(href))", launchStart)
  const postMessageIndex = view.indexOf("window.parent.postMessage", launchStart)

  assert.notStrictEqual(launchStart, -1)
  assert.ok(redirectIndex > launchStart)
  assert.ok(postMessageIndex > redirectIndex)
  assert.ok(view.includes("window.top.location.href = redirectHref"))
  assert.ok(view.includes("/api/plugin/install-state?path="))
})

test("dev iframe renders plugin apps before project shell and shows description metadata", async () => {
  const html = await ejs.renderFile(viewPath, {
    filepath: "/tmp/pinokio-dev-view",
    retry: false,
    theme: "light",
    agent: "browser",
    dynamic: [{
      icon: "fa-solid fa-terminal",
      title: "Terminals",
      subtitle: "Open a project shell, with or without Python activated.",
      menu: [{
        icon: "fa-solid fa-terminal",
        title: "Bash",
        subtitle: "Plain shell plus detected Python environments",
        menu: [{
          icon: "fa-solid fa-terminal",
          title: "Shell",
          subtitle: "Open a plain Bash shell",
          href: "/shell/dev.bash.plain?path=%2Ftmp%2Fpinokio-dev-view"
        }]
      }]
    }, {
      icon: "fa-solid fa-plug-circle-bolt",
      title: "Terminal Apps",
      subtitle: "Terminal apps provided by your installed",
      subtitle_link_href: "/plugins",
      subtitle_link_label: "plugins",
      menu: [{
        icon: "fa-solid fa-terminal",
        title: "Agent CLI",
        description: "Runs the agent inside this workspace.",
        href: "/run/plugin/agent"
      }]
    }, {
      icon: "fa-solid fa-arrow-up-right-from-square",
      title: "Desktop Apps",
      subtitle: "Desktop apps provided by your installed",
      subtitle_link_href: "/plugins",
      subtitle_link_label: "plugins",
      menu: [{
        icon: "fa-solid fa-code",
        title: "Editor",
        metadata: {
          description: "Opens the workspace in a desktop editor."
        },
        href: "/run/plugin/editor"
      }]
    }],
  })

  const terminalAppsIndex = html.indexOf("Terminal Apps")
  const desktopAppsIndex = html.indexOf("Desktop Apps")
  const projectShellIndex = html.indexOf("Project Shell")

  assert.ok(terminalAppsIndex !== -1)
  assert.ok(desktopAppsIndex !== -1)
  assert.ok(projectShellIndex !== -1)
  assert.ok(terminalAppsIndex < projectShellIndex)
  assert.ok(desktopAppsIndex < projectShellIndex)
  assert.ok(html.includes("Runs the agent inside this workspace."))
  assert.ok(html.includes("Opens the workspace in a desktop editor."))
})
