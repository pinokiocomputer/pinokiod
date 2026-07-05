const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

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

test("static guard: collapsed idle run page peeks without persisting sidebar state", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")

  assert.match(appView, /const shouldAutoPeekOnIdle = <%- JSON\.stringify\(type === "run"\) %>/)
  assert.match(appView, /const hasVisibleBrowserSurface = \(\) => \{[\s\S]*browserview\.querySelector\("iframe:not\(\.hidden\)"\)[\s\S]*browserview-network-status[\s\S]*data-launch-requirements-status/)
  assert.match(appView, /if \(shouldAutoPeekOnIdle && initialCollapsed && !hasVisibleBrowserSurface\(\)\) \{[\s\S]*setPeeking\(true\)/)
  assert.match(appView, /setCollapsed\(initialCollapsed, \{ persist: false \}\)/)
  assert.match(appView, /aside\.addEventListener\("click", \(\) => \{[\s\S]*window\.setTimeout\(\(\) => setPeeking\(false\), 0\)/)
})

test("app sidebar auto-peeks on collapsed idle run page and dismisses after click", async () => {
  const appView = await fs.readFile(path.resolve(root, "server/views/app.ejs"), "utf8")
  const start = appView.indexOf('<script>\n(() => {\n  const appcanvas = document.querySelector(".appcanvas")')
  const end = appView.indexOf('</script>\n<script src="/tab-idle-notifier.js"></script>', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const sidebarScript = appView
    .slice(start + "<script>\n".length, end)
    .replace(/<%- JSON\.stringify\(typeof name === "string" \? name : ""\) %>/g, '"test-app"')
    .replace(/<%- JSON\.stringify\(type === "run"\) %>/g, "true")

  const createDom = (browserSurface = "") => {
    return new JSDOM(`<!doctype html>
      <button id="sidebar-toggle"></button>
      <div class="appcanvas vertical">
        <button type="button" data-app-sidebar-peek-trigger></button>
        <aside id="app-sidebar"><button type="button" id="sidebar-action">Start</button></aside>
        <main class="browserview">${browserSurface}</main>
      </div>
      <div id="browserview-network-status" hidden></div>
      <div data-launch-requirements-status hidden></div>`, {
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

  const dom = createDom()
  dom.window.localStorage.setItem(storageKey, "1")
  dom.window.eval(sidebarScript)
  await wait()

  const appcanvas = dom.window.document.querySelector(".appcanvas")
  const aside = dom.window.document.getElementById("app-sidebar")
  assert.equal(appcanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), true)
  assert.equal(aside.getAttribute("aria-hidden"), "false")
  assert.equal(dom.window.localStorage.getItem(storageKey), "1")

  aside.querySelector("#sidebar-action").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
  await wait(5)

  assert.equal(appcanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(appcanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(dom.window.localStorage.getItem(storageKey), "1")

  const activeDom = createDom('<iframe src="about:blank"></iframe>')
  activeDom.window.localStorage.setItem(storageKey, "1")
  activeDom.window.eval(sidebarScript)
  await wait()

  const activeCanvas = activeDom.window.document.querySelector(".appcanvas")
  assert.equal(activeCanvas.classList.contains("sidebar-collapsed"), true)
  assert.equal(activeCanvas.classList.contains("sidebar-peeking"), false)
  assert.equal(activeDom.window.localStorage.getItem(storageKey), "1")
})

test("static guard: home run command selection opens without launching before selecting command", async () => {
  const homeRunMenu = await fs.readFile(path.resolve(root, "server/views/partials/home_run_menu.ejs"), "utf8")

  assert.match(homeRunMenu, /homeRunApp && homeRunApp\.view_url \? homeRunApp\.view_url :/)
  assert.match(homeRunMenu, /pinokio_home_select: JSON\.stringify\(buildHomeSelectionPayload\(menuItem, index\)\)/)
})
