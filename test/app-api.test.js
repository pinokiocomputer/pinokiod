const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const AppAPI = require('../kernel/api/app')

function createKernel(root, launcher = {}) {
  const commands = []
  return {
    platform: 'test',
    appLauncher: launcher,
    bin: {
      install2: async () => {
        commands.push({ type: 'install2' })
      },
      sh: async (params) => {
        commands.push({ type: 'sh', params })
      }
    },
    api: {
      userdir: path.join(root, 'api'),
      init: async () => {
        commands.push({ type: 'api.init' })
      }
    },
    path: (...parts) => path.join(root, ...parts),
    commands
  }
}

test('app APIs forward search/info/refresh/launch requests to the launcher service', async () => {
  const calls = []
  const launcher = {
    search: async (params) => {
      calls.push({ method: 'search', params })
      return ['search-result']
    },
    info: async (params) => {
      calls.push({ method: 'info', params })
      return { id: params.id }
    },
    refresh: async (params) => {
      calls.push({ method: 'refresh', params })
      return { refreshed: true }
    },
    launch: async (params) => {
      calls.push({ method: 'launch', params })
      return { launched: true }
    }
  }
  const api = new AppAPI()
  const kernel = createKernel('/tmp/pinokio-app-api', launcher)

  assert.deepEqual(await api.search({ params: { query: 'Code', limit: 3, refresh: true } }, () => {}, kernel), ['search-result'])
  assert.deepEqual(await api.info({ params: { id: 'com.example.Code', refresh: true } }, () => {}, kernel), { id: 'com.example.Code' })
  assert.deepEqual(await api.refresh({ params: { force: true } }, () => {}, kernel), { refreshed: true })
  assert.deepEqual(await api.launch({ params: { id: 'com.example.Code', args: ['--new-window'] } }, () => {}, kernel), { launched: true })

  assert.deepEqual(calls, [
    { method: 'search', params: { query: 'Code', limit: 3, refresh: true } },
    { method: 'info', params: { id: 'com.example.Code', refresh: true } },
    { method: 'refresh', params: { force: true } },
    { method: 'launch', params: { id: 'com.example.Code', app: undefined, args: ['--new-window'], refresh: undefined, install: undefined } }
  ])
})

test('app.launch delegates missing app install fallback without driving native UI', async () => {
  const api = new AppAPI()
  let fallbackArgs
  api.handleInstallFlow = async (args) => {
    fallbackArgs = args
    return { installed: true }
  }
  const launcher = {
    launch: async () => {
      const error = new Error('not found')
      error.code = 'APP_NOT_FOUND'
      throw error
    }
  }
  const kernel = createKernel('/tmp/pinokio-app-api', launcher)
  const req = {
    params: {
      app: 'Native Tool',
      install: 'https://example.test/tool.dmg'
    }
  }

  assert.deepEqual(await api.launch(req, () => {}, kernel), { installed: true })
  assert.equal(fallbackArgs.req, req)
  assert.equal(fallbackArgs.kernel, kernel)
  assert.equal(fallbackArgs.launcher, launcher)
  assert.equal(fallbackArgs.params, req.params)
})

test('app.download validates names and builds git clone commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-api-'))
  try {
    await fs.mkdir(path.join(root, 'api'), { recursive: true })
    const api = new AppAPI()
    const kernel = createKernel(root, {
      refresh: async (params) => {
        kernel.commands.push({ type: 'launcher.refresh', params })
      }
    })

    await assert.rejects(
      api.download({ params: {} }, () => {}, kernel),
      /app\.download requires params\.uri/
    )

    assert.deepEqual(
      await api.download({
        params: {
          uri: 'https://github.com/example/tool.git',
          name: '../bad'
        }
      }, () => {}, kernel),
      {
        ok: false,
        code: 'INVALID_NAME',
        error: 'invalid name',
        name: '../bad',
        uri: 'https://github.com/example/tool.git'
      }
    )

    await fs.mkdir(path.join(root, 'api', 'existing'), { recursive: true })
    assert.deepEqual(
      await api.download({
        params: {
          uri: 'https://github.com/example/existing.git',
          name: 'existing'
        }
      }, () => {}, kernel),
      {
        ok: false,
        code: 'APP_EXISTS',
        error: 'already exists',
        name: 'existing',
        path: path.join(root, 'api', 'existing'),
        uri: 'https://github.com/example/existing.git'
      }
    )

    const result = await api.download({
      params: {
        uri: 'https://github.com/example/fresh.git',
        name: 'fresh',
        branch: 'dev'
      }
    }, () => {}, kernel)

    assert.deepEqual(result, {
      ok: true,
      name: 'fresh',
      path: path.join(root, 'api', 'fresh'),
      uri: 'https://github.com/example/fresh.git',
      branch: 'dev'
    })
    assert.equal(kernel.commands[0].type, 'install2')
    assert.equal(kernel.commands[1].type, 'sh')
    assert.equal(kernel.commands[1].params.path, path.join(root, 'api'))
    assert.equal(kernel.commands[1].params.message, 'git clone --branch "dev" "https://github.com/example/fresh.git" "fresh"')
    assert.deepEqual(kernel.commands.slice(2), [
      { type: 'api.init' },
      { type: 'launcher.refresh', params: { force: true } }
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('waitForAppPresence handles present, missing, and install-detected apps', async () => {
  const api = new AppAPI()
  const modalEvents = []
  api.htmlModal = {
    open: async (req) => {
      modalEvents.push({ action: 'open', params: req.params })
    },
    update: async (req) => {
      modalEvents.push({ action: 'update', params: req.params })
    },
    close: async (req) => {
      modalEvents.push({ action: 'close', params: req.params })
    }
  }

  const byId = await api.waitForAppPresence({
    params: { id: 'com.example.Present' }
  }, () => {}, createKernel('/tmp/pinokio-app-api', {
    info: async () => ({ id: 'com.example.Present', name: 'Present' }),
    findMatch: async () => null
  }))
  assert.deepEqual(byId, { id: 'com.example.Present', name: 'Present' })

  const byName = await api.waitForAppPresence({
    params: { app: 'Present by Name' }
  }, () => {}, createKernel('/tmp/pinokio-app-api', {
    findMatch: async () => ({ entry: { id: 'present-by-name', name: 'Present by Name' } })
  }))
  assert.deepEqual(byName, { id: 'present-by-name', name: 'Present by Name' })

  await assert.rejects(
    api.waitForAppPresence({
      params: { app: 'Missing' }
    }, () => {}, createKernel('/tmp/pinokio-app-api', {
      findMatch: async () => null
    })),
    (error) => error && error.code === 'APP_NOT_FOUND'
  )

  let matchAttempts = 0
  const installed = await api.waitForAppPresence({
    parent: { path: '/pinokio/api/demo/start.js' },
    params: {
      app: 'Later',
      install: 'https://example.test/later.dmg',
      installPollIntervalMs: 1,
      installTimeoutMs: 50
    }
  }, () => {}, createKernel('/tmp/pinokio-app-api', {
    refresh: async () => {},
    findMatch: async () => {
      matchAttempts += 1
      if (matchAttempts >= 2) {
        return { entry: { id: 'later', name: 'Later' } }
      }
      return null
    }
  }))

  assert.deepEqual(installed, { id: 'later', name: 'Later' })
  assert.ok(modalEvents.some((event) => event.action === 'open'))
  assert.ok(modalEvents.some((event) => event.action === 'update'))
  assert.ok(modalEvents.some((event) => event.action === 'close'))
})
