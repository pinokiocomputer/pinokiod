const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")

const root = path.resolve(__dirname, "..")

const TEST_FILES = [
  "test/launch-requirements.test.js",
  "test/server-autolaunch.test.js",
  "test/launch-settings-ui.test.js",
  "test/launch-requirements-browser.test.js",
  "test/home-autolaunch-live-ui.test.js"
]

const implementationGateCoverage = [
  {
    id: "IG-01",
    spec: "Keep the implementation strictly additive.",
    tests: [
      "launch requirements do not run for non-configured explicit app scripts",
      "launch requirements do not run when no launch script and no requirements are configured",
      "api.process bypasses launch requirement plumbing when no launch env exists",
      "api.process bypasses launch requirement plumbing when launch script exists without requirements",
      "kernel lifecycle hooks do not call launch requirement hooks without active requirement runtime",
      "kernel launch requirement config gate requires both configured launch script and requirements",
      "autolaunch route preserves configured script when startup is disabled"
    ]
  },
  {
    id: "IG-02",
    spec: "Do not change existing Pinokio script execution unless the requested script is the app's configured launch script and requirements are configured.",
    tests: [
      "launch requirements run when requested script is configured launch script regardless of filename",
      "launch requirements do not run for non-configured explicit app scripts",
      "api.process bypasses launch requirement plumbing when no launch env exists",
      "launch requirements do not run when no launch script and no requirements are configured",
      "api.process bypasses launch requirement plumbing when launch script exists without requirements",
      "kernel lifecycle hooks do not call launch requirement hooks without active requirement runtime",
      "kernel launch requirement config gate requires both configured launch script and requirements"
    ]
  },
  {
    id: "IG-03",
    spec: "Do not use script filenames, route shape, DOM attributes, query parameters, or `default: true` to decide requirement behavior.",
    tests: [
      "launch requirements are not controlled by DOM markers or query parameters",
      "launch requirements run when requested script is configured launch script regardless of filename"
    ]
  },
  {
    id: "IG-04",
    spec: "Do not emit terminal/session `disconnect` from requirement preparation.",
    tests: ["api.process does not emit terminal disconnect for requirement control results"]
  },
  {
    id: "IG-05",
    spec: "Do not emit terminal/session `disconnect` while the target is waiting for requirements.",
    tests: ["api.process does not emit terminal disconnect for requirement control results"]
  },
  {
    id: "IG-06",
    spec: "Do not emit terminal/session `disconnect` when requirements are blocked.",
    tests: ["api.process does not emit terminal disconnect for requirement control results"]
  },
  {
    id: "IG-07",
    spec: "Do not emit terminal/session `disconnect` when another real active launch operation is already handling the same target launch.",
    tests: [
      "api.process does not emit terminal disconnect for requirement control results",
      "active launch ownership prevents duplicate manual target launch"
    ]
  },
  {
    id: "IG-08",
    spec: "Do not encode normal requirement control flow as thrown pseudo-errors that generic script execution converts into terminal events.",
    tests: ["api.process does not emit terminal disconnect for requirement control results"]
  },
  {
    id: "IG-09",
    spec: "`api.process` must continue into normal script execution after requirements resolve.",
    tests: ["api.process continues into normal script execution after requirements are ready"]
  },
  {
    id: "IG-10",
    spec: "`api.process` must return a structured `handled` result and emit no terminal event.",
    tests: [
      "api.process does not emit terminal disconnect for requirement control results",
      "active launch ownership prevents duplicate manual target launch"
    ]
  },
  {
    id: "IG-11",
    spec: "Do not add fallback reads from legacy dependency keys.",
    tests: ["launch requirements ignore legacy autolaunch dependency key"]
  },
  {
    id: "IG-12",
    spec: "Do not silently select a default launch script.",
    tests: [
      "launch settings only checks a script when it is persisted",
      "launch settings opens dependency script picker before saving a new dependency"
    ]
  },
  {
    id: "IG-13",
    spec: "Do not make app-page requirement status from saved config alone.",
    tests: [
      "app page does not fabricate launch requirement status from saved config",
      "static guard: open without launching is not wired to launch requirement status",
      "app page launch requirement status client is inert until launch config exists"
    ]
  },
  {
    id: "IG-14",
    spec: "Do not make home live updates depend on initial HTML status rows.",
    tests: [
      "static guard: home autolaunch live status discovers rows after initial render",
      "home live status renders waiting state on an initially idle row"
    ]
  },
  {
    id: "IG-15",
    spec: "Do not make startup rows begin with empty `dependencies` or `waiting_for` when configured requirements exist.",
    tests: [
      "autolaunch scheduler seeds startup requirements before launching roots",
      "home startup state renders configured requirement waiting before runtime status"
    ]
  },
  {
    id: "IG-16",
    spec: "Do not redesign home buttons/status while repairing behavior.",
    tests: [
      "home running buttons only show spinner while startup label is active",
      "home live status transitions from preparing to normal stop button"
    ]
  },
  {
    id: "IG-17",
    spec: "Startup/home display rows are output only and must not control launch ownership.",
    tests: [
      "display-only startup row does not prevent manual target launch",
      "display-only startup row for offline required app still starts required app"
    ]
  },
  {
    id: "IG-18",
    spec: "Stale script progress must not render as current progress without active or running launch.",
    tests: ["stale script progress is hidden when there is no active or running launch"]
  },
  {
    id: "IG-19",
    spec: "Do not keep code only because current tests depend on it; every existing-file change needs a changed-file reason.",
    processGate: "diff audit and changed-file reason list"
  },
  {
    id: "IG-20",
    spec: "With no launch-related env vars, Pinokio behavior is unchanged.",
    tests: [
      "launch requirements do not run when no launch script and no requirements are configured",
      "api.process bypasses launch requirement plumbing when no launch env exists",
      "api.process bypasses launch requirement plumbing when launch script exists without requirements",
      "kernel lifecycle hooks do not call launch requirement hooks without active requirement runtime",
      "kernel launch requirement config gate requires both configured launch script and requirements",
      "app page launch requirement status client is inert until launch config exists",
      "manual explicit script is not blocked by requirement-only status without a launch path"
    ]
  },
  {
    id: "IG-21",
    spec: "Open without launching disables all page-load script selection paths.",
    tests: [
      "static guard: open without launching is not wired to launch requirement status",
      "static guard: open without launching disables page-load script frame selection",
      "app page launch requirement status client is inert until launch config exists"
    ]
  },
  {
    id: "IG-22",
    spec: "Requirement runtime status is ephemeral launch-attempt state, not durable app state.",
    tests: [
      "launch requirements clear blocked status on explicit cancel",
      "launch requirements clears startup status on stop instead of persisting stopped state"
    ]
  },
  {
    id: "IG-23",
    spec: "Requirement runtime status uses only pending, waiting, starting, ready, and blocked.",
    tests: ["launch requirements runtime state model has no failed timeout or persisted stopped states"]
  },
  {
    id: "IG-24",
    spec: "There is no automatic readiness timeout path.",
    tests: ["launch requirements have no automatic readiness timeout path"]
  },
  {
    id: "IG-25",
    spec: "There is no second launch-script environment variable, hidden launch-script state, or migration.",
    tests: [
      "launch requirements use no second launch script environment key",
      "autolaunch scheduler must not migrate startup script into a second launch key"
    ]
  },
  {
    id: "IG-26",
    spec: "Selected launch script and startup enabled are separate state facts.",
    tests: [
      "autolaunch route preserves configured script when startup is disabled",
      "autolaunch route rejects script save without explicit startup enabled state",
      "autolaunch scheduler skips configured scripts when startup is disabled",
      "disable all startup launch preserves configured scripts",
      "launch settings UI sends selected script with explicit startup enabled state"
    ]
  },
  {
    id: "IG-27",
    spec: "Script-save requests must not infer startup enabled from a script value.",
    tests: ["autolaunch route rejects script save without explicit startup enabled state"]
  },
  {
    id: "IG-28",
    spec: "App ENVIRONMENT generation preserves existing custom or unsupported keys instead of silently cleaning them up.",
    tests: ["generated app environment preserves unsupported custom keys without cleanup"]
  }
]

const forbiddenRegressionCoverage = [
  {
    id: "FR-01",
    spec: "home waits several seconds before showing startup/autolaunch status",
    tests: [
      "home startup state renders configured requirement waiting before runtime status",
      "home live status renders waiting state on an initially idle row"
    ]
  },
  {
    id: "FR-02",
    spec: "home requires manual refresh before startup/autolaunch status changes",
    tests: [
      "static guard: home autolaunch live status discovers rows after initial render",
      "home live status transitions from preparing to normal stop button"
    ]
  },
  {
    id: "FR-03",
    spec: "a startup root with requirements says only `Starting <script>` when it should say `Waiting for <required app>`",
    tests: ["home startup state renders configured requirement waiting before runtime status"]
  },
  {
    id: "FR-04",
    spec: "the startup scheduler seeds root rows with empty `dependencies` or `waiting_for` when configured requirements exist",
    tests: ["autolaunch scheduler seeds startup requirements before launching roots"]
  },
  {
    id: "FR-05",
    spec: "a script that is not the configured launch script is intercepted by requirement logic",
    tests: [
      "launch requirements do not run for non-configured explicit app scripts",
      "manual explicit script is not blocked by requirement-only status without a launch path"
    ]
  },
  {
    id: "FR-06",
    spec: "requirement logic emits a terminal/session `disconnect` event",
    tests: ["api.process does not emit terminal disconnect for requirement control results"]
  },
  {
    id: "FR-07",
    spec: "requirement logic reroutes a concrete script request away from the script the user requested",
    tests: ["launch requirements do not run for non-configured explicit app scripts"]
  },
  {
    id: "FR-08",
    spec: "home stop buttons or status labels are redesigned instead of preserving the dependency-aware home behavior",
    tests: [
      "home running buttons only show spinner while startup label is active",
      "home live status transitions from preparing to normal stop button"
    ]
  },
  {
    id: "FR-09",
    spec: "startup on/off, launch script, and requirements become tangled",
    tests: [
      "autolaunch route preserves configured script when startup is disabled",
      "autolaunch route rejects script save without explicit startup enabled state",
      "autolaunch route rejects clearing launch script while requirements exist",
      "disable all startup launch preserves configured scripts",
      "launch settings UI sends selected script with explicit startup enabled state"
    ]
  },
  {
    id: "FR-10",
    spec: "startup/home display status is treated as launch ownership",
    tests: [
      "display-only startup row does not prevent manual target launch",
      "display-only startup row for offline required app still starts required app"
    ]
  },
  {
    id: "FR-11",
    spec: "stale progress is displayed as current launch progress",
    tests: [
      "stale script progress is hidden when there is no active or running launch",
      "launch requirement status does not surface stale progress without an active launch"
    ]
  },
  {
    id: "FR-12",
    spec: "explicitly stopping a required app clears dependent launch requirement state",
    tests: ["explicitly stopping a required app clears dependent launch requirement state"]
  },
  {
    id: "FR-13",
    spec: "open without launching starts a script through persisted selection, preselected links, default selection, iframe creation, or requirement status",
    tests: ["static guard: open without launching disables page-load script frame selection"]
  },
  {
    id: "FR-14",
    spec: "no-env app behavior changes because launch-requirement code runs anyway",
    tests: [
      "launch requirements do not run when no launch script and no requirements are configured",
      "api.process bypasses launch requirement plumbing when no launch env exists",
      "app page launch requirement status client is inert until launch config exists",
      "manual explicit script is not blocked by requirement-only status without a launch path"
    ]
  },
  {
    id: "FR-15",
    spec: "new code changes existing routes, frame selection, terminal events, or concrete script execution without a launch-related environment gate",
    tests: [
      "static guard: open without launching disables page-load script frame selection",
      "api.process does not emit terminal disconnect for requirement control results",
      "api.process bypasses launch requirement plumbing when no launch env exists",
      "api.process bypasses launch requirement plumbing when launch script exists without requirements",
      "kernel lifecycle hooks do not call launch requirement hooks without active requirement runtime",
      "app page launch requirement status client is inert until launch config exists",
      "launch requirements do not run when no launch script and no requirements are configured"
    ]
  },
  {
    id: "FR-16",
    spec: "requirement runtime states include failed, timeout, persisted cancelled, or persisted stopped",
    tests: ["launch requirements runtime state model has no failed timeout or persisted stopped states"]
  },
  {
    id: "FR-17",
    spec: "blocked/setup-needed state survives as stale app state instead of being recomputed for the current launch attempt",
    tests: [
      "launch requirements clear blocked status on explicit cancel",
      "manual launch ignores display-only blocked startup row and evaluates current config"
    ]
  },
  {
    id: "FR-18",
    spec: "automatic readiness timeout path changes waiting semantics",
    tests: ["launch requirements have no automatic readiness timeout path"]
  },
  {
    id: "FR-19",
    spec: "dependency save silently drops bad ids and persists a partial requirement list",
    tests: ["autolaunch dependencies route rejects invalid dependency ids atomically"]
  }
]

const requiredResolverCoverage = [
  {
    id: "RT-01",
    spec: "recursive ordering",
    tests: ["launch requirements resolve recursive app fixtures in ancestor-first order"]
  },
  {
    id: "RT-02",
    spec: "cycle preflight",
    tests: ["launch requirements preflight cycles before starting anything"]
  },
  {
    id: "RT-03",
    spec: "parallel independent requirements",
    tests: ["launch requirements start independent requirements in parallel"]
  },
  {
    id: "RT-04",
    spec: "already ready requirement",
    tests: ["launch requirements do not restart an already ready requirement"]
  },
  {
    id: "RT-05",
    spec: "already starting or already running requirement",
    tests: [
      "launch requirements wait for an already running requirement instead of duplicating it",
      "active launch ownership prevents duplicate manual target launch"
    ]
  },
  {
    id: "RT-06",
    spec: "concurrent shared requirement",
    tests: ["launch requirements dedupe one required app shared by concurrent targets"]
  },
  {
    id: "RT-07",
    spec: "cancel waiting target",
    tests: ["launch requirements cancel a waiting target without stopping its requirement"]
  },
  {
    id: "RT-07A",
    spec: "startup reentry remains cancelled while the cancelled launch operation is still active",
    tests: ["launch requirements startup reentry after cancel does not erase cancellation"]
  },
  {
    id: "RT-07B",
    spec: "app-page default launch after a cancelled operation unwinds clears old cancellation",
    tests: ["launch requirements app-page default launch after cancel clears old cancellation"]
  },
  {
    id: "RT-08",
    spec: "configured launch script resolves requirements regardless of filename or entry point",
    tests: ["launch requirements run when requested script is configured launch script regardless of filename"]
  },
  {
    id: "RT-09",
    spec: "concrete script without saved launch script runs directly",
    tests: [
      "launch requirements do not run when no launch script and no requirements are configured",
      "manual explicit script is not blocked by requirement-only status without a launch path"
    ]
  },
  {
    id: "RT-10",
    spec: "concrete non-launch scripts run directly",
    tests: ["launch requirements do not run for non-configured explicit app scripts"]
  }
]

const requiredIntegrationCoverage = [
  {
    id: "IT-01",
    spec: "startup home status appears immediately",
    tests: [
      "home startup state renders configured requirement waiting before runtime status",
      "home live status renders waiting state on an initially idle row"
    ]
  },
  {
    id: "IT-02",
    spec: "startup root waits visibly for requirement",
    tests: [
      "home startup state renders configured requirement waiting before runtime status",
      "home live status renders waiting state on an initially idle row"
    ]
  },
  {
    id: "IT-03",
    spec: "startup dependency starts first",
    tests: [
      "autolaunch scheduler seeds startup requirements before launching roots",
      "startup launch mirrors requirement-only apps into startup status"
    ]
  },
  {
    id: "IT-04",
    spec: "home live updates without refresh",
    tests: [
      "home live status clears a running row when it disappears from runtime status",
      "home live status transitions from preparing to normal stop button"
    ]
  },
  {
    id: "IT-05",
    spec: "manual launch waits for requirement",
    tests: [
      "launch requirements run when requested script is configured launch script regardless of filename",
      "launch requirements wait for an already running requirement instead of duplicating it"
    ]
  },
  {
    id: "IT-06",
    spec: "startup root with requirement-only app",
    tests: ["startup launch mirrors requirement-only apps into startup status"]
  },
  {
    id: "IT-07",
    spec: "requirements require an explicit configured script",
    tests: [
      "autolaunch dependencies route rejects requirements without owning launch script",
      "autolaunch route preserves configured script when startup is disabled"
    ]
  },
  {
    id: "IT-08",
    spec: "startup enabled and configured launch script are separate settings",
    tests: [
      "autolaunch route preserves configured script when startup is disabled",
      "disable all startup launch preserves configured scripts"
    ]
  },
  {
    id: "IT-09",
    spec: "missing required launch script blocks visibly",
    tests: [
      "launch requirements expose missing requirement script in target status",
      "startup launch exposes blocked requirement status for app page",
      "launch requirements clear blocked status on explicit cancel"
    ]
  },
  {
    id: "IT-10",
    spec: "add requirement with missing launch script",
    tests: [
      "launch settings opens dependency script picker before saving a new dependency",
      "launch settings dependency script loader is shared"
    ]
  },
  {
    id: "IT-11",
    spec: "Open without launching",
    tests: [
      "app page does not fabricate launch requirement status from saved config",
      "static guard: open without launching is not wired to launch requirement status"
    ]
  },
  {
    id: "IT-12",
    spec: "stale status cleanup",
    tests: [
      "launch requirements clear status related to edited app",
      "home live status clears startup row when runtime status disappears after stop",
      "explicitly stopping a required app clears dependent launch requirement state",
      "launch requirements clear blocked status on explicit cancel",
      "launch requirements clears startup status on stop instead of persisting stopped state"
    ]
  },
  {
    id: "IT-13",
    spec: "concrete non-launch script survives stale requirement blocker",
    tests: [
      "launch requirements do not block concrete scripts when stale requirements have no owning launch script",
      "manual explicit script is not blocked by requirement-only status without a launch path"
    ]
  },
  {
    id: "IT-14",
    spec: "real browser verification",
    processGate: "must be completed outside node --test with saved screenshot or recording"
  },
  {
    id: "IT-15",
    spec: "Open without launching must not restore persisted selection, selected rows, default scripts, or script iframes on page load.",
    tests: ["static guard: open without launching disables page-load script frame selection"]
  },
  {
    id: "IT-16",
    spec: "blocked setup-needed UI is actionable",
    tests: ["browser: blocked setup status exposes script selection and stop actions"],
    processGate: "real Browser/Computer verification against the actual running app"
  },
  {
    id: "IT-17",
    spec: "dependency script confirmation is an explicit command",
    tests: ["browser: adding a requirement with an existing script still requires script confirmation"],
    processGate: "real Browser/Computer verification against the actual running app"
  },
  {
    id: "IT-18",
    spec: "dependency saves are atomic",
    tests: ["autolaunch dependencies route rejects invalid dependency ids atomically"]
  }
]

const allCoverage = [
  ...implementationGateCoverage,
  ...forbiddenRegressionCoverage,
  ...requiredResolverCoverage,
  ...requiredIntegrationCoverage
]

const requiredContractPhrases = [
  "Non-Negotiable Baseline",
  "This feature is strictly additive.",
  "If an app has no launch-related environment configuration, Pinokio must behave as if this feature does not exist.",
  "Minimal-Surface Rule",
  "Every change to an existing file must have a direct reason tied to one of these responsibilities:",
  "Configuration is input only.",
  "The Launch Engine Owns Runtime Truth",
  "UI And Status Are Output Only",
  "Display status is not launch ownership.",
  "Startup Uses The Same Launch Engine",
  "Requirements Apply Only To The Configured Launch Script",
  "The runtime requirement engine may run only when both of these are true for the target app:",
  "Only an explicit clear-script action may clear `PINOKIO_SCRIPT_AUTOLAUNCH`.",
  "The `/autolaunch` script-save API must receive an explicit boolean",
  "The server must never infer startup enabled from the presence of a script value.",
  "The confirmation must be a real command, not a side effect of clicking an already-selected radio option.",
  "Setup-needed UI must be actionable.",
  "Saving requirements must be atomic.",
  "Ready Is A Positive Engine Signal",
  "Already Starting Means A Real Active Launch",
  "Direct Non-Launch Scripts Stay Existing Pinokio Behavior",
  "Requirement Control Flow Must Not Be Terminal Events",
  "Open Without Launching Does Not Launch",
  "This includes all page-load selection paths.",
  "Regression Classes That Must Stay Impossible",
  "Startup/home display rows are display state only. They are used to render immediate startup visibility.",
  "No code skips launching because startup/home status exists.",
  "No code treats `startup_root` as active launch ownership.",
  "Requirement status is ephemeral launch-attempt state.",
  "Requirement runtime status must not use `failed` or `timeout`.",
  "There is no automatic readiness timeout in this contract.",
  "Blocked/setup-needed status is recomputed per launch attempt.",
  "No requirement runtime state named `failed`.",
  "No requirement runtime state named `timeout`."
]

const normalizeText = (value) => String(value).replace(/\s+/g, " ").trim()

async function loadLocalContractText() {
  try {
    const spec = await fs.readFile(path.resolve(root, "spec/LAUNCH_REQUIREMENTS.md"), "utf8")
    const checklist = await fs.readFile(path.resolve(root, "spec/LAUNCH_REQUIREMENTS_REPAIR_CHECKLIST.md"), "utf8")
    return normalizeText(`${spec}\n${checklist}`)
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

async function loadTestNames() {
  const names = new Set()
  for (const file of TEST_FILES) {
    const text = await fs.readFile(path.resolve(root, file), "utf8")
    for (const match of text.matchAll(/(?:test|browserTest)\("([^"]+)"/g)) {
      names.add(match[1])
    }
  }
  return names
}

test("launch requirements contract coverage has no unmapped enforced items", async () => {
  const testNames = await loadTestNames()

  assert.equal(implementationGateCoverage.length, 28)
  assert.equal(forbiddenRegressionCoverage.length, 19)
  assert.equal(requiredResolverCoverage.length, 12)
  assert.equal(requiredIntegrationCoverage.length, 18)

  for (const item of allCoverage) {
    assert.ok(
      item.spec && typeof item.spec === "string",
      `${item.id} has no spec label`
    )
    assert.ok(
      (Array.isArray(item.tests) && item.tests.length > 0) || item.processGate,
      `${item.id} has no automated test or explicit process gate`
    )
    for (const testName of item.tests || []) {
      assert.ok(testNames.has(testName), `${item.id} references missing test: ${testName}`)
    }
  }
})

test("local launch requirements docs include enforced contract phrases when present", async (t) => {
  const contractText = await loadLocalContractText()
  if (!contractText) {
    t.skip("spec/ is intentionally local and ignored")
    return
  }

  for (const phrase of requiredContractPhrases) {
    assert.ok(
      contractText.includes(normalizeText(phrase)),
      `contract docs are missing required phrase: ${phrase}`
    )
  }
})

test("launch requirements contract process-only gates are explicit and limited", () => {
  const processOnly = allCoverage.filter((item) => item.processGate && (!item.tests || item.tests.length === 0))
  assert.deepEqual(processOnly.map((item) => item.id).sort(), ["IG-19", "IT-14"])
})

test("fixture browser tests cannot count as real browser verification by themselves", async () => {
  const browserText = await fs.readFile(path.resolve(root, "test/launch-requirements-browser.test.js"), "utf8")
  assert.doesNotMatch(browserText, /test\.skip|skip\(/)
  assert.match(browserText, /const browserTest = test/)
  assert.match(browserText, /Playwright is required\. Run: npx -y -p playwright node --test test\/launch-requirements-browser\.test\.js/)
  assert.match(browserText, /startFixtureServer/)

  const fixtureBrowserOnly = allCoverage.filter((item) => {
    const tests = Array.isArray(item.tests) ? item.tests : []
    return tests.some((testName) => testName.startsWith("browser:")) && !item.processGate
  })
  assert.deepEqual(fixtureBrowserOnly, [])
})
