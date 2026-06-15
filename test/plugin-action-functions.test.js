const assert = require("node:assert/strict")
const test = require("node:test")

const Api = require("../kernel/api")

function createKernel() {
  return {
    info: { platform: "test" },
    vars: { extra: "value" },
    memory: {
      global: {},
      local: {},
      key: {},
    },
    script: {},
    template: {
      update: () => {},
    },
    port: async () => 42001,
    path: (...parts) => ["/pinokio"].concat(parts).join("/"),
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
