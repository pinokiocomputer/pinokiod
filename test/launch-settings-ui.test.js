const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")
const Server = require("../server")

const root = path.resolve(__dirname, "..")

test("launch settings only checks a script when it is persisted", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const appHelpers = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_modal_helpers.ejs"), "utf8")
  const globalView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")

  assert.match(appHelpers, /const configuredScript =/)
  assert.doesNotMatch(appHelpers, /const chooseFallbackScript =/)
  assert.doesNotMatch(globalView, /const chooseFallbackScript =/)
  assert.doesNotMatch(appHelpers, /if \(!selectedScript\)\s*\{\s*selectedScript = choose/)
  assert.match(appView, /selectedScript = configuredScript\(data\)/)
  assert.match(globalView, /selectedScript = configuredScript\(data\)/)
  assert.doesNotMatch(appView, /selectedScript = chooseInitialScript\(data\)/)
  assert.doesNotMatch(globalView, /selectedScript = chooseInitialScript\(data\)/)
  assert.doesNotMatch(appView, /chooseFallbackScript/)
  assert.doesNotMatch(globalView, /chooseFallbackScript/)
})

test("launch settings exposes explicit launch script clearing", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const appHelpers = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_modal_helpers.ejs"), "utf8")
  const globalView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")
  const route = await fs.readFile(path.resolve(root, "server/autolaunch.js"), "utf8")

  assert.match(route, /clear_script/)
  assert.match(appView, /data-app-autolaunch-clear-script/)
  assert.match(appView, /body: JSON\.stringify\(\{ app: appId, clear_script: true \}\)/)
  assert.match(appHelpers, /data-app-autolaunch-clear-script/)
  assert.match(appHelpers, /const hasRequirements = dependencies\.length > 0/)
  assert.match(appHelpers, /Remove requirements before clearing this app's launch script\./)
  assert.match(appHelpers, /\$\{hasRequirements \? "disabled" : ""\}/)
  assert.match(appHelpers, /Choose this app\\'s launch script before these requirements can run\./)
  assert.match(appHelpers, /selectedScript = updated\.autolaunch \|\| ""/)
  assert.match(globalView, /data-clear-script/)
  assert.match(globalView, /const hasRequirements = dependencies\.length > 0/)
  assert.match(globalView, /Remove requirements before clearing this app's launch script\./)
  assert.match(globalView, /\$\{hasRequirements \? "disabled" : ""\}/)
  assert.match(globalView, /Choose this app\\'s launch script before these requirements can run\./)
  assert.match(globalView, /clear_script: true/)
  assert.match(globalView, /selectedScript = ""/)
  assert.match(route, /Remove requirements before clearing this app's launch script\./)
})

test("app page does not fabricate launch requirement status from saved config", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")
  const homeAutolaunch = await fs.readFile(path.resolve(root, "server/autolaunch.js"), "utf8")

  assert.doesNotMatch(appView, /provisionalStatus/)
  assert.doesNotMatch(appView, /initialRequirementRows/)
  assert.doesNotMatch(appView, /autolaunch_dependency_apps/)
  assert.doesNotMatch(server, /autolaunch_dependency_apps/)
  assert.match(homeAutolaunch, /const configuredDependencies =/)
  assert.match(homeAutolaunch, /const waitingFor = autolaunchStatus \? statusWaitingFor : configuredDependencies/)
  assert.doesNotMatch(appView, /data\.(running|ready|script_state|running_scripts)/)
  assert.doesNotMatch(server, /script_state/)
})

test("launch settings visible labels use autolaunch wording", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const globalView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")
  const sidebar = await fs.readFile(path.resolve(root, "server/views/partials/main_sidebar.ejs"), "utf8")

  assert.match(appView, />Autolaunch</)
  assert.match(globalView, /<h1 class="task-title">Autolaunch<\/h1>/)
  assert.match(sidebar, />Autolaunch</)
  assert.doesNotMatch(globalView, /<h1 class="task-title">Launch settings<\/h1>/)
  assert.doesNotMatch(sidebar, />Launch settings</)
})

test("autolaunch page presents launch script choices before requirements", async () => {
  const globalView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")

  const currentIndex = globalView.indexOf('<h3 class="autolaunch-section-title">Current</h3>')
  const menuIndex = globalView.indexOf('${renderScriptSection("Menu scripts"')
  const otherIndex = globalView.indexOf('${renderScriptSection("Other local scripts"')
  const manualIndex = globalView.indexOf('<div class="autolaunch-manual">')
  const requirementsIndex = globalView.indexOf('${renderDependencySection(app)}')

  assert.notEqual(currentIndex, -1)
  assert.notEqual(menuIndex, -1)
  assert.notEqual(otherIndex, -1)
  assert.notEqual(manualIndex, -1)
  assert.notEqual(requirementsIndex, -1)
  assert.ok(currentIndex < menuIndex)
  assert.ok(menuIndex < otherIndex)
  assert.ok(otherIndex < manualIndex)
  assert.ok(manualIndex < requirementsIndex)
})

test("startup progress uses canonical ready-state progress instead of autolaunch mirrors", async () => {
  const kernelIndex = await fs.readFile(path.resolve(root, "kernel/index.js"), "utf8")
  const autolaunch = await fs.readFile(path.resolve(root, "kernel/autolaunch.js"), "utf8")
  const homeAutolaunch = await fs.readFile(path.resolve(root, "server/autolaunch.js"), "utf8")

  assert.doesNotMatch(kernelIndex, /autolaunch\.updateProgress/)
  assert.doesNotMatch(autolaunch, /updateProgress/)
  assert.match(homeAutolaunch, /getScriptProgress\(launchPath\)/)
})

test("app page launch requirement status uses the shared target status model", async () => {
  const kernelIndex = await fs.readFile(path.resolve(root, "kernel/index.js"), "utf8")
  const launchRequirements = await fs.readFile(path.resolve(root, "kernel/launch_requirements.js"), "utf8")
  const autolaunch = await fs.readFile(path.resolve(root, "kernel/autolaunch.js"), "utf8")

  assert.match(kernelIndex, /return this\.launchRequirements\.getStatus\(appId\)/)
  assert.match(kernelIndex, /launchRequirements\.markStartupStarted\(appId\)/)
  assert.match(kernelIndex, /launchRequirements\.markStartupReady\(appId\)/)
  assert.match(kernelIndex, /launchRequirements\.markStartupStopped\(appId\)/)
  assert.doesNotMatch(kernelIndex, /launchRequirements\.getStartupStatus/)
  assert.doesNotMatch(launchRequirements, /getStartupStatus\s*\(/)
  assert.doesNotMatch(launchRequirements, /launchStartupRoots\s*\(/)
  assert.match(launchRequirements, /markStartupStarted\(appId\)/)
  assert.doesNotMatch(autolaunch, /launchStartupRoots/)
  assert.doesNotMatch(autolaunch, /this\.status/)
  assert.doesNotMatch(autolaunch, /markStarted\(appId\)/)
  assert.doesNotMatch(autolaunch, /markReady\(appId\)/)
  assert.doesNotMatch(autolaunch, /markStopped\(appId\)/)
  assert.match(autolaunch, /startup: true/)
})

test("app page launch requirement status uses socket events instead of polling forever", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")
  const launchRequirements = await fs.readFile(path.resolve(root, "kernel/launch_requirements.js"), "utf8")

  assert.match(appView, /partials\/launch_requirements_status_client/)
  assert.match(statusClient, /new Socket\(\)/)
  assert.match(statusClient, /method: channel/)
  assert.match(statusClient, /type !== "launch\.requirements"/)
  assert.doesNotMatch(statusClient, /setTimeout\(poll,\s*1000\)/)
  assert.match(launchRequirements, /kernel\.launch_requirements:\$\{id\}/)
  assert.match(launchRequirements, /type: "launch\.requirements"/)
})

test("app page launch requirement status client is inert until launch config exists", async () => {
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")

  assert.match(server, /launch_requirements_status_enabled/)
  assert.match(server, /autolaunchAppState\.autolaunch/)
  assert.match(server, /autolaunchAppState\.autolaunch_depends/)
  assert.match(statusClient, /const initialEnabled =/)
  assert.match(statusClient, /if \(initialEnabled\) \{[\s\S]*startStatusClient\(\)[\s\S]*\} else \{[\s\S]*pinokio:launch-requirements-configured/)
  const startIndex = statusClient.indexOf("const startStatusClient = () => {")
  const gatedFetchIndex = statusClient.indexOf("fetchInitialStatus()", startIndex)
  const gateIndex = statusClient.indexOf("if (initialEnabled)")
  assert.ok(startIndex >= 0)
  assert.ok(gatedFetchIndex > startIndex)
  assert.ok(gatedFetchIndex < gateIndex)
  assert.match(appView, /const hasLaunchRequirementConfig = \(\) =>/)
  assert.match(appView, /window\.dispatchEvent\(new CustomEvent\("pinokio:launch-requirements-configured"\)\)/)
  assert.match(appView, /notifyLaunchRequirementsConfigured\(\)/)
})

test("embedded terminal launch requirement status defers to parent app overlay", async () => {
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")

  assert.match(statusClient, /shouldDeferToParentLaunchRequirements/)
  assert.match(statusClient, /window\.self === window\.top/)
  assert.match(statusClient, /window\.parent && window\.parent\.document/)
  assert.match(statusClient, /parentDocument\.querySelector\("\[data-launch-requirements-status\]"\)/)
  assert.match(statusClient, /if \(shouldDeferToParentLaunchRequirements\(\)\) return/)
})

test("app page launch requirement status shows spinners on active rows", async () => {
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")
  const styles = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_styles.ejs"), "utf8")

  assert.match(statusClient, /const isActiveRow =/)
  assert.match(statusClient, /launch-requirements-state\$\{stateClass\(row\)\}/)
  assert.match(statusClient, /fa-circle-notch fa-spin/)
  assert.doesNotMatch(statusClient, /launch-requirements-title">\s*<i class="fa-solid fa-circle-notch fa-spin"/)
  assert.match(styles, /\.launch-requirements-state\.is-active i/)
})

test("app page launch requirement status explains waiting rows and marks ready rows", async () => {
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")

  assert.match(statusClient, /const waitingForLabel =/)
  assert.match(statusClient, /Waiting for \$\{names\.join\(", "\)\}/)
  assert.match(statusClient, /stateLabel\(row, titleById\)/)
  assert.match(statusClient, /const isReadyRow =/)
  assert.match(statusClient, /fa-solid fa-check/)
  assert.match(statusClient, /is-ready/)
})

test("static guard: home autolaunch live status discovers rows after initial render", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")

  assert.match(homeView, /const getAutolaunchLines = \(state\) =>/)
  assert.match(homeView, /const requestHomeStatus = \(\) =>/)
  assert.match(homeView, /new XMLHttpRequest\(\)/)
  assert.doesNotMatch(homeView, /fetch\("\/pinokio\/home_status"/)
  assert.ok(homeView.includes('querySelectorAll(".home-app-line[data-autolaunch-app]")'))
  assert.match(homeView, /const runningApps = new Set\(Array\.isArray\(state && state\.running_apps\)/)
  assert.match(homeView, /const trackedApps = new Set\(Object\.entries\(apps\)/)
  assert.match(homeView, /const shouldDisplayAutolaunchStatus = \(app, status, apps, runningApps\) =>/)
  assert.match(homeView, /shouldDisplayAutolaunchStatus\(app, status, apps, runningApps\)/)
  assert.match(homeView, /for \(const app of runningApps\) \{[\s\S]*trackedApps\.add\(app\)/)
  assert.match(homeView, /autolaunchState && !shouldDisplayAutolaunchStatus\(app, autolaunchState, apps, runningApps\)/)
  assert.doesNotMatch(homeView, /<% if \(!launch_complete\) \{ %>\s*const startHomeAutolaunchPolling/)
  assert.match(homeView, /const initialLaunchComplete = <%= launch_complete \? "true" : "false" %>/)
  assert.match(homeView, /if \(initialLaunchComplete && !hasVisibleStartupRows\(\)\) \{\s*return\s*\}/)
  assert.match(homeView, /const maxPollAttempts = 240/)
  assert.match(homeView, /attempts \+= 1/)
  assert.match(homeView, /const shouldContinueHomeStatusPolling = \(state\) =>/)
  assert.match(homeView, /if \(!shouldContinueHomeStatusPolling\(state\)\) \{\s*stopPolling\(\)\s*\}/)
  assert.match(homeView, /if \(hasVisibleStartupRows\(\)\) \{\s*return true\s*\}/)
  assert.match(homeView, /return !\(state && state\.launch_complete\)/)
  assert.match(homeView, /if \(isPreparingAutolaunchState\(autolaunchState\)\)/)
  assert.doesNotMatch(homeView, /autolaunchState && !\["ready", "blocked", "failed", "timeout"\]\.includes\(autolaunchState\.state \|\| ""\) && !state\.launch_complete/)
  assert.match(homeView, /chip = document\.createElement\("span"\)/)
  assert.match(homeView, /chip\.className = "home-autolaunch-status"/)
  assert.match(homeView, /notRunning\.forEach[\s\S]*data-autolaunch-app="<%=item\.uri%>"/)
  assert.match(homeView, /console\.warn\("\[home\] autolaunch status update failed", error\)/)
  assert.doesNotMatch(homeView, /catch \(error\) \{\s*\}/)
})

test("home running buttons only show spinner while startup label is active", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")

  assert.match(homeView, /const syncStopButtonSpinner = \(button, show\) =>/)
  assert.match(homeView, /syncStopButtonSpinner\(button, !!displayLabel\)/)
  assert.match(homeView, /<% if \(isStartingAutolaunchScript\) \{ %>\s*<i class='home-stop-spinner fa-solid fa-spin fa-circle-notch'/)
  assert.match(homeView, /const active = new Set\(\)/)
  assert.match(homeView, /if \(!active\.has\(identity\)\) \{\s*button\.remove\(\)/)
  assert.match(homeView, /const markAutolaunchIdle = \(line\) => \{[\s\S]*syncStopButtons\(line, \[\]\)/)
})

test("launch requirements are not controlled by DOM markers or query parameters", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const terminalView = await fs.readFile(path.resolve(root, "server/views/terminal.ejs"), "utf8")
  const menuPartial = await fs.readFile(path.resolve(root, "server/views/partials/menu.ejs"), "utf8")
  const dynamicPartial = await fs.readFile(path.resolve(root, "server/views/partials/dynamic.ejs"), "utf8")
  const launchRequirements = await fs.readFile(path.resolve(root, "kernel/launch_requirements.js"), "utf8")

  assert.doesNotMatch(menuPartial, /data-launch-requirements-primary/)
  assert.doesNotMatch(dynamicPartial, /data-launch-requirements-primary/)
  assert.doesNotMatch(appView, /__pinokio_launch_requirements/)
  assert.doesNotMatch(terminalView, /launchRequirementsPrimary/)
  assert.doesNotMatch(terminalView, /__pinokio_launch_requirements/)
  assert.doesNotMatch(terminalView, /launch_requirements_primary/)
  assert.doesNotMatch(launchRequirements, /launch_requirements_primary/)
  assert.match(launchRequirements, /configuredLaunchScript && requestedScript === config\.configuredLaunchScript/)
})

test("launch settings dependency save flow is shared", async () => {
  const factory = await fs.readFile(path.resolve(root, "server/views/partials/launch_settings_dependency_save_factory.ejs"), "utf8")
  const appSave = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_dependency_save.ejs"), "utf8")
  const pageSave = await fs.readFile(path.resolve(root, "server/views/partials/autolaunch_dependency_save.ejs"), "utf8")

  assert.match(factory, /fetch\("\/autolaunch\/dependencies"/)
  assert.match(appSave, /createLaunchSettingsDependencySaver/)
  assert.match(pageSave, /createLaunchSettingsDependencySaver/)
  assert.doesNotMatch(appSave, /fetch\("\/autolaunch\/dependencies"/)
  assert.doesNotMatch(pageSave, /fetch\("\/autolaunch\/dependencies"/)
})

test("launch settings block adding requirements without owning launch script", async () => {
  const appEvents = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_dependency_events.ejs"), "utf8")
  const pageView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")

  assert.match(appEvents, /selectedScript \|\| state\.autolaunch/)
  assert.match(appEvents, /Choose this app's launch script before adding requirements\./)
  assert.match(pageView, /selectedScript \|\| app\.autolaunch/)
  assert.match(pageView, /Choose this app's launch script before adding requirements\./)
})

test("launch settings UI sends selected script with explicit startup enabled state", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const globalView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")

  assert.match(appView, /saveScript\(selectedScript, !!state\.autolaunch_enabled\)/)
  assert.match(globalView, /saveScript\(selectedScript, !!app\.autolaunch_enabled\)/)
})

test("launch settings dependency script loader is shared", async () => {
  const factory = await fs.readFile(path.resolve(root, "server/views/partials/launch_settings_dependency_script_loader_factory.ejs"), "utf8")
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const pageView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")

  assert.match(factory, /fetch\(`\/autolaunch\/candidates\?app=\$\{encodeURIComponent\(appId\)\}`/)
  assert.match(appView, /createLaunchSettingsDependencyScriptLoader/)
  assert.match(pageView, /createLaunchSettingsDependencyScriptLoader/)
  assert.doesNotMatch(appView, /dependencyScriptCandidates\[dependencyId\] = \{ loading: true \}/)
  assert.doesNotMatch(pageView, /dependencyScriptCandidates\[appId\] = \{ loading: true \}/)
})

test("launch settings opens dependency script picker before saving a new dependency", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const appEvents = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_dependency_events.ejs"), "utf8")
  const pageView = await fs.readFile(path.resolve(root, "server/views/autolaunch.ejs"), "utf8")
  const appHelpers = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_modal_helpers.ejs"), "utf8")
  const pageHelpers = await fs.readFile(path.resolve(root, "server/views/partials/autolaunch_dependency_helpers.ejs"), "utf8")
  const appStyles = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_dependency_styles.ejs"), "utf8")
  const pageStyles = await fs.readFile(path.resolve(root, "server/views/partials/autolaunch_dependency_styles.ejs"), "utf8")

  assert.match(appEvents, /pendingDependencyId = dependency[\s\S]*dependencyScriptPickerOpen = dependency[\s\S]*loadDependencyScriptCandidates\(dependency\)/)
  assert.match(pageView, /pendingDependencyId = dependency;[\s\S]*dependencyScriptPickerOpen = dependency;[\s\S]*loadDependencyScriptCandidates\(dependency\);/)
  assert.match(appView, /if \(pendingDependencyId === dependencyId\) \{[\s\S]*dependencies\.concat\(dependencyId\)[\s\S]*"Requirement saved\."/)
  assert.match(pageView, /if \(pendingDependencyId === appId\) \{[\s\S]*dependencies\.concat\(appId\)[\s\S]*"Requirement saved\."/)
  assert.match(appHelpers, /app-autolaunch-dependency-script-modal/)
  assert.match(appHelpers, /data-app-autolaunch-dependency-script-choice/)
  assert.match(appHelpers, /data-app-autolaunch-confirm-dependency-script/)
  assert.match(appHelpers, /app-autolaunch-primary-script/)
  assert.match(appStyles, /\.app-autolaunch-dependency-script-actions \{[\s\S]*position: sticky;/)
  assert.match(appStyles, /\.app-autolaunch-primary \{[\s\S]*appearance: none;[\s\S]*width: 100%;/)
  assert.match(pageHelpers, /autolaunch-dependency-script-modal/)
  assert.match(pageHelpers, /data-dependency-script-choice/)
  assert.match(pageHelpers, /data-confirm-dependency-script/)
  assert.match(pageHelpers, /autolaunch-primary-script/)
  assert.match(pageStyles, /\.autolaunch-dependency-script-actions \{[\s\S]*position: sticky;/)
  assert.match(pageStyles, /\.autolaunch-primary \{[\s\S]*appearance: none;[\s\S]*width: 100%;/)
  assert.doesNotMatch(appHelpers, /Choose launch script/)
  assert.doesNotMatch(pageHelpers, /Choose launch script/)
})

test("app launch settings busy state preserves rule-disabled controls", async () => {
  const appHelpers = await fs.readFile(path.resolve(root, "server/views/partials/app_autolaunch_modal_helpers.ejs"), "utf8")

  assert.match(appHelpers, /data-app-autolaunch-disabled-before-busy/)
  assert.match(appHelpers, /control\.setAttribute\(attr, control\.disabled \? "true" : "false"\)/)
  assert.match(appHelpers, /control\.disabled = previous === "true"/)
  assert.doesNotMatch(appHelpers, /scriptsEl\.querySelectorAll\("button"\)[\s\S]*control\.disabled = saving \|\| savingDependencyScript/)
  assert.doesNotMatch(appHelpers, /dependenciesEl\.querySelectorAll\("button, input"\)[\s\S]*control\.disabled = saving \|\| savingDependencies \|\| savingDependencyScript/)
})

test("static guard: blocked requirement choose script has an app-page handler and terminal fallback", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")
  const styles = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_styles.ejs"), "utf8")

  assert.match(statusClient, /new CustomEvent\("pinokio:launch-requirements-choose-script", \{[\s\S]*cancelable: true/)
  assert.match(statusClient, /class="fa-solid fa-file-code"/)
  assert.match(styles, /\.launch-requirements-choose-script \{[\s\S]*appearance: none;/)
  assert.match(styles, /\.launch-requirements-choose-script \{[\s\S]*font: inherit;/)
  assert.match(styles, /\.launch-requirements-choose-script \{[\s\S]*border-radius: 6px;/)
  assert.match(styles, /\.launch-requirements-choose-script:focus-visible/)
  assert.match(statusClient, /if \(!chooseEvent\.defaultPrevented\) \{[\s\S]*window\.location\.href = `\/v\/\$\{encodeURIComponent\(dependencyApp\)\}\?autolaunch=1`/)
  assert.match(appView, /pinokio:launch-requirements-choose-script[\s\S]*event\.preventDefault\(\)/)
  assert.match(appView, /params\.get\("autolaunch"\) !== "1"/)
  assert.match(appView, /setOpen\(true\)[\s\S]*await loadCandidates\(\)/)
})

test("static guard: terminal resets run control on launch requirement control packets", async () => {
  const terminalView = await fs.readFile(path.resolve(root, "server/views/terminal.ejs"), "utf8")
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")

  assert.match(terminalView, /packet\.type === "launch\.requirements\.control"/)
  assert.match(terminalView, /packet\.type === "launch\.requirements\.control"[\s\S]*runControls\.set\("idle"\)/)
  assert.match(terminalView, /packet\.type === "launch\.requirements\.control"[\s\S]*#progress-window[\s\S]*classList\.add\("hidden"\)/)
  assert.match(statusClient, /notifyLaunchRequirementsControl\({[\s\S]*action: "cancelled"[\s\S]*app_id: appId/)
  assert.match(statusClient, /window\.frames\[i\]\.postMessage\(payload, "\*"\)/)
  assert.match(terminalView, /window\.addEventListener\("message"[\s\S]*data\.type !== "pinokio:launch-requirements-control"[\s\S]*runControls\.set\("idle"\)/)
})

test("static guard: open without launching is not wired to launch requirement status", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const homeActionModal = await fs.readFile(path.resolve(root, "server/views/partials/home_action_modal.ejs"), "utf8")
  const statusClient = await fs.readFile(path.resolve(root, "server/views/partials/launch_requirements_status_client.ejs"), "utf8")

  assert.match(homeActionModal, /Open without launching/)
  assert.match(homeActionModal, /class='home-mode-command home-browse' data-src='<%= item\.view_url %>'/)
  assert.match(homeActionModal, /Open dev mode/)
  assert.match(homeActionModal, /const homeActionsAppId = item && \(item\.uri \|\| item\.path \|\| item\.name\)/)
  assert.match(homeActionModal, /pinokio_home_select: JSON\.stringify/)
  assert.match(homeActionModal, /target: "env-settings"/)
  assert.match(homeActionModal, /href='<%= homeActionsSettingsHref %>'/)
  assert.match(homeActionModal, /Settings/)
  assert.doesNotMatch(homeActionModal, /home-actions-tabs|home-actions-tab|role='tab'|role='tabpanel'/)
  assert.doesNotMatch(homeActionModal, /Open files mode/)
  assert.doesNotMatch(homeActionModal, /launch.requirements|data-launch-requirements|frame-link/)
  assert.match(homeView, /if \(target\) \{[\s\S]*window\.PinokioHomeGuardNavigate\(src\)[\s\S]*location\.href = src/)
  assert.match(statusClient, /const status = data && data\.ok \? data\.status : null/)
  assert.doesNotMatch(statusClient, /saved requirement/)
})

test("home actions modal renders an app settings link", async () => {
  const html = await ejs.renderFile(path.resolve(root, "server/views/partials/home_action_modal.ejs"), {
    id: "home-actions-test",
    item: {
      icon: "",
      name: "Test App",
      filepath: "/tmp/pinokio/api/test app.git",
      uri: "test app.git",
      menu: [],
      view_url: "/v/test%20app.git",
      dev_url: "/p/test%20app.git/dev",
      url: "/p/test%20app.git",
      terminal_online_count: 0,
      running: false
    }
  })

  const hrefMatch = html.match(/href='([^']+)'/)
  assert.ok(hrefMatch)
  const href = new URL(hrefMatch[1], "http://127.0.0.1")
  assert.equal(href.pathname, "/v/test%20app.git")
  const payload = JSON.parse(href.searchParams.get("pinokio_home_select"))
  assert.deepEqual(payload, {
    target: "env-settings",
    hrefAttr: "/env/api/test app.git?host=app",
    textValue: "Settings"
  })
  assert.match(html, />\s*Settings\s*</)
})

test("home exposes Home Server app sharing from row and action drawer", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const homeActionModal = await fs.readFile(path.resolve(root, "server/views/partials/home_action_modal.ejs"), "utf8")
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")

  assert.match(server, /ready_url: readyUrl/)
  assert.match(server, /external_ready_urls: externalReadyUrls/)
  assert.match(server, /this\.appRegistry\.buildExternalReadyUrls\(readyUrl\)/)
  assert.match(server, /findHomeShareReadyUrlFromMenu\(menu = \[\]\)/)
  assert.match(server, /readyUrl = this\.findHomeShareReadyUrlFromMenu\(x\.menu\)/)
  assert.match(homeView, /class='btn home-icon-btn open-app-share-modal'/)
  assert.match(homeView, /fa-solid fa-wifi/)
  assert.match(homeView, /data-app-id="<%= item\.uri %>"/)
  assert.match(homeView, /data-app-external-ready-urls="<%= JSON\.stringify\(runningShareExternalReadyUrls\) %>"/)
  assert.match(homeView, /const requestHomeAppShareStatus = async \(appId = ""\) =>/)
  assert.match(homeView, /fetch\(`\/apps\/status\/\$\{encodeURIComponent\(normalizedAppId\)\}`/)
  assert.match(homeView, /updateHomeShareButtonStatus\(button, appStatus\)/)
  assert.match(homeView, /const requestHomeNetworkSharingStatus = async \(\) =>/)
  assert.match(homeView, /fetch\("\/info\/network-sharing", \{ cache: "no-store" \}\)/)
  assert.match(homeView, /const homeShareTitleHtml = \(label\) =>/)
  assert.match(homeView, /home-app-share-modal__title-icon/)
  assert.match(homeView, /home-app-share-modal__title-meta/)
  assert.match(homeView, /home-app-share-modal__scan-card/)
  assert.match(homeView, /home-app-share-modal__share-card/)
  assert.match(homeView, /Scan to open/)
  assert.match(homeView, /title: homeShareTitleHtml\(title\)/)
  assert.match(homeView, /Install Home Server support/)
  assert.match(homeView, /Turn on Home Server/)
  assert.match(homeView, /Home Server support is installed but turned off/)
  assert.match(homeView, /Open Home Server settings/)
  assert.doesNotMatch(homeView, /Same-Wi-Fi/)
  assert.doesNotMatch(homeView, /Network module/)
  assert.doesNotMatch(homeView, /local routing service/)
  assert.match(homeActionModal, /class='home-mode-command home-share-app'/)
  assert.match(homeActionModal, /data-app-id='<%= homeActionsAppId %>'/)
  assert.match(homeActionModal, />Open on another device</)
  assert.match(homeActionModal, />Home Server</)
})

test("home actions modal renders Home Server app sharing data for running apps", async () => {
  const html = await ejs.renderFile(path.resolve(root, "server/views/partials/home_action_modal.ejs"), {
    id: "home-actions-share-test",
    item: {
      icon: "",
      name: "Test App",
      filepath: "/tmp/pinokio/api/test app.git",
      uri: "test app.git",
      menu: [],
      view_url: "/v/test%20app.git",
      dev_url: "/p/test%20app.git/dev",
      url: "/p/test%20app.git",
      terminal_online_count: 0,
      running: true,
      ready_url: "http://127.0.0.1:42004",
      external_ready_urls: [{ url: "http://192.168.86.229:42111", transport: "ip", scope: "lan" }]
    }
  })

  const dom = new JSDOM(html)
  const button = dom.window.document.querySelector(".home-share-app")
  assert.ok(button)
  assert.equal(button.getAttribute("data-app-id"), "test app.git")
  assert.equal(button.getAttribute("data-app-name"), "Test App")
  assert.equal(button.getAttribute("data-app-ready-url"), "http://127.0.0.1:42004")
  assert.deepEqual(JSON.parse(button.getAttribute("data-app-external-ready-urls")), [
    { url: "http://192.168.86.229:42111", transport: "ip", scope: "lan" }
  ])
})

test("home app sharing falls back to loopback Web UI menu targets", () => {
  const server = Object.create(Server.prototype)
  server.appRegistry = {
    isLoopbackHostname(hostname) {
      return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || hostname.startsWith("127.")
    }
  }

  assert.equal(server.findHomeShareReadyUrlFromMenu([
    { btn: "Terminal", href: "/api/cropper.git/start.js" },
    { btn: "Open Web UI", target: "@http://127.0.0.1:42004", href: "http://127.0.0.1:42004" }
  ]), "http://127.0.0.1:42004/")
  assert.equal(server.findHomeShareReadyUrlFromMenu([
    { btn: "Docs", href: "https://example.com" }
  ]), "")
})

test("global home server popover exposes machine and app sharing from the navbar", async () => {
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")
  const popover = await fs.readFile(path.resolve(root, "server/views/partials/home_server_popover.ejs"), "utf8")
  const assets = await fs.readFile(path.resolve(root, "server/views/partials/home_server_popover_assets.ejs"), "utf8")
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const networkView = await fs.readFile(path.resolve(root, "server/views/network.ejs"), "utf8")
  const netView = await fs.readFile(path.resolve(root, "server/views/net.ejs"), "utf8")
  const sharedNav = await fs.readFile(path.resolve(root, "server/views/partials/app_navheader.ejs"), "utf8")
  const exploreView = await fs.readFile(path.resolve(root, "server/views/explore.ejs"), "utf8")
  const settingsView = await fs.readFile(path.resolve(root, "server/views/settings.ejs"), "utf8")
  const terminalView = await fs.readFile(path.resolve(root, "server/views/terminal.ejs"), "utf8")
  const normalHeaderViews = await Promise.all([
    "create.ejs",
    "keys.ejs",
    "env_editor.ejs",
    "task.ejs",
    "general_editor.ejs",
    "editor.ejs",
    "shell.ejs",
    "pro.ejs"
  ].map(async (file) => [file, await fs.readFile(path.resolve(root, "server/views", file), "utf8")]))

  assert.match(server, /async getNetworkSharingStatus\(\)/)
  assert.match(server, /if \(running\) \{\s*installed = true\s*\}/)
  assert.match(server, /this\.app\.get\("\/info\/home-server"/)
  assert.match(server, /buildHomeServerShellUrl\(peerInfo\)/)
  assert.match(server, /collectHomeServerMachines\(peerInfo\)/)
  assert.match(server, /collectHomeServerApps\(\)/)
  assert.match(server, /collectHomeServerRoutes\(peerInfo, apps, \[shellUrl\]\)/)
  assert.match(server, /status === "on" \? await this\.collectHomeServerApps\(\) : \[\]/)
  assert.match(server, /status === "on" \? this\.collectHomeServerRoutes\(peerInfo, apps, \[shellUrl\]\) : \[\]/)
  assert.match(server, /machines/)
  assert.match(server, /routes/)
  assert.match(popover, /data-home-server-popover/)
  assert.match(popover, /data-home-server-trigger/)
  assert.match(popover, /data-home-server-panel/)
  assert.match(assets, /right: 0;/)
  assert.match(assets, /width: 420px;/)
  assert.match(assets, /max-height: calc\(100vh - 90px\);/)
  assert.match(assets, /data-home-server-open="true"/)
  assert.match(assets, /body\.dark \.home-server-popover__pill \{/)
  assert.match(assets, /body\.dark \.home-server-popover__pill\.is-on/)
  assert.match(assets, /body\.dark \.home-server-popover__switch \{/)
  assert.match(assets, /home-server-popover__switch\[aria-checked="true"\]:disabled/)
  assert.match(assets, /body\.dark \.home-server-popover__footer-note/)
  assert.match(assets, /body\.dark \.home-server-popover__warning \{/)
  assert.match(assets, /body\.dark \.home-server-popover__spinner \{/)
  assert.doesNotMatch(assets, /data-home-server-status="on"] \.home-server-popover__trigger/)
  assert.match(assets, /fetch\("\/info\/home-server", \{ cache: "no-store" \}\)/)
  assert.match(assets, /const shouldPollState = \(data\) =>/)
  assert.match(assets, /return !app\.url \|\| \(state && state !== "ready"\)/)
  assert.match(assets, /refreshPolling\(payload\)/)
  assert.match(assets, /closePanel[\s\S]*stopPolling\(\)/)
  assert.match(assets, /document\.addEventListener\("pointerdown"[\s\S]*true\)/)
  assert.match(assets, /document\.addEventListener\("click"[\s\S]*true\)/)
  assert.match(assets, /const isEmbeddedFrame = \(element\) =>/)
  assert.match(assets, /tagName === "IFRAME" \|\| tagName === "WEBVIEW"/)
  assert.match(assets, /const closeIfFrameFocused = \(\) =>/)
  assert.match(assets, /document\.addEventListener\("focusin"[\s\S]*isEmbeddedFrame\(event\.target\)[\s\S]*true\)/)
  assert.match(assets, /window\.addEventListener\("blur"[\s\S]*closeIfFrameFocused/)
  assert.match(assets, /data-home-server-switch/)
  assert.match(assets, /const switchChecked = status === "on" \|\| status === "starting"/)
  assert.match(assets, /Use this computer as a Home Server/)
  assert.match(assets, /open Pinokio and running app Web UIs from phones, tablets, and other computers/)
  assert.match(assets, /Turning on Home Server/)
  assert.match(assets, /Preparing Pinokio and running app Web UIs for phones, tablets, and other computers/)
  assert.match(assets, /Links will appear here when Home Server is ready/)
  assert.match(assets, /Preparing Home Server link/)
  assert.match(assets, /could not turn on Home Server/)
  assert.doesNotMatch(assets, /Creating local routes/)
  assert.doesNotMatch(assets, /Creating home-network route/)
  assert.doesNotMatch(assets, /local network routes/)
  assert.doesNotMatch(assets, /network router/)
  assert.match(assets, /fetch\("\/network", \{/)
  assert.match(assets, /PINOKIO_NETWORK_ACTIVE: active \? "1" : "0"/)
  assert.match(assets, /PINOKIO_HTTPS_ACTIVE: active \? "1" : "0"/)
  assert.match(assets, /fetch\("\/restart", \{ method: "post" \}\)/)
  assert.match(assets, /Home Server support is not installed/)
  assert.match(assets, /Install Home Server support/)
  assert.match(assets, /Network settings/)
  assert.match(assets, /home-server-popover__footer-row/)
  assert.match(assets, /No running app Web UIs yet/)
  assert.match(assets, /home-server-popover__app-row is-shell[\s\S]{0,300}home-server-popover__app-dot/)
  assert.doesNotMatch(assets, /home-server-popover__app-row is-shell[\s\S]{0,300}fa-solid fa-wifi/)
  assert.match(assets, /Other local services/)
  assert.match(assets, /routesHtml\(data\.routes\)/)
  assert.match(assets, /home-server-popover__app-row is-route[\s\S]{0,220}home-server-popover__app-dot/)
  assert.doesNotMatch(assets, /home-server-popover__app-icon/)
  assert.match(assets, /Available machines/)
  assert.match(assets, /home-server-popover__machine-link/)
  assert.match(assets, /data-home-server-qr/)
  assert.match(assets, /data-home-server-qr-preview/)
  assert.match(assets, /showQrPreview\(/)
  assert.doesNotMatch(assets, /href="\$\{escapeHtml\(qrUrl\)\}"[\s\S]*Show QR code/)
  assert.match(assets, /target="_blank" rel="noreferrer" title="\$\{escapeHtml\(url\)\}"/)
  assert.match(assets, /View routes/)
  assert.match(assets, /Only devices on this local network can open these links\./)
  assert.match(homeView, /partials\/home_server_popover/)
  assert.match(homeView, /partials\/home_server_popover_assets/)
  assert.match(appView, /partials\/home_server_popover/)
  assert.match(appView, /partials\/home_server_popover_assets/)
  assert.match(networkView, /partials\/home_server_popover/)
  assert.match(networkView, /partials\/home_server_popover_assets/)
  assert.match(netView, /partials\/home_server_popover/)
  assert.match(netView, /partials\/home_server_popover_assets/)
  assert.match(sharedNav, /include\('home_server_popover'\)/)
  assert.match(sharedNav, /include\('home_server_popover_assets'\)/)
  assert.match(exploreView, /partials\/home_server_popover/)
  assert.match(exploreView, /partials\/home_server_popover_assets/)
  assert.match(settingsView, /partials\/home_server_popover/)
  assert.match(settingsView, /partials\/home_server_popover_assets/)
  assert.match(terminalView, /partials\/home_server_popover/)
  assert.match(terminalView, /partials\/home_server_popover_assets/)
  for (const [file, source] of normalHeaderViews) {
    assert.match(source, /partials\/home_server_popover/, `${file} includes the Home Server popover`)
    assert.match(source, /partials\/home_server_popover_assets/, `${file} includes the Home Server popover assets`)
  }
  assert.doesNotMatch(appView, /open-app-share-modal/)
})

test("navbar URL picker is hidden without removing URL dropdown behavior", async () => {
  const styles = await fs.readFile(path.resolve(root, "server/public/urldropdown.css"), "utf8")
  const script = await fs.readFile(path.resolve(root, "server/public/urldropdown.js"), "utf8")

  assert.match(styles, /header\.navheader \.urlbar\s*\{\s*pointer-events: none;\s*visibility: hidden;\s*\}/)
  assert.match(styles, /header\.navheader #mobile-link-button\s*\{\s*display: none !important;\s*\}/)
  assert.match(script, /function initUrlDropdown\(config = \{\}\)/)
  assert.match(script, /ensureFallbackInput/)
  assert.match(script, /fetchApps\(\)/)
  assert.match(script, /fetchProcesses\(\)/)
  assert.match(script, /showMobileModal/)
})

test("app navbar stays on one line when app identity and Home Server controls are present", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")

  assert.match(appView, /body\.app-page > header\.navheader h1\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*flex-wrap:\s*nowrap;/)
  assert.match(appView, /body\.app-page > header\.navheader h1 > \.home,[\s\S]*body\.app-page > header\.navheader h1 > \.home-server-popover\s*\{[\s\S]*flex:\s*0 0 auto;/)
  assert.match(appView, /body\.app-page header\.navheader h1 > \.flexible\s*\{[\s\S]*flex:\s*0 0 0;[\s\S]*margin-left:\s*auto;/)
  assert.match(appView, /\.app-header-identity\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*max-width:\s*none;/)
  assert.match(appView, /\.app-header-info\s*\{[\s\S]*flex:\s*0 1 auto;/)
  const identityTriggerStart = appView.indexOf(".app-header-info-trigger {")
  const identityTriggerEnd = appView.indexOf("\n}", identityTriggerStart)
  const identityTriggerRule = identityTriggerStart >= 0 && identityTriggerEnd > identityTriggerStart
    ? appView.slice(identityTriggerStart, identityTriggerEnd)
    : ""
  assert.match(identityTriggerRule, /max-width:\s*min\(260px, 32vw\);/)
  assert.doesNotMatch(identityTriggerRule, /width:\s*100%;/)
  assert.doesNotMatch(identityTriggerRule, /max-width:\s*none;/)
  assert.doesNotMatch(appView, /nav-action-label\s*\{[^}]*display:\s*none;/)
  const compactRuleStart = appView.indexOf("@media only screen and (max-width: 1180px)")
  const compactRuleEnd = appView.indexOf(".resource-usage {", compactRuleStart)
  const compactHeaderRule = compactRuleStart >= 0 && compactRuleEnd > compactRuleStart
    ? appView.slice(compactRuleStart, compactRuleEnd)
    : ""
  assert.match(compactHeaderRule, /body\.app-page header\.navheader \.resource-usage-trigger\s*\{[\s\S]*gap:\s*4px;[\s\S]*padding:\s*0 3px;/)
  assert.doesNotMatch(compactHeaderRule, /\.resource-chip--(?:cpu|ram|vram)[\s\S]*display:\s*none !important;/)
})

test("download page header does not show browser chrome controls", async () => {
  const downloadView = await fs.readFile(path.resolve(root, "server/views/download.ejs"), "utf8")

  assert.match(downloadView, /<header class='grabbable'>[\s\S]*<a class='home' href="\/home">[\s\S]*<div class='flexible'><\/div>[\s\S]*<\/header>/)
  assert.doesNotMatch(downloadView, /id=['"]minimize-header['"]/)
  assert.doesNotMatch(downloadView, /pinokio-explore-nav-button/)
  assert.doesNotMatch(downloadView, /id=['"]back['"]/)
  assert.doesNotMatch(downloadView, /id=['"]forward['"]/)
  assert.doesNotMatch(downloadView, /id=['"]refresh-page['"]/)
  assert.doesNotMatch(downloadView, /id=['"]screenshot['"]/)
  assert.doesNotMatch(downloadView, /id=['"]inspector['"]/)
  assert.doesNotMatch(downloadView, /href="\/columns"/)
  assert.doesNotMatch(downloadView, /href="\/rows"/)
  assert.doesNotMatch(downloadView, /id=['"]new-window['"]/)
})

test("home server dropdown exposes router-discovered non-Pinokio routes separately", () => {
  const server = Object.create(Server.prototype)
  const routes = server.collectHomeServerRoutes({
    router_info: [
      {
        name: "node",
        title: "Pinokio",
        port: "42000",
        external_hosts: [{ url: "192.168.86.229:42003", scope: "lan", interface: "en0" }]
      },
      {
        name: "node",
        title: "theDAW",
        port: "5173",
        external_hosts: [{ url: "192.168.86.229:42015", scope: "lan", interface: "en0" }]
      },
      {
        name: "python",
        port: "8600",
        external_hosts: [{ url: "192.168.86.229:42016", scope: "lan", interface: "en0" }]
      },
      {
        name: "chrome-headless-shell",
        port: "58738",
        external_ip: "192.168.86.229:42030"
      }
    ]
  }, [{
    name: "theDAW",
    url: "http://192.168.86.229:42015/",
    external_ready_urls: [{ url: "http://192.168.86.229:42015/" }]
  }], ["http://192.168.86.229:42003"])

  assert.deepEqual(routes, [
    {
      name: "chrome-headless-shell",
      port: "58738",
      url: "http://192.168.86.229:42030",
      urls: [{ url: "http://192.168.86.229:42030", scope: "lan", interface: "" }],
      state: "ready"
    },
    {
      name: "python",
      port: "8600",
      url: "http://192.168.86.229:42016",
      urls: [{ url: "http://192.168.86.229:42016", scope: "lan", interface: "en0" }],
      state: "ready"
    }
  ])
})

test("network page merges current machine route inventory without redirecting away", async () => {
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")
  const networkView = await fs.readFile(path.resolve(root, "server/views/network.ejs"), "utf8")

  assert.match(server, /res\.render\("network", \{[\s\S]*selected_name: this\.kernel\.peer\.name/)
  assert.match(server, /res\.render\("network", \{[\s\S]*routeCount/)
  assert.match(server, /res\.render\("network", \{[\s\S]*allow_dns_creation/)
  assert.match(networkView, /<h1 class='task-title'>Home Server<\/h1>/)
  assert.match(networkView, /partials\/net_summary/)
  assert.match(networkView, /This machine routes/)
  assert.match(networkView, /partials\/net_route_list/)
  assert.match(networkView, /data-net-routes-endpoint="\/net\/<%= encodeURIComponent\(selected_name\) %>\/routes"/)
  assert.match(networkView, /const netRoutesEndpoint = routeListEl/)
  assert.match(networkView, /fetch\(netRoutesEndpoint, \{ cache: "no-store" \}\)/)
  assert.match(networkView, /class='dns-modal'/)
  assert.match(networkView, /event\.target\.closest\('\.get-dns-btn'\)/)
  assert.doesNotMatch(networkView, /location\.href = "\/net\/" \+ res\.peer_name/)
  assert.match(networkView, /location\.href = "\/network"/)
})

test("home server machine rows use peer shell URLs as primary destinations", () => {
  const server = Object.create(Server.prototype)
  server.port = 42000
  server.kernel = {
    peer: {
      active: true,
      host: "192.168.86.229",
      info: {
        "192.168.86.229": {
          active: true,
          host: "192.168.86.229",
          name: "p229",
          platform: "darwin",
          port_mapping: { "42000": 42003 },
          router_info: []
        },
        "192.168.86.120": {
          active: true,
          host: "192.168.86.120",
          name: "studio",
          platform: "darwin",
          port_mapping: { "42000": 42009 },
          router_info: [{ external_router: ["studio.localhost"] }],
          installed: [{ name: "cropper" }],
          rewrite_mapping: { web: {} }
        },
        "192.168.86.121": {
          active: true,
          host: "192.168.86.121",
          name: "offline-route",
          platform: "linux",
          port_mapping: {},
          router_info: []
        }
      }
    }
  }

  const rows = server.collectHomeServerMachines({ host: "192.168.86.229" })

  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    name: "studio",
    host: "192.168.86.120",
    platform: "darwin",
    url: "http://192.168.86.120:42009",
    available: true,
    current: false,
    route_url: "/net/studio",
    route_count: 3
  })
  assert.equal(rows[1].name, "offline-route")
  assert.equal(rows[1].url, null)
  assert.equal(rows[1].available, false)
  assert.equal(rows[1].route_url, "/net/offline-route")

  server.port = 43000
  assert.equal(server.buildHomeServerShellUrl({
    host: "192.168.86.229",
    port_mapping: { "42000": 42003 }
  }), "")
})

test("home actions drawer background follows the home page surface", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")

  assert.match(homeView, /body\.is-home \{[\s\S]*--home-page-nav-bg: #ffffff;[\s\S]*background: #ffffff;/)
  assert.match(homeView, /body\.dark\.is-home \{[\s\S]*--home-page-nav-bg: #1b1c1d;[\s\S]*background: #1b1c1d;/)
  assert.match(homeView, /\.home-actions-dialog \{[\s\S]*background: var\(--home-page-nav-bg, #ffffff\);/)
  assert.match(homeView, /body\.dark \.home-actions-dialog \{[\s\S]*background: var\(--home-page-nav-bg, #1b1c1d\);/)
  assert.doesNotMatch(homeView, /body\.dark \.home-actions-dialog \{[\s\S]*background: rgba\(18, 20, 25, 0\.98\);/)
})

test("home run menu gives block labels valid padded layout", async () => {
  const homeView = await fs.readFile(path.resolve(root, "server/views/index.ejs"), "utf8")
  const html = await ejs.renderFile(path.resolve(root, "server/views/partials/home_run_menu.ejs"), {
    app: {
      view_url: "/v/test-app"
    },
    menu: [{
      icon: "fa-regular fa-circle-xmark",
      btn: '<i class="fa-regular fa-circle-xmark"></i><div><strong>Reset</strong><div>Revert to pre-install state</div></div>',
      href: "reset.js"
    }]
  })

  assert.match(html, /class='home-run-command has-block-label'/)
  assert.match(html, /<div class='home-run-menu-label has-block-content'>/)
  assert.doesNotMatch(html, /<span class='home-run-menu-label/)
  assert.match(homeView, /\.home-run-command\.has-block-label,[\s\S]*\.home-run-menu-summary\.has-block-label \{[\s\S]*padding-top: 8px;[\s\S]*padding-bottom: 8px;/)
  assert.match(homeView, /\.home-run-menu-label\.has-block-content \{[\s\S]*white-space: normal;/)
})

test("static guard: open without launching disables page-load script frame selection", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")

  assert.match(appView, /const openWithoutLaunching = <%- JSON\.stringify\(type === "run" && !autoselect\) %>/)
  assert.match(appView, /const automaticSelectionDisabled = openWithoutLaunching && !triggeredByUser/)
  assert.match(appView, /let persistedSelectionRaw = automaticSelectionDisabled \? null :/)
  assert.match(appView, /const skipPersistedSelection = automaticSelectionDisabled \|\|/)
  assert.match(appView, /if \(!target && !automaticSelectionDisabled && global_selector\)/)
  assert.match(appView, /if \(!target && !automaticSelectionDisabled && !skipPersistedSelection\) \{[\s\S]*preselected =/)
  assert.match(appView, /if \(!target && !automaticSelectionDisabled && persistedSelectionPayload\)/)
  assert.match(appView, /if \(!target && !automaticSelectionDisabled && followCurrentDefault\)/)
  assert.match(appView, /if \(!target && !automaticSelectionDisabled && preselected && preselected !== devTab\)/)
})

test("static guard: collapsed app sidebar exposes a hover preference", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")

  assert.match(appView, /data-app-sidebar-show-on-hover/)
  assert.match(appView, />Show sidebar on hover</)
  assert.match(appView, /Show the sidebar when hovering over the left edge/)
  assert.match(appView, /#sidebar-toggle\.sidebar-edge-hint \.sidebar-toggle-glyph/)
  assert.match(appView, /peekTrigger\.addEventListener\("pointerenter", \(\) => \{[\s\S]*if \(showOnHoverEnabled\) \{[\s\S]*setPeeking\(true\)[\s\S]*\} else \{[\s\S]*toggle\.classList\.add\("sidebar-edge-hint"\)/)
  assert.match(appView, /peekTrigger\.addEventListener\("pointerleave", \(\) => \{[\s\S]*toggle\.classList\.remove\("sidebar-edge-hint"\)[\s\S]*closePeekSoon\(\)/)
  assert.doesNotMatch(appView, /shouldAutoShowOnEmptyRunView|hasVisibleBrowserSurface/)
  assert.match(appView, /setCollapsed\(initialCollapsed, \{ persist: false \}\)/)
  assert.match(appView, /aside\.addEventListener\("click", \(event\) => \{[\s\S]*target\.closest\("\.reveal, \.revealer, \[data-app-autolaunch-button\]"\)[\s\S]*window\.setTimeout\(\(\) => setPeeking\(false\), 0\)/)
})

test("app sidebar hover preference gates hover without closing the active peek", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const start = appView.indexOf('<script>\n(() => {\n  const appcanvas = document.querySelector(".appcanvas")')
  const end = appView.indexOf('</script>\n<script src="/tab-idle-notifier.js"></script>', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const sidebarScript = appView
    .slice(start + "<script>\n".length, end)
    .replace(/<%- JSON\.stringify\(typeof name === "string" \? name : ""\) %>/g, '"test-app"')

  const createDom = () => {
    return new JSDOM(`<!doctype html>
      <button id="sidebar-toggle"></button>
      <div class="appcanvas vertical">
        <button type="button" data-app-sidebar-peek-trigger></button>
        <aside id="app-sidebar">
          <button type="button" role="switch" aria-checked="true" data-app-sidebar-show-on-hover>Show sidebar on hover</button>
          <button type="button" class="reveal" id="sidebar-reveal">Downloads</button>
          <button type="button" class="revealer" id="sidebar-revealer">Changes</button>
          <button type="button" data-app-autolaunch-button id="sidebar-autolaunch">Autolaunch</button>
          <button type="button" id="sidebar-action">Start</button>
        </aside>
      </div>`, {
      url: "http://127.0.0.1:42000/v/test-app",
      runScripts: "outside-only",
      pretendToBeVisual: true,
      beforeParse(window) {
        window.matchMedia = () => ({
          matches: true,
          addEventListener() {},
          removeEventListener() {}
        })
      }
    })
  }

  const wait = (ms = 75) => new Promise((resolve) => setTimeout(resolve, ms))
  const storageKey = "pinokio.sidebar-collapsed:test-app"
  const showOnHoverStorageKey = "pinokio.sidebar-show-on-hover"
  const legacyAutoShowStorageKey = "pinokio.sidebar-auto-show"

  const dom = createDom()
  dom.window.localStorage.setItem(storageKey, "1")
  dom.window.eval(sidebarScript)
  await wait()

  const appcanvas = dom.window.document.querySelector(".appcanvas")
  const aside = dom.window.document.getElementById("app-sidebar")
  const peekTrigger = dom.window.document.querySelector("[data-app-sidebar-peek-trigger]")
  const sidebarToggle = dom.window.document.getElementById("sidebar-toggle")
  assert.equal(appcanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(aside.getAttribute("aria-hidden"), "true")
  assert.equal(dom.window.localStorage.getItem(storageKey), "1")

  peekTrigger.dispatchEvent(new dom.window.Event("pointerenter"))
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), true)
  assert.equal(sidebarToggle.classList.contains("sidebar-edge-hint"), false)
  assert.equal(aside.getAttribute("aria-hidden"), "false")

  aside.querySelector("#sidebar-reveal").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await wait(5)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), true)

  aside.querySelector("#sidebar-revealer").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await wait(5)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), true)

  aside.querySelector("#sidebar-autolaunch").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await wait(5)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), true)

  aside.querySelector("#sidebar-action").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await wait(5)

  assert.equal(appcanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(dom.window.localStorage.getItem(storageKey), "1")

  const disabledDom = createDom()
  disabledDom.window.localStorage.setItem(storageKey, "1")
  disabledDom.window.localStorage.setItem(legacyAutoShowStorageKey, "0")
  disabledDom.window.eval(sidebarScript)
  await wait()

  const disabledCanvas = disabledDom.window.document.querySelector(".appcanvas")
  const disabledPeekTrigger = disabledDom.window.document.querySelector("[data-app-sidebar-peek-trigger]")
  const showOnHoverToggle = disabledDom.window.document.querySelector("[data-app-sidebar-show-on-hover]")
  const disabledSidebarToggle = disabledDom.window.document.getElementById("sidebar-toggle")
  assert.equal(disabledCanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(disabledCanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(showOnHoverToggle.getAttribute("aria-checked"), "false")

  disabledPeekTrigger.dispatchEvent(new disabledDom.window.Event("pointerenter"))
  assert.equal(disabledCanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(disabledSidebarToggle.classList.contains("sidebar-edge-hint"), true)

  disabledPeekTrigger.dispatchEvent(new disabledDom.window.Event("pointerleave"))
  assert.equal(disabledSidebarToggle.classList.contains("sidebar-edge-hint"), false)

  disabledPeekTrigger.click()
  assert.equal(disabledCanvas.classList.contains("sidebar-peeking"), true)
  assert.equal(disabledSidebarToggle.classList.contains("sidebar-edge-hint"), false)
  showOnHoverToggle.click()
  assert.equal(showOnHoverToggle.getAttribute("aria-checked"), "true")
  assert.equal(disabledDom.window.localStorage.getItem(showOnHoverStorageKey), "1")

  showOnHoverToggle.click()
  assert.equal(showOnHoverToggle.getAttribute("aria-checked"), "false")
  assert.equal(disabledDom.window.localStorage.getItem(showOnHoverStorageKey), "0")
  assert.equal(disabledCanvas.classList.contains("sidebar-peeking"), true)
})

test("app identity popover exposes launcher metadata and remote browser link", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const server = await fs.readFile(path.resolve(root, "server/index.js"), "utf8")
  const chromeStart = server.indexOf("  async chrome(req, res, type, options) {")
  const existingCommunityGitConfigIndex = server.indexOf("const gitRemote = await git.getConfig", chromeStart)
  const helperIndex = server.indexOf("const buildGitRemoteWebUrl = (value) =>", chromeStart)
  const launcherRemoteIndex = server.indexOf("const launcherRemote =", chromeStart)
  const renderPropIndex = server.indexOf("launcher_remote_url: launcherRemoteUrl", launcherRemoteIndex)

  assert.ok(chromeStart >= 0)
  assert.ok(existingCommunityGitConfigIndex > chromeStart)
  assert.ok(helperIndex > existingCommunityGitConfigIndex)
  assert.ok(helperIndex < launcherRemoteIndex)
  assert.ok(renderPropIndex > launcherRemoteIndex)
  assert.match(server, /kernel\.api\.parentGitURI\(this\.kernel\.path\("api", name\)\)/)
  assert.match(server, /launcherRemoteUrl = buildGitRemoteWebUrl\(launcherRemote\)/)
  assert.match(server, /launcher_remote_url: launcherRemoteUrl/)
  assert.match(server, /const buildGitRemoteWebUrl = \(value\) =>/)
  assert.match(server, /return `https:\/\/\$\{sshUrlMatch\[1\]\}\/\$\{sshUrlMatch\[2\]\}`/)
  assert.match(server, /return `https:\/\/\$\{scpMatch\[1\]\}\/\$\{scpMatch\[2\]\}`/)
  assert.match(appView, /data-app-info-root/)
  assert.match(appView, /data-app-header-info-trigger/)
  assert.match(appView, /data-app-header-info-popover/)
  assert.match(appView, /width: min\(390px, calc\(100vw - 24px\)\);/)
  assert.match(appView, /class="app-header-info-popover-icon" src="<%=config\.icon \|\| '\/pinokio-black\.png'%>"/)
  assert.match(appView, /const appInfoRemoteUrl = typeof launcher_remote_url === "string" \? launcher_remote_url : ""/)
  assert.ok(appView.includes('const appInfoRemoteDisplayUrl = appInfoRemoteUrl.replace(/^https?:\\/\\//i, "")'))
  assert.match(appView, /href="<%=appInfoRemoteUrl%>" title="<%=appInfoRemoteUrl%>" rel="noopener noreferrer" data-app-info-external-link/)
  assert.match(appView, /<span><%=appInfoRemoteDisplayUrl%><\/span>/)
  assert.match(appView, /text-overflow: ellipsis/)
  assert.match(appView, /white-space: nowrap/)
  assert.match(appView, /window\.open\(href, "_blank"\)/)
  assert.match(appView, /window\.open\(href, "_blank", "browser"\)/)
  assert.match(appView, /No browser-openable remote detected/)
  const cssRule = (selector) => {
    const start = appView.indexOf(`${selector} {`)
    if (start < 0) return ""
    const tail = appView.slice(start)
    const end = tail.match(/\n\s*\}/)
    return end ? tail.slice(0, end.index + end[0].length) : ""
  }
  const mobileIdentityRule = cssRule(".mobile-bottom-nav__identity")
  const mobileInfoRule = cssRule(".mobile-bottom-nav .app-header-info")
  const mobileInfoTriggerRule = cssRule(".mobile-bottom-nav .app-header-info-trigger")
  const mobileResourceRule = cssRule(".mobile-bottom-nav .resource-usage")
  const mobileResourceTriggerRule = cssRule(".mobile-bottom-nav .resource-usage-trigger")
  assert.match(mobileIdentityRule, /justify-content:\s*center;/)
  assert.match(mobileIdentityRule, /overflow:\s*visible;/)
  assert.doesNotMatch(mobileIdentityRule, /justify-content:\s*flex-start;/)
  assert.match(mobileInfoRule, /flex:\s*0 1 auto;/)
  assert.match(mobileInfoRule, /max-width:\s*min\(260px, 42%\);/)
  assert.match(mobileInfoTriggerRule, /width:\s*auto;/)
  assert.doesNotMatch(mobileInfoTriggerRule, /(^|\n)\s*width:\s*100%;/)
  assert.match(mobileResourceRule, /flex:\s*0 1 auto;/)
  assert.match(mobileResourceRule, /max-width:\s*100%;/)
  assert.match(mobileResourceTriggerRule, /width:\s*auto;/)
  assert.match(mobileResourceTriggerRule, /justify-content:\s*center;/)
  assert.doesNotMatch(mobileResourceTriggerRule, /justify-content:\s*flex-start;/)
  assert.match(appView, /\.mobile-bottom-nav \.app-header-info-popover \{[\s\S]*bottom: calc\(100% \+ 9px\);[\s\S]*width: min\(390px, calc\(100vw - 24px\)\);/)
  assert.match(appView, /\.mobile-bottom-nav \.resource-usage-popover \{[\s\S]*bottom: calc\(100% \+ 9px\);/)
  assert.doesNotMatch(appView, /Open launcher remote/)
  assert.doesNotMatch(appView, /fetch\("\/go"/)
  assert.doesNotMatch(appView, /app-header-info-popover-link"[^>]*features="browser"/)
  assert.doesNotMatch(appView, /appInfoGitHistoryUrl|hydrateAppInfoGithubUrl|buildAppInfoGithubUrl|launcher_github_url|Open launcher on GitHub|No GitHub remote detected/)

  const start = appView.indexOf('<script>\n(() => {\n  const appInfoRoots = Array.from(document.querySelectorAll("[data-app-info-root]"))')
  const end = appView.indexOf("</script>", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const appInfoScript = appView.slice(start + "<script>\n".length, end)
  const dom = new JSDOM(`<!doctype html>
    <body>
      <div data-app-info-root>
        <button type="button" data-app-header-info-trigger aria-expanded="false">Demo</button>
        <div class="hidden" data-app-header-info-popover>
          <a class="app-header-info-popover-link" href="https://gitlab.com/octocat/demo" title="https://gitlab.com/octocat/demo" data-app-info-external-link>gitlab.com/octocat/demo</a>
        </div>
      </div>
      <iframe></iframe>
    </body>`, {
    url: "http://127.0.0.1:42000/v/demo",
    runScripts: "outside-only",
    pretendToBeVisual: true
  })
  const openedUrls = []
  dom.window.open = (url, target, features) => {
    openedUrls.push({ url, target, features })
  }

  dom.window.eval(appInfoScript)
  const trigger = dom.window.document.querySelector("[data-app-header-info-trigger]")
  const popover = dom.window.document.querySelector("[data-app-header-info-popover]")
  const click = () => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }))

  assert.equal(popover.classList.contains("hidden"), true)
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  const remoteLink = dom.window.document.querySelector(".app-header-info-popover-link")
  assert.ok(remoteLink)
  assert.equal(remoteLink.getAttribute("href"), "https://gitlab.com/octocat/demo")
  assert.equal(remoteLink.getAttribute("title"), "https://gitlab.com/octocat/demo")
  assert.equal(remoteLink.hasAttribute("target"), false)
  assert.equal(remoteLink.hasAttribute("features"), false)
  assert.equal(remoteLink.textContent.trim(), "gitlab.com/octocat/demo")

  click()
  assert.equal(popover.classList.contains("hidden"), false)
  assert.equal(trigger.getAttribute("aria-expanded"), "true")
  remoteLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }))
  assert.equal(openedUrls.length, 1)
  assert.deepEqual(openedUrls[0], {
    url: "https://gitlab.com/octocat/demo",
    target: "_blank",
    features: undefined
  })
  assert.equal(popover.classList.contains("hidden"), true)
  assert.equal(trigger.getAttribute("aria-expanded"), "false")

  click()
  assert.equal(popover.classList.contains("hidden"), false)
  assert.equal(trigger.getAttribute("aria-expanded"), "true")

  click()
  assert.equal(popover.classList.contains("hidden"), true)
  assert.equal(trigger.getAttribute("aria-expanded"), "false")

  click()
  dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }))
  assert.equal(popover.classList.contains("hidden"), true)
  assert.equal(trigger.getAttribute("aria-expanded"), "false")

  click()
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  assert.equal(popover.classList.contains("hidden"), true)
  assert.equal(trigger.getAttribute("aria-expanded"), "false")

  dom.window.document.body.setAttribute("data-agent", "electron")
  click()
  remoteLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }))
  assert.deepEqual(openedUrls[1], {
    url: "https://gitlab.com/octocat/demo",
    target: "_blank",
    features: "browser"
  })
})

test("static guard: home run command selection opens without launching before selecting command", async () => {
  const homeRunMenu = await fs.readFile(path.resolve(root, "server/views/partials/home_run_menu.ejs"), "utf8")

  assert.match(homeRunMenu, /homeRunApp && homeRunApp\.view_url \? homeRunApp\.view_url :/)
  assert.match(homeRunMenu, /pinokio_home_select: JSON\.stringify\(buildHomeSelectionPayload\(menuItem, index\)\)/)
})
