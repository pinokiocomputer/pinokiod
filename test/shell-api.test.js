const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const ShellAPI = require('../kernel/api/shell')
const Shell = require('../kernel/shell')
const Shells = require('../kernel/shells')
const CondaRuntimeGuard = require('../kernel/shell_conda_runtime_guard')

function createKernel () {
  const calls = []
  return {
    calls,
    homedir: '/tmp/pinokio-home',
    shell: {
      start: async (params, options) => {
        calls.push({ method: 'start', guard: params[CondaRuntimeGuard.SHELL_RUN_GUARD] === true, params: structuredClone(params), options: structuredClone(options) })
        return 'shell-id'
      },
      enter: async (params) => {
        calls.push({ method: 'enter', guard: params[CondaRuntimeGuard.SHELL_RUN_GUARD] === true, params: structuredClone(params) })
        return 'entered'
      },
      write: async (params) => {
        calls.push({ method: 'write', guard: params[CondaRuntimeGuard.SHELL_RUN_GUARD] === true, params: structuredClone(params) })
        return 'written'
      },
      run: async (params, options) => {
        calls.push({ method: 'run', guard: params[CondaRuntimeGuard.SHELL_RUN_GUARD] === true, params: structuredClone(params), options: structuredClone(options) })
        return { stdout: 'ok' }
      },
      kill: async (params) => {
        calls.push({ method: 'kill', guard: params[CondaRuntimeGuard.SHELL_RUN_GUARD] === true, params: structuredClone(params) })
      }
    }
  }
}

test('shell.start forwards defaults, client size, parent, and shell options', async () => {
  const api = new ShellAPI()
  const kernel = createKernel()
  const cwd = path.join('/tmp', 'pinokio-shell-api')
  const result = await api.start({
    cwd,
    parent: {
      id: 'parent-request',
      body: { title: 'Parent Title' }
    },
    client: {
      rows: 33,
      cols: 120
    }
  }, () => {}, kernel)

  assert.equal(result, 'shell-id')
  assert.deepEqual(kernel.calls, [{
    method: 'start',
    guard: false,
    params: {
      id: cwd,
      path: cwd,
      rows: 33,
      cols: 120,
      $parent: {
        id: 'parent-request',
        body: { title: 'Parent Title' }
      },
      bluefairy: 'off'
    },
    options: {
      cwd,
      group: 'parent-request',
      title: 'Parent Title'
    }
  }])
})

test('shell.enter, shell.write, and shell.stop target current cwd by default', async () => {
  const api = new ShellAPI()
  const kernel = createKernel()
  const cwd = path.join('/tmp', 'pinokio-shell-api')
  const parent = { path: path.join(cwd, 'script.js') }

  assert.equal(await api.enter({ cwd, parent, params: { message: 'conda install python=3.12 -y' } }, () => {}, kernel), 'entered')
  assert.equal(await api.write({ cwd, params: { message: 'conda update --all' } }, () => {}, kernel), 'written')
  await api.stop({ cwd, params: {} }, () => {}, kernel)

  assert.deepEqual(kernel.calls, [{
    method: 'enter',
    guard: false,
    params: {
      message: 'conda install python=3.12 -y',
      id: cwd,
      $parent: parent
    }
  }, {
    method: 'write',
    guard: false,
    params: {
      message: 'conda update --all',
      id: cwd
    }
  }, {
    method: 'kill',
    guard: false,
    params: {
      id: cwd
    }
  }])
})

test('shell.run applies deterministic defaults and forwards execution options', async () => {
  const api = new ShellAPI()
  const kernel = createKernel()
  const cwd = path.join('/tmp', 'pinokio-shell-api')
  const result = await api.run({
    cwd,
    parent: {
      path: path.join(cwd, 'script.js')
    },
    params: {
      message: 'echo ok'
    }
  }, () => {}, kernel)

  assert.deepEqual(result, { stdout: 'ok' })
  assert.deepEqual(kernel.calls, [{
    method: 'run',
    guard: true,
    params: {
      message: 'echo ok',
      path: cwd,
      $parent: {
        path: path.join(cwd, 'script.js')
      },
      bluefairy: 'off'
    },
    options: {
      cwd,
      group: path.join(cwd, 'script.js')
    }
  }])
})

test('shell.run forwards typed stream events', async () => {
  const api = new ShellAPI()
  const events = []
  const kernel = createKernel()
  kernel.shell.run = async (params, options, ondata) => {
    ondata({ html: 'notice', type: 'warning' }, 'notify')
    return { stdout: 'ok' }
  }

  const result = await api.run({
    cwd: path.join('/tmp', 'pinokio-shell-api'),
    params: {
      message: 'echo ok'
    }
  }, (stream, type) => {
    events.push({ stream, type })
  }, kernel)

  assert.deepEqual(result, { stdout: 'ok' })
  assert.deepEqual(events, [{
    stream: {
      html: 'notice',
      type: 'warning'
    },
    type: 'notify'
  }])
})

test('Shells.launch forwards typed stream events without live-output parsing', async () => {
  const events = []
  const originalStart = Shell.prototype.start
  Shell.prototype.start = async function (_params, ondata) {
    this.id = 'stub-shell'
    await ondata({ html: 'notice', type: 'warning' }, 'notify')
    return ''
  }

  try {
    const root = path.join('/tmp', 'pinokio-shells-api')
    const shells = new Shells({
      homedir: root,
      platform: 'darwin',
      bracketedPasteSupport: { bash: true },
      which: () => null,
      path: (...parts) => path.join(root, ...parts),
      bin: {
        envs: (env = {}) => env
      },
      api: {
        resolvePath: (cwd, target) => path.resolve(cwd, target),
        running: {}
      },
      git: {
        repos: async () => [],
        restoreNewReposForActiveSnapshot: async () => {}
      },
      template: {
        render: (value) => value
      }
    })

    await shells.launch({
      path: path.join(root, 'api', 'demo'),
      message: 'echo ok'
    }, {
      cwd: root
    }, (stream, type) => {
      events.push({ stream, type })
    })

    assert.deepEqual(events, [{
      stream: {
        html: 'notice',
        type: 'warning'
      },
      type: 'notify'
    }])
  } finally {
    Shell.prototype.start = originalStart
  }
})
