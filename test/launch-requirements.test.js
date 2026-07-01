const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const LaunchRequirements = require("../kernel/launch_requirements")
const Environment = require("../kernel/environment")
const Autolaunch = require("../kernel/autolaunch")
const Api = require("../kernel/api")
const Kernel = require("../kernel")

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (predicate, timeoutMs = 500) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return true
    }
    await delay(5)
  }
  return false
}

async function withFixtureApps(defs, options, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-launch-requirements-"))
  const homedir = path.resolve(root, "home")
  const apiRoot = path.resolve(homedir, "api")
  await fs.mkdir(apiRoot, { recursive: true })

  for (const [id, def] of Object.entries(defs)) {
    const appRoot = path.resolve(apiRoot, id)
    await fs.mkdir(appRoot, { recursive: true })
    const script = def.noScript ? "" : (def.script || "start.js")
    const configuredScript = def.noLaunchConfig ? "" : script
    const env = [
      `PINOKIO_SCRIPT_AUTOLAUNCH=${configuredScript}`,
      Object.prototype.hasOwnProperty.call(def, "startup")
        ? `${Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY}=${def.startup ? "true" : "false"}`
        : "",
      def.legacyDeps
        ? `PINOKIO_SCRIPT_AUTOLAUNCH_DEPENDS=${(def.deps || []).join(",")}`
        : `${Environment.SCRIPT_REQUIREMENTS_KEY}=${(def.deps || []).join(",")}`,
      ""
    ].filter((line) => line !== null && line !== undefined).join("\n")
    await fs.writeFile(path.resolve(appRoot, "ENVIRONMENT"), env, "utf8")
    if (script) {
      await fs.writeFile(path.resolve(appRoot, script), "module.exports = { run: [] }\n", "utf8")
    }
  }

  const apps = Object.keys(defs).map((id) => ({
    id,
    title: defs[id].title || id,
    icon: `/icon/${id}.png`
  }))
  const running = {}
  const ready = new Set()
  const starts = []
  const events = []
  const startDelayMs = Number(options && options.startDelayMs) || 0
  const readyDelayMs = Number(options && options.readyDelayMs) || 0
  const readyAfterStart = !(options && options.readyAfterStart === false)
  let processFailuresBeforeSuccess = Number(options && options.processFailuresBeforeSuccess) || 0

  const kernel = {
    homedir,
    exists: async (filepath) => {
      try {
        await fs.stat(filepath)
        return true
      } catch (_) {
        return false
      }
    },
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    normalizeAppId: (value) => {
      if (typeof value !== "string") return ""
      const id = value.trim()
      return id && !/[\\/]/.test(id) ? id : ""
    },
    getAppIdForLaunchPath: (launchPath) => {
      const relative = path.relative(apiRoot, path.resolve(launchPath))
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
      return relative.split(path.sep)[0] || ""
    },
    getAppRelativeLaunchScript: (appId, launchPath) => {
      const relative = path.relative(path.resolve(apiRoot, appId), path.resolve(launchPath))
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
      return relative.split(path.sep).join("/")
    },
    readyState: {
      markStarted: () => ({ state: "running" }),
      markProgress: (_launchPath, current, total) => ({ step_current: current, step_total: total }),
      markReady: (scriptPath) => {
        ready.add(path.resolve(scriptPath))
        return { state: "ready" }
      },
      markFailed: () => ({ state: "failed" }),
      markStopped: () => ({ state: "stopped" }),
      getAppIdForLaunchPath: (launchPath) => {
        const relative = path.relative(apiRoot, path.resolve(launchPath))
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
        return relative.split(path.sep)[0] || ""
      }
    },
    hasLaunchRequirementRuntime: Kernel.prototype.hasLaunchRequirementRuntime,
    markAppLaunchStarted: Kernel.prototype.markAppLaunchStarted,
    markAppLaunchReady: Kernel.prototype.markAppLaunchReady,
    markAppLaunchStopped: Kernel.prototype.markAppLaunchStopped,
    isScriptReady: (scriptPath) => ready.has(path.resolve(scriptPath)),
    getScriptProgress: () => null,
    api: {
      userdir: apiRoot,
      running,
      ondata: (packet) => {
        events.push(packet)
      },
      listApps: async () => apps,
      process: async ({ uri }) => {
        if (processFailuresBeforeSuccess > 0) {
          processFailuresBeforeSuccess -= 1
          throw new Error("process failed")
        }
        if (startDelayMs > 0) {
          await delay(startDelayMs)
        }
        const resolved = path.resolve(uri)
        starts.push({
          uri: resolved,
          app: path.relative(apiRoot, resolved).split(path.sep)[0],
          at: Date.now()
        })
        running[resolved] = true
        if (options && options.simulateKernelLifecycle) {
          kernel.markAppLaunchStarted(resolved)
        }
        if (readyAfterStart) {
          setTimeout(() => {
            if (options && options.simulateKernelLifecycle) {
              delete running[resolved]
              kernel.markAppLaunchStopped(resolved, { internal_completion: true })
              kernel.markAppLaunchReady(resolved)
            } else {
              ready.add(resolved)
            }
          }, readyDelayMs)
        }
      }
    }
  }
  const resolver = new LaunchRequirements(kernel)
  kernel.launchRequirements = resolver

  try {
    await fn({
      root,
      homedir,
      apiRoot,
      kernel,
      resolver,
      starts,
      events,
      running,
      ready,
      launchPath: (appId, script = "start.js") => path.resolve(apiRoot, appId, script),
      markReady: (appId, script = "start.js") => ready.add(path.resolve(apiRoot, appId, script))
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function withApiProcessFixture(requirementResult, fn, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-api-requirements-"))
  const homedir = path.resolve(root, "home")
  const apiRoot = path.resolve(homedir, "api")
  const appRoot = path.resolve(apiRoot, "target")
  const launchPath = path.resolve(appRoot, "start.js")
  await fs.mkdir(appRoot, { recursive: true })
  await fs.writeFile(launchPath, "module.exports = { run: [] }\n", "utf8")

  let requirementCalls = 0
  const hasRequirementConfig = Object.prototype.hasOwnProperty.call(options, "hasRequirementConfig")
    ? !!options.hasRequirementConfig
    : true
  const kernel = {
    homedir,
    shell: { init: async () => {} },
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    hasLaunchRequirementConfig: async () => hasRequirementConfig,
    ensureLaunchRequirements: async () => {
      requirementCalls += 1
      return requirementResult
    },
    dns: async () => {}
  }
  const api = new Api(kernel)
  kernel.api = api
  api.userdir = apiRoot
  const packets = []
  let setRunningCalls = 0
  api.listen("test", (packet) => packets.push(packet))
  api.resolvePath = () => launchPath
  api.resolveScript = async () => ({
    cwd: appRoot,
    script: { run: [] }
  })
  api.isActionCandidate = () => true
  api.setRunning = () => {
    setRunningCalls += 1
  }
  api.resolveActionSteps = async () => []

  try {
    await fn({ api, packets, launchPath, setRunningCalls: () => setRunningCalls, requirementCalls: () => requirementCalls })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function withApiBridgeFixture(fn, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-api-bridge-requirements-"))
  const homedir = path.resolve(root, "home")
  const apiRoot = path.resolve(homedir, "api")
  const helperRoot = path.resolve(apiRoot, "helper")
  const targetRoot = path.resolve(apiRoot, "target")
  const ready = new Set()
  const events = []
  const queued = []
  const targetScript = options.targetScript || "start.js"
  await fs.mkdir(helperRoot, { recursive: true })
  await fs.mkdir(targetRoot, { recursive: true })
  await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
  await fs.writeFile(path.resolve(targetRoot, targetScript), "module.exports = { run: [] }\n", "utf8")
  await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), [
    "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
    "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
    "PINOKIO_SCRIPT_REQUIRES=",
    ""
  ].join("\n"), "utf8")
  await fs.writeFile(path.resolve(targetRoot, "ENVIRONMENT"), [
    `PINOKIO_SCRIPT_AUTOLAUNCH=${targetScript}`,
    "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
    "PINOKIO_SCRIPT_REQUIRES=helper",
    ""
  ].join("\n"), "utf8")

  const kernel = {
    homedir,
    shell: { init: async () => {} },
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    exists: async (filepath) => {
      try {
        await fs.stat(filepath)
        return true
      } catch (_) {
        return false
      }
    },
    normalizeAppId: (value) => {
      if (typeof value !== "string") return ""
      const id = value.trim()
      return id && !/[\\/]/.test(id) ? id : ""
    },
    getAppIdForLaunchPath: (launchPath) => {
      const relative = path.relative(apiRoot, path.resolve(launchPath))
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
      return relative.split(path.sep)[0] || ""
    },
    getAppRelativeLaunchScript: (appId, launchPath) => {
      const relative = path.relative(path.resolve(apiRoot, appId), path.resolve(launchPath))
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
      return relative.split(path.sep).join("/")
    },
    isScriptReady: (scriptPath) => ready.has(path.resolve(scriptPath)),
    getScriptProgress: () => null,
    dns: async () => {}
  }
  const api = new Api(kernel)
  const resolver = new LaunchRequirements(kernel)
  kernel.api = api
  kernel.launchRequirements = resolver
  kernel.ensureLaunchRequirements = (launchPath, options = {}) => resolver.ensureForLaunchPath(launchPath, options)
  kernel.beginLaunchOperation = (launchPath, meta = {}) => resolver.beginLaunchOperation(launchPath, meta)
  kernel.endLaunchOperation = (token) => resolver.endLaunchOperation(token)
  kernel.hasLaunchRequirementConfig = async (launchPath) => {
    const appId = kernel.getAppIdForLaunchPath(launchPath)
    if (!appId) return false
    const env = await Environment.get(path.resolve(apiRoot, appId), kernel)
    return !!(env.PINOKIO_SCRIPT_AUTOLAUNCH && env.PINOKIO_SCRIPT_REQUIRES)
  }
  api.userdir = apiRoot
  api.running = {}
  api.listen("test", (packet) => events.push(packet))
  api.listApps = async () => ([
    { id: "helper", title: "Helper", icon: "/icon/helper.png" },
    { id: "target", title: "Target", icon: "/icon/target.png" }
  ])
  api.resolvePath = (base, uri) => {
    if (typeof uri === "string" && uri.startsWith("~/")) {
      return path.resolve(homedir, uri.slice(2))
    }
    return path.isAbsolute(uri) ? path.resolve(uri) : path.resolve(base, uri)
  }
  api.resolveScript = async (scriptPath) => ({
    cwd: path.dirname(scriptPath),
    script: { run: [{ method: "noop" }] }
  })
  api.isActionCandidate = () => true
  api.resolveActionSteps = async () => [{ method: "noop" }]
  api.setRunning = (request) => {
    api.running[request.path] = true
  }
  api.queue = (request) => {
    queued.push(path.relative(apiRoot, request.path).split(path.sep).join("/"))
    ready.add(path.resolve(request.path))
    delete api.running[request.path]
  }

  try {
    await fn({
      api,
      events,
      queued,
      resolver,
      launchPath: (appId, script = "start.js") => path.resolve(apiRoot, appId, script)
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function withApiStopFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-api-stop-"))
  const homedir = path.resolve(root, "home")
  const apiRoot = path.resolve(homedir, "api")
  const appRoot = path.resolve(apiRoot, "target")
  const launchPath = path.resolve(appRoot, "start.js")
  await fs.mkdir(appRoot, { recursive: true })
  await fs.writeFile(launchPath, "module.exports = { run: [] }\n", "utf8")

  const killedGroups = []
  const stopped = []
  const packets = []
  const kernel = {
    homedir,
    memory: { local: {} },
    shell: {
      kill: ({ group }) => {
        killedGroups.push(group)
      }
    },
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    resumeprocess: () => {},
    stopCloudflare: async () => {},
    markAppLaunchStopped: (scriptPath, options = {}) => {
      stopped.push({ scriptPath, options })
    }
  }
  const api = new Api(kernel)
  kernel.api = api
  api.userdir = apiRoot
  api.resolveScript = async () => ({
    cwd: appRoot,
    script: {}
  })
  api.listen("test", (packet) => packets.push(packet))

  try {
    await fn({ api, launchPath, killedGroups, stopped, packets })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test("launch requirements runtime state model has no failed timeout or persisted stopped states", async () => {
  const launchRequirements = await fs.readFile(path.resolve(__dirname, "..", "kernel", "launch_requirements.js"), "utf8")
  const autolaunch = await fs.readFile(path.resolve(__dirname, "..", "kernel", "autolaunch.js"), "utf8")
  const statusClient = await fs.readFile(path.resolve(__dirname, "..", "server", "views", "partials", "launch_requirements_status_client.ejs"), "utf8")

  assert.doesNotMatch(launchRequirements, /activePreparationStates\(\)[\s\S]*"failed"/)
  assert.doesNotMatch(launchRequirements, /activePreparationStates\(\)[\s\S]*"timeout"/)
  assert.doesNotMatch(launchRequirements, /setRequirementRow\([^)]*"timeout"/)
  assert.doesNotMatch(launchRequirements, /setStartupRow\([^)]*"timeout"/)
  assert.doesNotMatch(launchRequirements, /state:\s*"stopped"/)
  assert.doesNotMatch(autolaunch, /state:\s*"failed"/)
  assert.doesNotMatch(autolaunch, /\["blocked",\s*"failed",\s*"timeout"\]/)
  assert.doesNotMatch(statusClient, /row\.state === "timeout"/)
})

test("launch requirements have no automatic readiness timeout path", async () => {
  const launchRequirements = await fs.readFile(path.resolve(__dirname, "..", "kernel", "launch_requirements.js"), "utf8")

  assert.doesNotMatch(launchRequirements, /timeoutMs/)
  assert.doesNotMatch(launchRequirements, /Timed out waiting/)
  assert.doesNotMatch(launchRequirements, /Date\.now\(\) - startedAt < context\.timeoutMs/)
})

test("launch requirements use no second launch script environment key", async () => {
  const forbiddenKey = "PINOKIO" + "_SCRIPT" + "_LAUNCH"
  const forbiddenConstant = "SCRIPT" + "_LAUNCH" + "_KEY"
  const forbiddenMigration = "migrate" + "LegacyLaunchScriptEnv"
  const files = [
    "kernel/environment.js",
    "kernel/launch_requirements.js",
    "kernel/autolaunch.js",
    "server/autolaunch.js",
    "test/launch-requirements.test.js",
    "test/server-autolaunch.test.js",
    "test/launch-settings-ui.test.js"
  ]
  for (const file of files) {
    const text = await fs.readFile(path.resolve(__dirname, "..", file), "utf8")
    assert.equal(text.includes(forbiddenKey), false, `${file} must not mention ${forbiddenKey}`)
    assert.equal(text.includes(forbiddenConstant), false, `${file} must not mention ${forbiddenConstant}`)
    assert.equal(text.includes(forbiddenMigration), false, `${file} must not migrate launch script state`)
  }
})

test("launch requirements resolve recursive app fixtures in ancestor-first order", async () => {
  await withFixtureApps({
    "app-a": {},
    "app-b": { deps: ["app-a"] },
    "app-c": { deps: ["app-b"] }
  }, {}, async ({ resolver }) => {
    const apps = await resolver.appMap()
    const graph = await resolver.resolveGraph([await resolver.configFor("app-c", apps)], apps)

    assert.deepEqual(graph.order, ["app-a", "app-b", "app-c"])
  })
})

test("launch requirements preflight cycles before starting anything", async () => {
  await withFixtureApps({
    "app-a": { deps: ["app-b"] },
    "app-b": { deps: ["app-a"] },
    "app-c": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath, starts }) => {
    const result = await resolver.ensureForLaunchPath(launchPath("app-c"), { pollMs: 5 })
    assert.equal(result.action, "blocked")
    assert.match(result.blocked_reason, /Requirement cycle detected/)
    assert.equal(starts.length, 0)
  })
})

test("launch requirements expose missing requirement script in target status", async () => {
  await withFixtureApps({
    "app-a": { noScript: true },
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath, starts }) => {
    const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })
    assert.equal(result.action, "blocked")
    assert.equal(result.blocked_reason, "app-a has no launch script selected")

    const status = resolver.getStatus("target")
    assert.equal(starts.length, 0)
    assert.equal(status.state, "blocked")
    assert.equal(status.blocked_reason, "app-a has no launch script selected")
    assert.deepEqual(status.waiting_for, ["app-a"])
    assert.equal(status.requirements.length, 1)
    assert.equal(status.requirements[0].id, "app-a")
    assert.equal(status.requirements[0].state, "blocked")
    assert.equal(status.requirements[0].blocked_reason, "app-a has no launch script selected")
  })
})

test("launch requirements clear blocked status on explicit cancel", async () => {
  await withFixtureApps({
    "app-a": { noScript: true },
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath }) => {
    const targetPath = launchPath("target")
    const result = await resolver.ensureForLaunchPath(targetPath, { pollMs: 5 })
    assert.equal(result.action, "blocked")
    assert.equal(result.blocked_reason, "app-a has no launch script selected")

    assert.equal(resolver.getStatus("target").state, "blocked")
    assert.equal(resolver.cancel(targetPath, { force: true }), true)
    assert.equal(resolver.getStatus("target"), null)
  })
})

test("startup launch exposes blocked requirement status for app page", async () => {
  await withFixtureApps({
    "app-a": { noScript: true, title: "App A" },
    "target": { deps: ["app-a"], title: "Target" }
  }, {}, async ({ resolver, launchPath }) => {
    resolver.replaceStartupHomeStatus({ running: true, apps: {} })

    const result = await resolver.ensureForLaunchPath(launchPath("target"), {
      request: { startup: true },
      pollMs: 5
    })
    assert.equal(result.action, "blocked")
    assert.equal(result.blocked_reason, "App A has no launch script selected")

    const status = resolver.getStatus("target")
    assert.equal(status.state, "blocked")
    assert.equal(status.startup, true)
    assert.equal(status.blocked_reason, "App A has no launch script selected")
    assert.deepEqual(status.waiting_for, ["app-a"])
    assert.equal(status.requirements.length, 1)
    assert.equal(status.requirements[0].id, "app-a")
    assert.equal(status.requirements[0].title, "App A")
    assert.equal(status.requirements[0].state, "blocked")
    assert.equal(status.requirements[0].blocked_reason, "App A has no launch script selected")
  })
})

test("startup launch status preserves nested requirement chain", async () => {
  await withFixtureApps({
    "app-a": { noScript: true, title: "App A" },
    "app-b": { deps: ["app-a"], title: "App B" },
    "target": { deps: ["app-b"], title: "Target" }
  }, {}, async ({ resolver, launchPath }) => {
    resolver.replaceStartupHomeStatus({ running: true, apps: {} })

    const result = await resolver.ensureForLaunchPath(launchPath("target"), {
      request: { startup: true },
      pollMs: 5
    })
    assert.equal(result.action, "blocked")
    assert.equal(result.blocked_reason, "App A has no launch script selected")

    const status = resolver.getStatus("target")
    assert.equal(status.state, "blocked")
    assert.equal(status.startup, true)
    assert.equal(status.blocked_reason, "App A has no launch script selected")
    assert.deepEqual(status.requirements.map((row) => row.id), ["app-a", "app-b"])
    assert.equal(status.requirements[0].state, "blocked")
    assert.equal(status.requirements[1].state, "waiting")
  })
})

test("launch requirements clear status related to edited app", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver }) => {
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        "app-a": { id: "app-a", state: "blocked" },
        target: {
          id: "target",
          state: "blocked",
          waiting_for: ["app-a"],
          requirement_order: ["app-a"]
        }
      }
    })
    resolver.status.targets.target = {
      app_id: "target",
      state: "blocked",
      waiting_for: ["app-a"],
      requirement_order: ["app-a"],
      requirements: {
        "app-a": { id: "app-a", state: "blocked" }
      }
    }

    resolver.clearRelated("app-a")

    assert.equal(resolver.getStatus("target"), null)
    assert.equal(startupStatus.apps.target, undefined)
    assert.equal(startupStatus.apps["app-a"], undefined)
  })
})

test("launch requirements ignore legacy autolaunch dependency key", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"], legacyDeps: true }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), [])
  })
})

test("generated app environment preserves unsupported custom keys without cleanup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-launch-env-"))
  try {
    const homedir = path.resolve(root, "home")
    await fs.mkdir(homedir, { recursive: true })
    await fs.writeFile(path.resolve(homedir, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH_ORDER=kofmy,comfyfs.git",
      "PINOKIO_SCRIPT_AUTOLAUNCH_DEPENDS=kofmy",
      `PINOKIO_SCRIPT${"_LAUNCH"}=start.js`,
      "PINOKIO_CUSTOM_KEEP=keep",
      ""
    ].join("\n"), "utf8")
    const content = await Environment.ENV("app", homedir, {
      homedir,
      exists: async (target) => {
        try {
          await fs.access(target)
          return true
        } catch (_) {
          return false
        }
      }
    })

    assert.match(content, /PINOKIO_SCRIPT_AUTOLAUNCH_ORDER=kofmy,comfyfs\.git/)
    assert.match(content, /PINOKIO_SCRIPT_AUTOLAUNCH_DEPENDS=kofmy/)
    assert.match(content, new RegExp(`PINOKIO_SCRIPT${"_LAUNCH"}=start\\.js`))
    assert.match(content, /PINOKIO_CUSTOM_KEEP=keep/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("launch requirements emit target status events", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, events }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    const packets = events.filter((packet) => packet && packet.id === "kernel.launch_requirements:target")
    assert.ok(packets.length > 0)
    assert.ok(packets.some((packet) => packet.type === "launch.requirements" && packet.data && packet.data.status))
    assert.equal(packets[packets.length - 1].type, "launch.requirements")
    assert.equal(packets[packets.length - 1].data.status, null)
  })
})

test("api.process does not emit terminal disconnect for requirement control results", async () => {
  for (const result of [
    { action: "handled", app_id: "target" },
    { action: "blocked", app_id: "target", blocked_reason: "target is waiting" },
    { action: "cancelled", app_id: "target" }
  ]) {
    await withApiProcessFixture(result, async ({ api, packets, setRunningCalls }) => {
      const response = await api.process({ uri: "target/start.js" })
      assert.deepEqual(response.launch_requirements, result)
      assert.equal(setRunningCalls(), 0)
      assert.equal(packets.some((packet) => packet && packet.type === "disconnect"), false)
      assert.deepEqual(
        packets.filter((packet) => packet && packet.type === "launch.requirements.control").map((packet) => packet.data),
        [result]
      )
    })
  }
})

test("api.process continues into normal script execution after requirements are ready", async () => {
  await withApiProcessFixture({ action: "continue" }, async ({ api, packets, setRunningCalls }) => {
    await api.process({ uri: "target/start.js" })
    assert.equal(setRunningCalls(), 1)
    assert.equal(packets.some((packet) => packet && packet.type === "disconnect"), false)
  })
})

test("api.process launches target after preparing configured launch script requirements", async () => {
  await withApiBridgeFixture(async ({ api, queued, launchPath, events }) => {
    const response = await api.process({ uri: launchPath("target") })

    assert.equal(response && response.launch_requirements, undefined)
    assert.deepEqual(queued, ["helper/start.js", "target/start.js"])
    assert.equal(events.some((packet) => packet && packet.type === "disconnect"), false)
  })
})

test("api.process launches target after preparing requirements from browser-style home URI", async () => {
  await withApiBridgeFixture(async ({ api, queued, events }) => {
    const response = await api.process({ uri: "~/api/target/start.js" })

    assert.equal(response && response.launch_requirements, undefined)
    assert.deepEqual(queued, ["helper/start.js", "target/start.js"])
    assert.equal(events.some((packet) => packet && packet.type === "disconnect"), false)
  })
})

test("api.process launches non-default target script after preparing requirements from browser-style home URI", async () => {
  await withApiBridgeFixture(async ({ api, queued, events }) => {
    const response = await api.process({ uri: "~/api/target/custom-launch.js" })

    assert.equal(response && response.launch_requirements, undefined)
    assert.deepEqual(queued, ["helper/start.js", "target/custom-launch.js"])
    assert.equal(events.some((packet) => packet && packet.type === "disconnect"), false)
  }, { targetScript: "custom-launch.js" })
})

test("api.process bypasses launch requirement plumbing when no launch env exists", async () => {
  await withApiProcessFixture({ action: "blocked", blocked_reason: "should not run" }, async ({ api, packets, setRunningCalls, requirementCalls }) => {
    await api.process({ uri: "target/start.js" })
    assert.equal(requirementCalls(), 0)
    assert.equal(setRunningCalls(), 1)
    assert.equal(packets.some((packet) => packet && packet.type === "disconnect"), false)
  }, { hasRequirementConfig: false })
})

test("api.process bypasses launch requirement plumbing when launch script exists without requirements", async () => {
  await withApiProcessFixture({ action: "blocked", blocked_reason: "should not run" }, async ({ api, packets, setRunningCalls, requirementCalls }) => {
    await api.process({ uri: "target/start.js" })
    assert.equal(requirementCalls(), 0)
    assert.equal(setRunningCalls(), 1)
    assert.equal(packets.some((packet) => packet && packet.type === "disconnect"), false)
  }, { hasRequirementConfig: false })
})

test("kernel launch requirement config gate requires both configured launch script and requirements", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-launch-config-gate-"))
  try {
    const homedir = path.resolve(root, "home")
    const apiRoot = path.resolve(homedir, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const launchPath = path.resolve(appRoot, "start.js")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(launchPath, "module.exports = { run: [] }\n", "utf8")

    const fakeKernel = {
      exists: async (filepath) => {
        try {
          await fs.stat(filepath)
          return true
        } catch (_) {
          return false
        }
      },
      path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
      getAppIdForLaunchPath: (value) => {
        const relative = path.relative(apiRoot, path.resolve(value))
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return ""
        return relative.split(path.sep)[0] || ""
      }
    }

    await fs.writeFile(path.resolve(appRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=",
      ""
    ].join("\n"), "utf8")
    assert.equal(await Kernel.prototype.hasLaunchRequirementConfig.call(fakeKernel, launchPath), false)

    await fs.writeFile(path.resolve(appRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")
    assert.equal(await Kernel.prototype.hasLaunchRequirementConfig.call(fakeKernel, launchPath), false)

    await fs.writeFile(path.resolve(appRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")
    assert.equal(await Kernel.prototype.hasLaunchRequirementConfig.call(fakeKernel, launchPath), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("launch requirement lifecycle hooks are inert for no-env app launches", async () => {
  await withFixtureApps({
    target: { noLaunchConfig: true }
  }, {}, async ({ resolver, events, launchPath }) => {
    const targetPath = launchPath("target")

    resolver.markStarted(targetPath)
    resolver.markProgress(targetPath, { step_current: 1, step_total: 2 })
    resolver.markDone(targetPath)
    resolver.cancel(targetPath)
    resolver.clearRelated("target")

    assert.equal(resolver.getStatus("target"), null)
    assert.equal(resolver.startupHomeStatus().apps.target, undefined)
    assert.deepEqual(events.filter((packet) => packet && packet.type === "launch.requirements"), [])
  })
})

test("kernel lifecycle hooks do not call launch requirement hooks without active requirement runtime", () => {
  const calls = []
  const launchPath = path.resolve("/tmp/pinokio/api/target/custom.js")
  const fakeKernel = {
    readyState: {
      markStarted: () => ({ state: "running" }),
      markProgress: () => ({ step_current: 1, step_total: 2 }),
      markReady: () => ({ state: "ready" }),
      markStopped: () => ({ state: "stopped" }),
      getAppIdForLaunchPath: () => "target"
    },
    launchRequirements: {
      hasRuntimeForLaunchPath: () => false,
      markStartupStarted: () => calls.push("markStartupStarted"),
      markStarted: () => calls.push("markStarted"),
      markProgress: () => calls.push("markProgress"),
      markStartupReady: () => calls.push("markStartupReady"),
      markDone: () => calls.push("markDone"),
      markStartupStopped: () => calls.push("markStartupStopped"),
      cancel: () => {
        calls.push("cancel")
        return false
      },
      clearRelated: () => calls.push("clearRelated")
    },
    hasLaunchRequirementRuntime: Kernel.prototype.hasLaunchRequirementRuntime
  }

  Kernel.prototype.markAppLaunchStarted.call(fakeKernel, launchPath)
  Kernel.prototype.markAppLaunchProgress.call(fakeKernel, launchPath, 1, 2)
  Kernel.prototype.markAppLaunchReady.call(fakeKernel, launchPath)
  Kernel.prototype.markAppLaunchStopped.call(fakeKernel, launchPath)

  assert.deepEqual(calls, [])
})

test("launch requirements do not run for non-configured explicit app scripts", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target", "install.js"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), [])
  })
})

test("launch requirements run when requested script is configured launch script regardless of filename", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"], script: "fuckyou-chatgpt.js" }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target", "fuckyou-chatgpt.js"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), ["app-a"])
  })
})

test("launch requirements do not run when no launch script and no requirements are configured", async () => {
  await withFixtureApps({
    "target": { noLaunchConfig: true }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), [])
  })
})

test("launch requirements do not block concrete scripts when stale requirements have no owning launch script", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"], noLaunchConfig: true }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), [])
    assert.equal(resolver.getStatus("target"), null)
  })
})

test("launch requirements start independent requirements in parallel", async () => {
  await withFixtureApps({
    "app-a": {},
    "app-b": {},
    "app-c": {},
    "target": { deps: ["app-a", "app-b", "app-c"] }
  }, { readyDelayMs: 40 }, async ({ resolver, launchPath, starts }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app).sort(), ["app-a", "app-b", "app-c"])
    const spread = Math.max(...starts.map((start) => start.at)) - Math.min(...starts.map((start) => start.at))
    assert.ok(spread < 30, `expected independent requirements to start together, got ${spread}ms spread`)
  })
})

test("launch requirements include waiting reason on nested requirement rows", async () => {
  await withFixtureApps({
    "app-a": {},
    "app-b": { deps: ["app-a"] },
    "target": { deps: ["app-b"] }
  }, { readyDelayMs: 30 }, async ({ resolver, launchPath, events }) => {
    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    const nestedWaitingStatus = events
      .map((event) => event && event.data ? event.data.status : null)
      .find((status) => {
        const row = status && Array.isArray(status.requirements)
          ? status.requirements.find((requirement) => requirement.id === "app-b")
          : null
        return row && row.state === "waiting" && Array.isArray(row.waiting_for) && row.waiting_for.includes("app-a")
      })

    assert.ok(nestedWaitingStatus, "expected app-b waiting row to explain it is waiting for app-a")
  })
})

test("launch requirements do not restart an already ready requirement", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath, markReady, starts }) => {
    markReady("app-a")

    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.equal(starts.length, 0)
  })
})

test("launch requirements wait for an already running requirement instead of duplicating it", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, { readyAfterStart: false }, async ({ resolver, launchPath, running, markReady, starts }) => {
    running[launchPath("app-a")] = true
    setTimeout(() => markReady("app-a"), 30)

    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.equal(starts.length, 0)
  })
})

test("normal completion of a required app does not cancel the waiting target launch", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, { readyDelayMs: 20, simulateKernelLifecycle: true }, async ({ resolver, launchPath, starts }) => {
    const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.equal(result.action, "continue")
    assert.deepEqual(starts.map((start) => start.app), ["app-a"])
  })
})

test("display-only startup row does not prevent manual target launch", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          state: "waiting",
          launch_path: launchPath("target"),
          waiting_for: ["app-a"]
        }
      }
    })

    const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })
    assert.equal(result.action, "continue")

    assert.deepEqual(starts.map((start) => start.app), ["app-a"])
  })
})

test("active launch ownership prevents duplicate manual target launch", async () => {
  await withFixtureApps({
    "app-a": {},
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath, starts }) => {
    const token = resolver.beginLaunchOperation(launchPath("target"))
    try {
      const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })
      assert.equal(result.action, "handled")
      assert.equal(result.app_id, "target")
      assert.equal(starts.length, 0)
    } finally {
      resolver.endLaunchOperation(token)
    }
  })
})

test("display-only startup row for offline required app still starts required app", async () => {
  await withFixtureApps({
    "required-app": {},
    "target": { deps: ["required-app"] }
  }, { readyDelayMs: 20 }, async ({ resolver, launchPath, starts }) => {
    resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        "required-app": {
          id: "required-app",
          state: "pending",
          launch_path: launchPath("required-app"),
          script: "start.js",
          startup_root: true,
          waiting_for: []
        }
      }
    })

    const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.equal(result.action, "continue")
    assert.deepEqual(starts.map((start) => start.app), ["required-app"])
  })
})

test("stale script progress is hidden when there is no active or running launch", async () => {
  await withFixtureApps({
    "required-app": {}
  }, {}, async ({ resolver, kernel, launchPath }) => {
    kernel.getScriptProgress = () => ({ step_current: 2, step_total: 2 })
    const apps = await resolver.appMap()
    const config = await resolver.configFor("required-app", apps)

    const row = resolver.makeRow(config, "waiting")
    assert.equal(row.step_current, undefined)
    assert.equal(row.step_total, undefined)

    const token = resolver.beginLaunchOperation(launchPath("required-app"))
    try {
      const activeRow = resolver.makeRow(config, "starting")
      assert.equal(activeRow.step_current, 2)
      assert.equal(activeRow.step_total, 2)
    } finally {
      resolver.endLaunchOperation(token)
    }
  })
})

test("launch requirement status does not surface stale progress without an active launch", async () => {
  await withFixtureApps({
    "required-app": {},
    "target": { deps: ["required-app"] }
  }, {}, async ({ resolver, kernel, launchPath }) => {
    kernel.getScriptProgress = () => ({ step_current: 2, step_total: 2 })
    const apps = await resolver.appMap()
    const targetConfig = await resolver.configFor("target", apps)
    const requiredConfig = await resolver.configFor("required-app", apps)

    resolver.setTargetStatus(targetConfig, "waiting", {
      requirements: {},
      requirement_order: ["required-app"],
      waiting_for: ["required-app"]
    })
    resolver.setRequirementRow("target", requiredConfig, "starting")

    const staleStatus = resolver.getStatus("target")
    assert.equal(staleStatus.requirements[0].step_current, undefined)
    assert.equal(staleStatus.requirements[0].step_total, undefined)

    const token = resolver.beginLaunchOperation(launchPath("required-app"))
    try {
      const activeStatus = resolver.getStatus("target")
      assert.equal(activeStatus.requirements[0].step_current, 2)
      assert.equal(activeStatus.requirements[0].step_total, 2)
    } finally {
      resolver.endLaunchOperation(token)
    }
  })
})

test("startup rows clear stale progress before a fresh launch reports progress", async () => {
  await withFixtureApps({
    "required-app": {}
  }, {}, async ({ resolver, kernel, launchPath }) => {
    kernel.getScriptProgress = () => ({ step_current: 2, step_total: 2 })
    const apps = await resolver.appMap()
    const config = await resolver.configFor("required-app", apps)
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        "required-app": {
          id: "required-app",
          state: "ready",
          launch_path: launchPath("required-app"),
          script: "start.js",
          step_current: 2,
          step_total: 2
        }
      }
    })

    resolver.markStartupStarted("required-app")
    assert.equal(startupStatus.apps["required-app"].step_current, undefined)
    assert.equal(startupStatus.apps["required-app"].step_total, undefined)

    resolver.setStartupRow(startupStatus, config, "starting")
    assert.equal(startupStatus.apps["required-app"].step_current, undefined)
    assert.equal(startupStatus.apps["required-app"].step_total, undefined)

    const token = resolver.beginLaunchOperation(launchPath("required-app"))
    try {
      resolver.setStartupRow(startupStatus, config, "starting")
      assert.equal(startupStatus.apps["required-app"].step_current, 2)
      assert.equal(startupStatus.apps["required-app"].step_total, 2)
    } finally {
      resolver.endLaunchOperation(token)
    }
  })
})

test("explicitly stopping a required app clears dependent launch requirement state", async () => {
  await withFixtureApps({
    "required-app": {},
    "target": { deps: ["required-app"] }
  }, {}, async ({ resolver, kernel, launchPath }) => {
    const apps = await resolver.appMap()
    const targetConfig = await resolver.configFor("target", apps)
    const requiredConfig = await resolver.configFor("required-app", apps)

    resolver.setTargetStatus(targetConfig, "waiting", {
      requirements: {},
      requirement_order: ["required-app"],
      waiting_for: ["required-app"]
    })
    resolver.setRequirementRow("target", requiredConfig, "starting")
    resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          state: "waiting",
          waiting_for: ["required-app"],
          dependencies: ["required-app"]
        },
        "required-app": {
          id: "required-app",
          state: "starting",
          waiting_for: []
        }
      }
    })

    assert.ok(resolver.getStatus("target"))

    kernel.markAppLaunchStopped(launchPath("required-app"))

    assert.equal(resolver.getStatus("target"), null)
    assert.equal(resolver.cancelled.has("target"), true)
    assert.equal(resolver.startupHomeStatus().apps.target, undefined)
    assert.equal(resolver.startupHomeStatus().apps["required-app"], undefined)
  })
})

test("api.stop stops the canonical script path when the visible run id is decorated", async () => {
  await withApiStopFixture(async ({ api, launchPath, killedGroups, stopped }) => {
    const decoratedId = `${launchPath}?cwd=undefined`
    api.running[launchPath] = true
    api.running[decoratedId] = true
    api.kernel.memory.local[launchPath] = { live: true }
    api.kernel.memory.local[decoratedId] = { live: true }

    await api.stop({ params: { id: decoratedId } })

    assert.equal(api.running[launchPath], undefined)
    assert.equal(api.running[decoratedId], undefined)
    assert.equal(api.kernel.memory.local[launchPath], undefined)
    assert.equal(api.kernel.memory.local[decoratedId], undefined)
    assert.ok(killedGroups.includes(launchPath), "canonical script group must be killed")
    assert.ok(killedGroups.includes(decoratedId), "visible run id group must remain stopped")
    assert.equal(stopped.length, 1)
    assert.equal(stopped[0].scriptPath, launchPath)
  })
})

test("api.stop disconnects when the script was deleted before stop cleanup", async () => {
  await withApiStopFixture(async ({ api, launchPath, killedGroups, stopped, packets }) => {
    const decoratedId = `${launchPath}?cwd=undefined`
    api.resolveScript = async () => {
      const error = new Error("missing script")
      error.code = "ENOENT"
      throw error
    }
    api.running[launchPath] = true
    api.running[decoratedId] = true
    api.kernel.memory.local[launchPath] = { live: true }
    api.kernel.memory.local[decoratedId] = { live: true }

    await api.stop({ params: { id: decoratedId } })

    assert.equal(api.running[launchPath], undefined)
    assert.equal(api.running[decoratedId], undefined)
    assert.equal(api.kernel.memory.local[launchPath], undefined)
    assert.equal(api.kernel.memory.local[decoratedId], undefined)
    assert.ok(killedGroups.includes(launchPath), "canonical script group must be killed")
    assert.ok(killedGroups.includes(decoratedId), "visible run id group must remain stopped")
    assert.equal(stopped.length, 1)
    assert.equal(stopped[0].scriptPath, launchPath)
    assert.ok(packets.some((packet) => packet.type === "disconnect" && packet.id === decoratedId))
  })
})

test("startup launch request does not block on its own startup status row", async () => {
  await withFixtureApps({
    target: {}
  }, {}, async ({ resolver, launchPath, starts }) => {
    resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          state: "pending",
          launch_path: launchPath("target"),
          waiting_for: []
        }
      }
    })

    await resolver.ensureForLaunchPath(launchPath("target"), {
      request: { startup: true },
      pollMs: 5
    })

    assert.equal(starts.length, 0)
  })
})

test("manual launch ignores display-only blocked startup row and evaluates current config", async () => {
  await withFixtureApps({
    "app-a": { noScript: true },
    "target": { deps: ["app-a"] }
  }, {}, async ({ resolver, launchPath, starts }) => {
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: false,
      apps: {
        target: {
          id: "target",
          state: "blocked",
          launch_path: launchPath("target"),
          blocked_reason: "app-a has no launch script selected",
          waiting_for: ["app-a"],
          requirement_order: ["app-a"]
        },
        "app-a": {
          id: "app-a",
          state: "blocked",
          blocked_reason: "app-a has no launch script selected"
        }
      }
    })

    const result = await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })
    assert.equal(result.action, "blocked")
    assert.equal(result.blocked_reason, "app-a has no launch script selected")

    assert.equal(starts.length, 0)
    assert.equal(resolver.getStatus("target").state, "blocked")
    assert.equal(startupStatus.apps.target.state, "blocked")
  })
})

test("autolaunch scheduler starts roots through normal api.process requests", async () => {
  await withFixtureApps({
    target: { autolaunch: true, title: "Target" }
  }, {}, async ({ kernel, starts, launchPath }) => {
    const requests = []
    const originalProcess = kernel.api.process
    kernel.i = {
      api: [{ path: "target", title: "Target" }]
    }
    kernel.api.process = async (request) => {
      requests.push({ ...request })
      return originalProcess(request)
    }

    const autolaunch = new Autolaunch(kernel)
    await autolaunch.runScheduler()

    assert.equal(requests.length, 1)
    assert.equal(path.resolve(requests[0].uri), launchPath("target"))
    assert.equal(requests[0].startup, true)
    assert.equal(requests[0].skip_requirements, undefined)
    assert.deepEqual(starts.map((start) => start.app), ["target"])
  })
})

test("autolaunch scheduler skips configured scripts when startup is disabled", async () => {
  await withFixtureApps({
    target: { startup: false, title: "Target" }
  }, {}, async ({ kernel, starts, launchPath }) => {
    const requests = []
    const originalProcess = kernel.api.process
    kernel.i = {
      api: [{ path: "target", title: "Target" }]
    }
    kernel.api.process = async (request) => {
      requests.push({ ...request })
      return originalProcess(request)
    }

    const autolaunch = new Autolaunch(kernel)
    await autolaunch.runScheduler()

    const env = await fs.readFile(path.resolve(kernel.api.userdir, "target", "ENVIRONMENT"), "utf8")
    assert.equal(env.includes("PINOKIO_SCRIPT_AUTOLAUNCH=start.js"), true)
    assert.equal(requests.length, 0)
    assert.deepEqual(starts.map((start) => start.app), [])
    assert.equal(kernel.autolaunch_status.apps.target, undefined)
  })
})

test("autolaunch scheduler seeds startup requirements before launching roots", async () => {
  await withFixtureApps({
    "app-a": { title: "App A" },
    target: { autolaunch: true, deps: ["app-a"], title: "Target" }
  }, { readyAfterStart: false }, async ({ kernel, resolver, launchPath }) => {
    let firstStatus = null
    const originalProcess = kernel.api.process
    kernel.i = {
      api: [{ path: "target", title: "Target" }]
    }
    kernel.launchRequirements = resolver
    kernel.api.process = async (request) => {
      if (!firstStatus) {
        firstStatus = JSON.parse(JSON.stringify(kernel.autolaunch_status))
      }
      return originalProcess(request)
    }

    const autolaunch = new Autolaunch(kernel)
    await autolaunch.runScheduler()

    assert.ok(firstStatus)
    assert.equal(firstStatus.apps.target.startup_root, true)
    assert.equal(firstStatus.apps.target.launch_path, launchPath("target"))
    assert.deepEqual(firstStatus.apps.target.dependencies, ["app-a"])
    assert.deepEqual(firstStatus.apps.target.waiting_for, ["app-a"])
    assert.equal(firstStatus.apps["app-a"].startup_root, false)
    assert.equal(firstStatus.apps["app-a"].launch_path, launchPath("app-a"))
    assert.equal(firstStatus.apps["app-a"].state, "pending")
  })
})

test("autolaunch scheduler must not migrate startup script into a second launch key", async () => {
  await withFixtureApps({
    target: { autolaunch: true, noLaunchConfig: true, title: "Target" }
  }, {}, async ({ kernel, starts, launchPath }) => {
    const requests = []
    const originalProcess = kernel.api.process
    kernel.i = {
      api: [{ path: "target", title: "Target" }]
    }
    kernel.api.process = async (request) => {
      requests.push({ ...request })
      return originalProcess(request)
    }

    const autolaunch = new Autolaunch(kernel)
    await autolaunch.runScheduler()

    const env = await fs.readFile(path.resolve(kernel.api.userdir, "target", "ENVIRONMENT"), "utf8")
    const forbiddenKey = "PINOKIO" + "_SCRIPT" + "_LAUNCH"
    assert.equal(env.includes(forbiddenKey), false)
    assert.equal(requests.length, 0)
    assert.deepEqual(starts.map((start) => start.app), [])
  })
})

test("startup launch mirrors requirement-only apps into startup status", async () => {
  await withFixtureApps({
    "app-a": {},
    target: { deps: ["app-a"], title: "Target" }
  }, { readyAfterStart: false }, async ({ resolver, launchPath, starts }) => {
    const targetPath = launchPath("target")
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          title: "Target",
          script: "start.js",
          launch_path: targetPath,
          state: "pending",
          startup_root: true,
          waiting_for: ["app-a"]
        }
      }
    })
    const pending = resolver.ensureForLaunchPath(targetPath, {
      request: { startup: true },
      pollMs: 10
    })

    const startedAt = Date.now()
    while (!startupStatus.apps["app-a"] && Date.now() - startedAt < 500) {
      await delay(5)
    }

    assert.deepEqual(starts.map((start) => start.app), ["app-a"])
    assert.equal(startupStatus.apps["app-a"].state, "starting")
    assert.equal(startupStatus.apps["app-a"].startup_root, false)
    assert.deepEqual(startupStatus.apps.target.waiting_for, ["app-a"])

    assert.equal(resolver.cancel(targetPath), true)
    const result = await pending
    assert.equal(result.action, "cancelled")
    assert.equal(result.app_id, "target")
  })
})

test("startup launch does not duplicate a startup root that is also required", async () => {
  await withFixtureApps({
    "app-a": { autolaunch: true, title: "App A" },
    target: { autolaunch: true, deps: ["app-a"], title: "Target" }
  }, { readyAfterStart: false }, async ({ kernel, resolver, apiRoot, starts, running, ready, launchPath }) => {
    kernel.i = {
      api: [
        { path: "target", title: "Target" },
        { path: "app-a", title: "App A" }
      ]
    }
    kernel.launchRequirements = resolver
    kernel.api.process = async (request) => {
      const uri = path.resolve(request.uri)
      if (!request.skip_requirements) {
        const requirementResult = await resolver.ensureForLaunchPath(uri, {
          request,
          pollMs: 5
        })
        if (requirementResult && requirementResult.action !== "continue") {
          return requirementResult
        }
      }
      starts.push({
        uri,
        app: path.relative(apiRoot, uri).split(path.sep)[0],
        at: Date.now(),
        startup: !!request.startup,
        skip_requirements: !!request.skip_requirements
      })
      running[uri] = true
      setTimeout(() => ready.add(uri), 20)
    }

    const autolaunch = new Autolaunch(kernel)
    await autolaunch.runScheduler()

    assert.equal(starts.filter((start) => start.app === "app-a").length, 1)
    assert.equal(starts.filter((start) => start.app === "target").length, 1)
    assert.equal(kernel.autolaunch_status.apps["app-a"].startup_root, true)
    assert.equal(kernel.autolaunch_status.apps["app-a"].launch_path, launchPath("app-a"))
  })
})

test("autolaunch status is backed by launch requirements startup status", async () => {
  await withFixtureApps({
    target: { autolaunch: true, title: "Target" }
  }, {}, async ({ kernel }) => {
    const resolver = new LaunchRequirements(kernel)
    kernel.launchRequirements = resolver

    const autolaunch = new Autolaunch(kernel)
    assert.strictEqual(autolaunch.startupStatus(), resolver.startupHomeStatus())
    assert.strictEqual(kernel.autolaunch_status, resolver.startupHomeStatus())

    const nextStatus = {
      running: true,
      apps: {
        target: { id: "target", state: "pending" }
      }
    }
    autolaunch.setStatus(nextStatus)

    assert.strictEqual(autolaunch.startupStatus(), resolver.startupHomeStatus())
    assert.strictEqual(kernel.autolaunch_status, resolver.startupHomeStatus())
    assert.equal(resolver.startupHomeStatus().apps.target.state, "pending")
  })
})

test("launch requirements clears startup status on stop instead of persisting stopped state", async () => {
  await withFixtureApps({
    target: { title: "Target" }
  }, {}, async ({ resolver }) => {
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          state: "pending",
          waiting_for: ["helper"]
        }
      }
    })

    resolver.markStartupStarted("target")
    assert.equal(startupStatus.apps.target.state, "starting")
    assert.deepEqual(startupStatus.apps.target.waiting_for, [])

    resolver.markStartupReady("target")
    assert.equal(startupStatus.apps.target.state, "ready")
    assert.ok(startupStatus.apps.target.ready_at)

    startupStatus.apps.target.state = "starting"
    resolver.markStartupStopped("target")
    assert.equal(startupStatus.apps.target, undefined)

    startupStatus.apps.target = {
      id: "target",
      state: "blocked",
      waiting_for: []
    }
    resolver.markStartupStopped("target")
    assert.equal(startupStatus.apps.target, undefined)
  })
})

test("manual explicit script is not blocked by requirement-only status without a launch path", async () => {
  await withFixtureApps({
    "app-a": { noLaunchConfig: true }
  }, {}, async ({ resolver, launchPath, starts }) => {
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: false,
      apps: {
        "app-a": {
          id: "app-a",
          state: "blocked",
          blocked_reason: "app-a has no launch script selected",
          waiting_for: []
        }
      }
    })

    await resolver.ensureForLaunchPath(launchPath("app-a"), { pollMs: 5 })

    assert.equal(starts.length, 0)
    assert.equal(resolver.getStatus("app-a"), null)
    assert.equal(startupStatus.apps["app-a"].state, "blocked")
  })
})

test("launch requirements dedupe one required app shared by concurrent targets", async () => {
  await withFixtureApps({
    "shared": {},
    "target-a": { deps: ["shared"] },
    "target-b": { deps: ["shared"] }
  }, { startDelayMs: 25, readyDelayMs: 40 }, async ({ resolver, launchPath, starts }) => {
    await Promise.all([
      resolver.ensureForLaunchPath(launchPath("target-a"), { pollMs: 5 }),
      resolver.ensureForLaunchPath(launchPath("target-b"), { pollMs: 5 })
    ])

    assert.deepEqual(starts.map((start) => start.app), ["shared"])
  })
})

test("launch requirements clear in-flight start state after a start failure", async () => {
  await withFixtureApps({
    "shared": {},
    "target": { deps: ["shared"] }
  }, { processFailuresBeforeSuccess: 1 }, async ({ resolver, launchPath, starts }) => {
    await assert.rejects(
      resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 }),
      /process failed/
    )
    assert.equal(resolver.inflightStarts.size, 0)

    await resolver.ensureForLaunchPath(launchPath("target"), { pollMs: 5 })

    assert.deepEqual(starts.map((start) => start.app), ["shared"])
  })
})

test("launch requirements cancel a waiting target without stopping its requirement", async () => {
  await withFixtureApps({
    "shared": {},
    "target": { deps: ["shared"] }
  }, { readyAfterStart: false }, async ({ resolver, launchPath, starts, running }) => {
    const targetPath = launchPath("target")
    const sharedPath = launchPath("shared")
    const pending = resolver.ensureForLaunchPath(targetPath, { pollMs: 10 })

    while (!resolver.getStatus("target")) {
      await delay(5)
    }
    const startedAt = Date.now()
    while (starts.length === 0 && Date.now() - startedAt < 500) {
      await delay(5)
    }

    assert.equal(resolver.cancel(targetPath), true)
    const result = await pending
    assert.equal(result.action, "cancelled")
    assert.equal(result.app_id, "target")
    assert.equal(resolver.getStatus("target"), null)
    assert.deepEqual(starts.map((start) => start.app), ["shared"])
    assert.equal(running[sharedPath], true)
  })
})

test("launch requirements cancel nested attempt clears waiting intermediate without stopping started leaf", async () => {
  await withFixtureApps({
    "leaf": {},
    "middle": { deps: ["leaf"] },
    "target": { deps: ["middle"] }
  }, { readyAfterStart: false, simulateKernelLifecycle: true }, async ({ resolver, kernel, launchPath, starts, running, ready }) => {
    const targetPath = launchPath("target")
    const middlePath = launchPath("middle")
    const leafPath = launchPath("leaf")
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {}
    })
    const pending = resolver.ensureForLaunchPath(targetPath, { pollMs: 10 })

    assert.equal(await waitFor(() => starts.some((start) => start.app === "leaf")), true)
    assert.equal(await waitFor(() => {
      return startupStatus.apps.middle && startupStatus.apps.middle.state === "waiting"
    }), true)

    assert.equal(startupStatus.apps.middle.waiting_for.includes("leaf"), true)
    assert.equal(running[leafPath], true)

    assert.equal(resolver.cancel(targetPath), true)
    const result = await pending

    assert.equal(result.action, "cancelled")
    assert.equal(result.app_id, "target")
    assert.equal(resolver.getStatus("target"), null)
    assert.equal(startupStatus.apps.target, undefined)
    assert.equal(startupStatus.apps.middle, undefined)
    assert.equal(startupStatus.apps.leaf.state, "starting")
    assert.equal(running[leafPath], true)
    assert.deepEqual(starts.map((start) => start.app), ["leaf"])

    ready.add(leafPath)
    kernel.markAppLaunchReady(leafPath)
    await delay(30)

    assert.equal(startupStatus.apps.middle, undefined)
    assert.equal(running[middlePath], undefined)
    assert.deepEqual(starts.map((start) => start.app), ["leaf"])
  })
})

test("launch requirements cancel clears stale process-started intermediate rows that are not running or ready", async () => {
  await withFixtureApps({
    "leaf": {},
    "middle": { deps: ["leaf"] },
    "target": { deps: ["middle"] }
  }, {}, async ({ resolver, launchPath, running, ready }) => {
    const targetPath = launchPath("target")
    const middlePath = launchPath("middle")
    const leafPath = launchPath("leaf")
    resolver.setTargetStatus({
      id: "target",
      title: "Target",
      icon: "/icon/target.png",
      launchScript: "start.js",
      launchPath: targetPath,
      dependencies: ["middle"]
    }, "waiting", {
      waiting_for: ["middle"]
    })
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          title: "Target",
          script: "start.js",
          launch_path: targetPath,
          state: "waiting",
          waiting_for: ["middle"],
          owner_app_ids: ["target"]
        },
        middle: {
          id: "middle",
          title: "Middle",
          script: "start.js",
          launch_path: middlePath,
          state: "starting",
          waiting_for: [],
          process_started: true,
          owner_app_ids: ["target"]
        },
        leaf: {
          id: "leaf",
          title: "Leaf",
          script: "start.js",
          launch_path: leafPath,
          state: "starting",
          waiting_for: [],
          process_started: true,
          owner_app_ids: ["target"]
        }
      }
    })
    running[leafPath] = true
    assert.equal(ready.has(middlePath), false)
    assert.equal(running[middlePath], undefined)

    assert.equal(resolver.cancel(targetPath), true)

    assert.equal(startupStatus.apps.target, undefined)
    assert.equal(startupStatus.apps.middle, undefined)
    assert.equal(startupStatus.apps.leaf.state, "starting")
    assert.equal(running[leafPath], true)
  })
})

test("launch requirements force cancel clears target startup row even when active target state is gone", async () => {
  await withFixtureApps({
    "leaf": {},
    "target": { deps: ["leaf"] }
  }, {}, async ({ resolver, launchPath, running }) => {
    const targetPath = launchPath("target")
    const leafPath = launchPath("leaf")
    const startupStatus = resolver.replaceStartupHomeStatus({
      running: true,
      apps: {
        target: {
          id: "target",
          title: "Target",
          script: "start.js",
          launch_path: targetPath,
          state: "waiting",
          waiting_for: ["leaf"],
          startup_root: true
        },
        leaf: {
          id: "leaf",
          title: "Leaf",
          script: "start.js",
          launch_path: leafPath,
          state: "starting",
          waiting_for: [],
          owner_app_ids: ["target"],
          process_started: true
        }
      }
    })
    running[leafPath] = true

    assert.equal(resolver.cancel(targetPath, { force: true }), true)

    assert.equal(resolver.cancelled.has("target"), true)
    assert.equal(startupStatus.apps.target, undefined)
    assert.equal(startupStatus.apps.leaf.state, "starting")
    assert.equal(startupStatus.apps.leaf.owner_app_ids, undefined)
    assert.equal(running[leafPath], true)
  })
})

test("launch requirements reentrant target check after cancel does not erase cancellation", async () => {
  await withFixtureApps({
    "leaf": {},
    "middle": { deps: ["leaf"] },
    "target": { deps: ["middle"] }
  }, { readyAfterStart: false, simulateKernelLifecycle: true }, async ({ resolver, kernel, launchPath, starts, running, ready }) => {
    const targetPath = launchPath("target")
    const middlePath = launchPath("middle")
    const leafPath = launchPath("leaf")
    const owner = resolver.beginLaunchOperation(targetPath, { request: { uri: targetPath } })
    const pending = resolver.ensureForLaunchPath(targetPath, { owner, pollMs: 10 })

    assert.equal(await waitFor(() => starts.some((start) => start.app === "leaf")), true)
    assert.equal(resolver.cancel(targetPath), true)

    const reentrantOwner = resolver.beginLaunchOperation(targetPath, { request: { uri: targetPath } })
    const reentrant = await resolver.ensureForLaunchPath(targetPath, { owner: reentrantOwner, pollMs: 10 })
    resolver.endLaunchOperation(reentrantOwner)

    assert.equal(reentrant.action, "cancelled")
    assert.equal(reentrant.app_id, "target")

    ready.add(leafPath)
    kernel.markAppLaunchReady(leafPath)
    await delay(30)

    const result = await pending
    resolver.endLaunchOperation(owner)

    assert.equal(result.action, "cancelled")
    assert.equal(result.app_id, "target")
    assert.equal(running[leafPath], true)
    assert.equal(running[middlePath], undefined)
    assert.deepEqual(starts.map((start) => start.app), ["leaf"])
  })
})

test("launch requirements startup reentry after cancel does not erase cancellation", async () => {
  await withFixtureApps({
    "leaf": {},
    "middle": { deps: ["leaf"] },
    "target": { deps: ["middle"] }
  }, { readyAfterStart: false, simulateKernelLifecycle: true }, async ({ resolver, kernel, launchPath, starts, running, ready }) => {
    const targetPath = launchPath("target")
    const middlePath = launchPath("middle")
    const leafPath = launchPath("leaf")
    const owner = resolver.beginLaunchOperation(targetPath, { request: { uri: targetPath } })
    const pending = resolver.ensureForLaunchPath(targetPath, { owner, pollMs: 10 })

    assert.equal(await waitFor(() => starts.some((start) => start.app === "leaf")), true)
    assert.equal(resolver.cancel(targetPath), true)

    ready.add(leafPath)
    kernel.markAppLaunchReady(leafPath)
    const result = await pending
    resolver.endLaunchOperation(owner)

    assert.equal(result.action, "cancelled")
    assert.equal(result.app_id, "target")

    const startupOwner = resolver.beginLaunchOperation(targetPath, {
      request: { uri: targetPath, startup: true }
    })
    const startup = await resolver.ensureForLaunchPath(targetPath, {
      owner: startupOwner,
      request: { uri: targetPath, startup: true },
      pollMs: 10
    })
    resolver.endLaunchOperation(startupOwner)

    assert.equal(startup.action, "cancelled")
    assert.equal(startup.app_id, "target")
    assert.equal(running[leafPath], true)
    assert.equal(running[middlePath], undefined)
    assert.equal(running[targetPath], undefined)
    assert.deepEqual(starts.map((start) => start.app), ["leaf"])
  })
})

test("launch requirements app-page default launch after cancel clears old cancellation", async () => {
  await withFixtureApps({
    "leaf": {},
    "middle": { deps: ["leaf"] },
    "target": { deps: ["middle"] }
  }, { readyDelayMs: 5, simulateKernelLifecycle: true }, async ({ resolver, launchPath, starts }) => {
    const targetPath = launchPath("target")

    assert.equal(resolver.cancel(targetPath, { force: true }), true)
    assert.equal(resolver.cancelled.has("target"), true)

    const result = await resolver.ensureForLaunchPath(targetPath, {
      request: { uri: targetPath },
      pollMs: 5
    })

    assert.equal(result.action, "continue")
    assert.equal(resolver.cancelled.has("target"), false)
    assert.deepEqual(starts.map((start) => start.app), ["leaf", "middle"])
  })
})
