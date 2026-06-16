const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const ShellAPI = require('../kernel/api/shell')

function createKernel () {
  const calls = []
  return {
    calls,
    homedir: '/tmp/pinokio-home',
    shell: {
      start: async (params, options) => {
        calls.push({ method: 'start', params: structuredClone(params), options: structuredClone(options) })
        return 'shell-id'
      },
      enter: async (params) => {
        calls.push({ method: 'enter', params: structuredClone(params) })
        return 'entered'
      },
      write: async (params) => {
        calls.push({ method: 'write', params: structuredClone(params) })
        return 'written'
      },
      run: async (params, options) => {
        calls.push({ method: 'run', params: structuredClone(params), options: structuredClone(options) })
        return { stdout: 'ok' }
      },
      kill: async (params) => {
        calls.push({ method: 'kill', params: structuredClone(params) })
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

  assert.equal(await api.enter({ cwd, parent, params: { message: 'echo hi' } }, () => {}, kernel), 'entered')
  assert.equal(await api.write({ cwd, params: { message: 'typed' } }, () => {}, kernel), 'written')
  await api.stop({ cwd, params: {} }, () => {}, kernel)

  assert.deepEqual(kernel.calls, [{
    method: 'enter',
    params: {
      message: 'echo hi',
      id: cwd,
      $parent: parent
    }
  }, {
    method: 'write',
    params: {
      message: 'typed',
      id: cwd
    }
  }, {
    method: 'kill',
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
