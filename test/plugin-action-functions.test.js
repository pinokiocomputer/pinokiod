const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const Api = require("../kernel/api")

function createKernel() {
  return {
    info: { platform: "test" },
    vars: { extra: "value" },
    envs: {},
    memory: {
      global: {},
      local: {},
      key: {},
      rpc: {},
      args: {},
      input: {},
    },
    script: {},
    template: {
      update: () => {},
      render: (value) => value,
      istemplate: () => false,
      flatten: (value) => value,
    },
    port: async () => 42001,
    path: (...parts) => ["/pinokio"].concat(parts).join("/"),
    update_sysinfo: async () => {},
  }
}

async function withStepApi(fn) {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-plugin-action-"))
  try {
    const appDir = path.join(homedir, "api", "demo")
    await fs.mkdir(appDir, { recursive: true })
    await fs.writeFile(path.join(homedir, "ENVIRONMENT"), "PINOKIO_TEST_ENV=1\n")
    await fs.writeFile(path.join(appDir, "ENVIRONMENT"), "PINOKIO_APP_TEST_ENV=1\n")

    const kernel = createKernel()
    kernel.homedir = homedir
    kernel.path = (...parts) => path.join(homedir, ...parts)
    kernel.exists = async (targetPath) => {
      return fs.access(targetPath).then(() => true).catch(() => false)
    }

    const api = new Api(kernel)
    api.init = async () => {}
    await fn({ api, appDir })
  } finally {
    await fs.rm(homedir, { recursive: true, force: true })
  }
}

test("resolveActionSteps preserves array actions without changing launcher syntax", async () => {
  const api = new Api(createKernel())
  const request = { id: "array-request", path: "/pinokio/api/demo/start.js" }
  const steps = [{ method: "shell.run", params: { message: "echo ok" } }]
  const script = { run: steps }

  const resolved = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/api/demo",
    actionKey: "run",
    input: {},
    args: {},
  })

  assert.strictEqual(resolved, steps)
  assert.deepEqual(api.resolved_actions["array-request"], {
    actionKey: "run",
    steps,
  })
})

test("resolveActionSteps executes function actions once per request and clears cached steps", async () => {
  const api = new Api(createKernel())
  const request = { id: "function-request", path: "/pinokio/api/demo/plugin/pinokio.js" }
  let calls = 0
  const script = {
    run: async function (kernel, info, context) {
      calls += 1
      assert.strictEqual(this, script)
      assert.equal(kernel.info.platform, "test")
      assert.equal(info.platform, "test")
      assert.equal(context.extra, "context")
      return [{
        method: "shell.run",
        params: { message: `echo ${context.input.prompt}` },
      }]
    },
  }

  api.actionContext = async ({ input, args, actionKey }) => ({
    input,
    args,
    action: actionKey,
    extra: "context",
  })

  const first = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/api/demo/plugin",
    actionKey: "run",
    input: { prompt: "first" },
    args: { prompt: "first" },
  })
  const second = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/api/demo/plugin",
    actionKey: "run",
    input: { prompt: "second" },
    args: { prompt: "second" },
  })

  assert.equal(calls, 1)
  assert.strictEqual(second, first)
  assert.equal(second[0].params.message, "echo first")

  api.clearResolvedAction(request)
  const third = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/api/demo/plugin",
    actionKey: "run",
    input: { prompt: "third" },
    args: { prompt: "third" },
  })

  assert.equal(calls, 2)
  assert.equal(third[0].params.message, "echo third")
})

test("resolveActionSteps prompts plugin-managed setup before first run", async () => {
  const api = new Api(createKernel())
  const request = { id: "plugin-run-install", path: "/pinokio/plugin/demo/pinokio.js" }
  let runCalls = 0
  let installCalls = 0
  let installedCalls = 0
  const installSteps = [{ method: "shell.run", params: { message: "install" } }]
  const runSteps = [{ method: "shell.run", params: { message: "run" } }]
  const script = {
    installed: async () => {
      installedCalls += 1
      return false
    },
    install: async () => {
      installCalls += 1
      return installSteps
    },
    run: async () => {
      runCalls += 1
      return runSteps
    },
  }

  api.actionContext = async ({ input, args, actionKey }) => ({
    input,
    args,
    action: actionKey,
  })

  const steps = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/plugin/demo",
    actionKey: "run",
    input: { prompt: "first" },
    args: { prompt: "first" },
  })

  assert.equal(installedCalls, 1)
  assert.equal(installCalls, 0)
  assert.equal(runCalls, 0)
  assert.deepEqual(steps, [{
    method: "notify",
    params: {
      html: "This plugin is not installed. Open the plugin page and click Install.",
      href: "/plugin?path=%2Fplugin%2Fdemo%2Fpinokio.js&next=install",
      target: "_parent",
      type: "warning",
    }
  }])

  api.clearResolvedAction(request)
  const restarted = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/plugin/demo",
    actionKey: "run",
    input: { prompt: "first" },
    args: { prompt: "first" },
  })

  assert.equal(installedCalls, 2)
  assert.equal(installCalls, 0)
  assert.equal(runCalls, 0)
  assert.deepEqual(restarted, steps)
})

test("resolveActionSteps links system plugin setup prompts to plugin detail", async () => {
  const kernel = createKernel()
  kernel.systemPath = (...parts) => ["/pinokio-system"].concat(parts).join("/")
  const api = new Api(kernel)
  const request = { id: "system-plugin-run-install", path: "/pinokio-system/plugin/demo/pinokio.js" }
  const script = {
    title: "Demo System Plugin",
    installed: async () => false,
    install: async () => [{ method: "shell.run", params: { message: "install" } }],
    run: async () => [{ method: "shell.run", params: { message: "run" } }],
  }

  api.actionContext = async ({ input, args, actionKey }) => ({
    input,
    args,
    action: actionKey,
  })

  const steps = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio-system/plugin/demo",
    actionKey: "run",
    input: {},
    args: {},
  })

  assert.equal(steps[0].method, "notify")
  assert.equal(steps[0].params.html, "Demo System Plugin is not installed. Open the plugin page and click Install.")
  assert.equal(steps[0].params.href, "/plugin?path=%2Fpinokio%2Frun%2Fplugin%2Fdemo%2Fpinokio.js&next=install")
  assert.equal(steps[0].params.target, "_parent")
})

test("resolveActionSteps runs plugin action directly when installed check passes", async () => {
  const api = new Api(createKernel())
  const request = { id: "plugin-run-installed", path: "/pinokio/plugin/demo/pinokio.js" }
  let installCalls = 0
  let runCalls = 0
  const runSteps = [{ method: "shell.run", params: { message: "run" } }]
  const script = {
    installed: async () => true,
    install: async () => {
      installCalls += 1
      return [{ method: "shell.run", params: { message: "install" } }]
    },
    run: async () => {
      runCalls += 1
      return runSteps
    },
  }

  api.actionContext = async ({ input, args, actionKey }) => ({
    input,
    args,
    action: actionKey,
  })

  const steps = await api.resolveActionSteps({
    request,
    script,
    scriptDir: "/pinokio/plugin/demo",
    actionKey: "run",
    input: {},
    args: {},
  })

  assert.equal(installCalls, 0)
  assert.equal(runCalls, 1)
  assert.strictEqual(steps, runSteps)
})

test("step clears resolved function actions when an RPC returns an error", async () => {
  await withStepApi(async ({ api, appDir }) => {
    const request = {
      id: "function-error",
      path: path.join(appDir, "plugin", "pinokio.js"),
    }
    const steps = [{ method: "test.fail" }]
    api.running[request.id] = true
    api.resolved_actions[request.id] = { actionKey: "run", steps }
    api.resolveScript = async () => ({
      cwd: appDir,
      script: { run: steps }
    })
    api.resolveMethod = async () => ({
      method: async () => {},
      dirname: appDir
    })
    api.run = async () => ({
      error: "boom",
      response: "failed"
    })

    await api.step(request, steps[0], {}, 0, 1, {})

    assert.equal(api.resolved_actions[request.id], undefined)
  })
})

test("step clears resolved function actions when an RPC throws", async () => {
  await withStepApi(async ({ api, appDir }) => {
    const request = {
      id: "function-throw",
      path: path.join(appDir, "plugin", "pinokio.js"),
    }
    const steps = [{ method: "test.throw" }]
    api.running[request.id] = true
    api.resolved_actions[request.id] = { actionKey: "run", steps }
    api.resolveScript = async () => ({
      cwd: appDir,
      script: { run: steps }
    })
    api.resolveMethod = async () => ({
      method: async () => {},
      dirname: appDir
    })
    api.run = async () => {
      throw new Error("boom")
    }

    const originalLog = console.log
    console.log = () => {}
    try {
      await api.step(request, steps[0], {}, 0, 1, {})
    } finally {
      console.log = originalLog
    }

    assert.equal(api.resolved_actions[request.id], undefined)
  })
})
