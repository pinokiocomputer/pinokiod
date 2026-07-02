const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Api = require('../kernel/api')
const AppLogSessions = require('../kernel/app_log_sessions')
const Server = require('../server')

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function makeClock() {
  let value = Date.parse('2026-07-02T22:10:15.123Z')
  return () => {
    const current = new Date(value).toISOString()
    value += 1000
    return current
  }
}

async function withSessionFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-sessions-'))
  const homedir = path.join(root, 'home')
  const apiRoot = path.join(homedir, 'api')
  const appRoot = path.join(apiRoot, 'demo')
  await fs.mkdir(appRoot, { recursive: true })

  const kernel = {
    homedir,
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    exists: async (filepath) => {
      try {
        await fs.stat(filepath)
        return true
      } catch (_) {
        return false
      }
    },
    api: {}
  }
  const sessions = new AppLogSessions({
    kernel,
    now: makeClock(),
    randomHex: () => 'abc123'
  })

  try {
    await fn({
      root,
      homedir,
      kernel,
      apiRoot,
      appRoot,
      sessions,
      scriptPath: (script) => path.join(appRoot, script),
      readIndex: () => readJson(path.join(appRoot, 'logs', 'sessions', 'index.json')),
      readManifest: (id) => readJson(path.join(appRoot, 'logs', 'sessions', `${id}.json`))
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn()
      if (result) return result
    } catch (e) {
      lastError = e
    }
    await delay(25)
  }
  if (lastError) throw lastError
  throw new Error('condition was not met before timeout')
}

async function withProcessFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-process-'))
  const homedir = path.join(root, 'home')
  const apiRoot = path.join(homedir, 'api')
  const appRoot = path.join(apiRoot, 'demo')
  await fs.mkdir(appRoot, { recursive: true })
  await fs.writeFile(path.join(appRoot, 'install.js'), [
    'module.exports = {',
    '  run: [{ method: "script.start", params: { uri: "torch.js" } }]',
    '}',
    ''
  ].join('\n'))
  await fs.writeFile(path.join(appRoot, 'torch.js'), [
    'module.exports = {',
    '  run: [{ method: "script.return", params: { ok: "torch" } }]',
    '}',
    ''
  ].join('\n'))
  await fs.writeFile(path.join(appRoot, 'start.js'), [
    'module.exports = {',
    '  run: [{ method: "script.return", params: { ok: "start" } }]',
    '}',
    ''
  ].join('\n'))
  await fs.writeFile(path.join(appRoot, 'pinokio.js'), [
    'module.exports = {',
    '  menu: [{ text: "Start", href: "start.js", default: true }]',
    '}',
    ''
  ].join('\n'))

  const kernel = {
    homedir,
    info: {},
    vars: {},
    envs: {},
    script: {},
    memory: { global: {}, local: {}, key: {}, rpc: {}, args: {}, input: {} },
    shell: { init: async () => {}, kill: () => {} },
    template: {
      update: () => {},
      render: (value) => value,
      istemplate: () => false,
      flatten: (value) => value
    },
    path: (name, ...chunks) => path.resolve(homedir, name, ...chunks),
    exists: async (filepath) => {
      try {
        await fs.stat(filepath)
        return true
      } catch (_) {
        return false
      }
    },
    update_sysinfo: async () => {},
    port: async () => 45123,
    dns: async () => {},
    resumeprocess: () => {},
    stopCloudflare: async () => {},
    isScriptReady: () => false
  }
  const api = new Api(kernel)
  kernel.api = api
  kernel.loader = api.loader
  api.userdir = apiRoot
  api.init = async () => {
    api.userdir = apiRoot
  }

  try {
    await fn({
      api,
      appRoot,
      scriptPath: (script) => path.join(appRoot, script),
      readIndex: () => readJson(path.join(appRoot, 'logs', 'sessions', 'index.json')),
      readManifest: (id) => readJson(path.join(appRoot, 'logs', 'sessions', `${id}.json`))
    })
  } finally {
    await Promise.all(Object.values(api.queues).map((queue) => queue.drained())).catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('app log sessions attach child launches from the current backend execution context', async () => {
  await withSessionFixture(async ({ appRoot, sessions, scriptPath, readIndex, readManifest }) => {
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    const independent = await sessions.startRun({ path: scriptPath('start.js') })
    assert.notEqual(independent.session_id, install.session_id)

    const torch = await sessions.withRunContext(install, () => {
      return sessions.startRun({ path: scriptPath('torch.js') })
    })
    assert.equal(torch.session_id, install.session_id)

    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', '111'), 'install log\n')
    await sessions.recordLogFile({
      scriptPath: scriptPath('install.js'),
      logFile: path.join(appRoot, 'logs', 'api', 'install.js', '111')
    })

    const manifest = await readManifest(install.session_id)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['install.js', 'torch.js'])
    assert.deepEqual(manifest.runs[0].logs, [{ path: 'logs/api/install.js/111' }])

    const index = await readIndex()
    assert.equal(index.latest_session, independent.session_id)
    assert.deepEqual(index.sessions.map((session) => session.id), [independent.session_id, install.session_id])
  })
})

test('app log sessions keep same opaque session ids isolated by app root', async () => {
  await withSessionFixture(async ({ apiRoot, appRoot, kernel, scriptPath, readManifest }) => {
    const otherRoot = path.join(apiRoot, 'other')
    await fs.mkdir(otherRoot, { recursive: true })
    const sessions = new AppLogSessions({
      kernel,
      now: () => '2026-07-02T22:10:15.123Z',
      randomHex: () => 'sameid'
    })

    const first = await sessions.startRun({ path: scriptPath('start.js') })
    const second = await sessions.startRun({ path: path.join(otherRoot, 'start.js') })
    assert.equal(first.session_id, second.session_id)

    await sessions.finishRun(first, { internal_completion: false })
    await sessions.finishRun(second, { internal_completion: false })

    const firstManifest = await readManifest(first.session_id)
    const secondManifest = await readJson(path.join(otherRoot, 'logs', 'sessions', `${second.session_id}.json`))
    assert.deepEqual(firstManifest.runs.map((run) => run.script), ['start.js'])
    assert.deepEqual(secondManifest.runs.map((run) => run.script), ['start.js'])
  })
})

test('app log sessions use the existing nested pinokio app root for storage', async () => {
  await withSessionFixture(async ({ appRoot, sessions, scriptPath }) => {
    await fs.mkdir(path.join(appRoot, 'pinokio'), { recursive: true })

    const run = await sessions.startRun({ path: scriptPath('start.js') })
    const manifest = await readJson(path.join(appRoot, 'pinokio', 'logs', 'sessions', `${run.session_id}.json`))

    assert.equal(run.appRoot, path.join(appRoot, 'pinokio'))
    assert.equal(manifest.runs[0].script, 'start.js')
  })
})

test('app log sessions join local scripts reserved by the same backend routine even when runs overlap', async () => {
  await withSessionFixture(async ({ sessions, scriptPath, readManifest }) => {
    await sessions.reserveLaunch(scriptPath('install.js'))
    const install = await sessions.startRun({ path: scriptPath('install.js') })

    const startReservation = await sessions.reserveLaunch(scriptPath('start.js'))
    assert.equal(startReservation.session_id, install.session_id)

    const start = await sessions.startRun({ path: scriptPath('start.js') })
    assert.equal(start.session_id, install.session_id)

    const manifest = await readManifest(install.session_id)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['install.js', 'start.js'])
  })
})

test('app log sessions do not join a direct same-app launch just because another run is active', async () => {
  await withSessionFixture(async ({ sessions, scriptPath }) => {
    await sessions.reserveLaunch(scriptPath('install.js'))
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    const directStart = await sessions.startRun({ path: scriptPath('start.js') })

    assert.notEqual(directStart.session_id, install.session_id)
  })
})

test('app log sessions clear exact reservations on mismatched same-app launch', async () => {
  await withSessionFixture(async ({ sessions, scriptPath }) => {
    await sessions.reserveLaunch(scriptPath('start.js'))
    const update = await sessions.startRun({ path: scriptPath('update.js') })

    const start = await sessions.startRun({ path: scriptPath('start.js') })
    assert.notEqual(start.session_id, update.session_id)
  })
})

test('app log sessions clear the routine when a reserved app has a mismatched direct launch', async () => {
  await withSessionFixture(async ({ sessions, scriptPath }) => {
    await sessions.reserveLaunch(scriptPath('install.js'))
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    const reservedStart = await sessions.reserveLaunch(scriptPath('start.js'))
    assert.equal(reservedStart.session_id, install.session_id)

    const update = await sessions.startRun({ path: scriptPath('update.js') })
    assert.notEqual(update.session_id, install.session_id)

    const nextStartReservation = await sessions.reserveLaunch(scriptPath('start.js'))
    assert.equal(nextStartReservation.session_id, '')
    const nextStart = await sessions.startRun({ path: scriptPath('start.js') })
    assert.notEqual(nextStart.session_id, install.session_id)
  })
})

test('app log sessions clear unconsumed routine reservations after manual stop', async () => {
  await withSessionFixture(async ({ sessions, scriptPath }) => {
    await sessions.reserveLaunch(scriptPath('install.js'))
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    const startReservation = await sessions.reserveLaunch(scriptPath('start.js'))
    assert.equal(startReservation.session_id, install.session_id)

    await sessions.finishRun(install, { internal_completion: false })

    const start = await sessions.startRun({ path: scriptPath('start.js') })
    assert.notEqual(start.session_id, install.session_id)
  })
})

test('server-rendered default menu reservations join an existing app routine', async () => {
  await withSessionFixture(async ({ kernel, sessions, scriptPath, readManifest }) => {
    kernel.api.logSessions = sessions
    const context = {
      kernel,
      defaultAppLogLaunchPath: Server.prototype.defaultAppLogLaunchPath
    }

    await sessions.reserveLaunch(scriptPath('install.js'))
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    await sessions.finishRun(install, { internal_completion: true })

    await Server.prototype.reserveDefaultAppLogSession.call(context, [
      { text: 'Start', href: '/api/demo/start.js', default: true }
    ], true)
    const start = await sessions.startRun({ path: scriptPath('start.js') })

    assert.equal(start.session_id, install.session_id)
    const manifest = await readManifest(install.session_id)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['install.js', 'start.js'])
  })
})

test('server-rendered initial default can create the app routine joined by the next default', async () => {
  await withSessionFixture(async ({ kernel, sessions, scriptPath, readManifest }) => {
    kernel.api.logSessions = sessions
    const context = {
      kernel,
      defaultAppLogLaunchPath: Server.prototype.defaultAppLogLaunchPath
    }

    await Server.prototype.reserveDefaultAppLogSession.call(context, [
      { text: 'Install', href: '/api/demo/install.js', default: true }
    ], true)
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    await sessions.finishRun(install, { internal_completion: true })

    await Server.prototype.reserveDefaultAppLogSession.call(context, [
      { text: 'Start', href: '/api/demo/start.js', default: true }
    ], true, { existingRoutineOnly: true })
    const start = await sessions.startRun({ path: scriptPath('start.js') })

    assert.equal(start.session_id, install.session_id)
    const manifest = await readManifest(install.session_id)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['install.js', 'start.js'])
  })
})

test('server-rendered default menu reservations do not join direct script sessions', async () => {
  await withSessionFixture(async ({ kernel, sessions, scriptPath }) => {
    kernel.api.logSessions = sessions
    const context = {
      kernel,
      defaultAppLogLaunchPath: Server.prototype.defaultAppLogLaunchPath
    }

    const install = await sessions.startRun({ path: scriptPath('install.js') })
    await sessions.finishRun(install, { internal_completion: true })

    await Server.prototype.reserveDefaultAppLogSession.call(context, [
      { text: 'Start', href: '/api/demo/start.js', default: true }
    ], true)
    const start = await sessions.startRun({ path: scriptPath('start.js') })

    assert.notEqual(start.session_id, install.session_id)
  })
})

test('server-rendered default menu reservations do not create empty sessions by themselves', async () => {
  await withSessionFixture(async ({ appRoot, kernel, sessions }) => {
    kernel.api.logSessions = sessions
    const context = {
      kernel,
      defaultAppLogLaunchPath: Server.prototype.defaultAppLogLaunchPath
    }

    await Server.prototype.reserveDefaultAppLogSession.call(context, [
      { text: 'Start', href: '/api/demo/start.js', default: true }
    ], true)

    await assert.rejects(
      fs.readFile(path.join(appRoot, 'logs', 'sessions', 'index.json'), 'utf8'),
      { code: 'ENOENT' }
    )
  })
})

test('app log sessions can record a log file using a run captured before completion cleanup', async () => {
  await withSessionFixture(async ({ appRoot, sessions, scriptPath, readManifest }) => {
    const run = await sessions.startRun({ path: scriptPath('install.js') })
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', '111'), 'install log\n')
    await sessions.finishRun(run, { internal_completion: true })

    await sessions.recordLogFile({
      scriptPath: scriptPath('install.js'),
      logFile: path.join(appRoot, 'logs', 'api', 'install.js', '111'),
      run
    })

    const manifest = await readManifest(run.session_id)
    assert.deepEqual(manifest.runs[0].logs, [{ path: 'logs/api/install.js/111' }])
  })
})

test('app log sessions do not infer a future default script after completion', async () => {
  await withSessionFixture(async ({ sessions, scriptPath }) => {
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    await sessions.finishRun(install, { internal_completion: true })

    const start = await sessions.startRun({ path: scriptPath('start.js') })
    assert.notEqual(start.session_id, install.session_id)
  })
})

test('app log sessions ignore in-memory routine reservations after restart', async () => {
  await withSessionFixture(async ({ appRoot, kernel, sessions, scriptPath, readManifest }) => {
    await sessions.reserveLaunch(scriptPath('start.js'))
    await assert.rejects(
      fs.readFile(path.join(appRoot, 'logs', 'sessions', 'index.json'), 'utf8'),
      { code: 'ENOENT' }
    )

    const restarted = new AppLogSessions({
      kernel,
      now: makeClock(),
      randomHex: () => 'def456'
    })
    const start = await restarted.startRun({ path: scriptPath('start.js') })
    const manifest = await readManifest(start.session_id)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['start.js'])
  })
})

test('app log sessions keep latest_session on the newest created session after late log append', async () => {
  await withSessionFixture(async ({ appRoot, sessions, scriptPath, readIndex }) => {
    const install = await sessions.startRun({ path: scriptPath('install.js') })
    await sessions.finishRun(install, { internal_completion: true })
    const start = await sessions.startRun({ path: scriptPath('start.js') })

    let index = await readIndex()
    assert.equal(index.latest_session, start.session_id)

    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', '111'), 'install log\n')
    await sessions.recordLogFile({
      scriptPath: scriptPath('install.js'),
      logFile: path.join(appRoot, 'logs', 'api', 'install.js', '111'),
      run: install
    })

    index = await readIndex()
    assert.equal(index.latest_session, start.session_id)
    assert.deepEqual(index.sessions.map((session) => session.id), [start.session_id, install.session_id])
  })
})

test('app log sessions serialize same-app index updates so concurrent sessions are retained', async () => {
  await withSessionFixture(async ({ sessions, scriptPath, readIndex }) => {
    const [first, second] = await Promise.all([
      sessions.startRun({ path: scriptPath('install.js') }),
      sessions.startRun({ path: scriptPath('start.js') })
    ])

    const index = await readIndex()
    assert.deepEqual(new Set(index.sessions.map((session) => session.id)), new Set([first.session_id, second.session_id]))
  })
})

test('api.process captures child and routine-reserved default launches in one app log session', async () => {
  await withProcessFixture(async ({ api, scriptPath, readIndex, readManifest }) => {
    await api.logSessions.reserveLaunch(scriptPath('install.js'))
    await api.process({ uri: 'demo/install.js' })
    const installSessionId = await waitFor(async () => {
      const index = await readIndex()
      return index.latest_session || null
    })
    const reservedStart = await api.logSessions.reserveLaunch(scriptPath('start.js'))
    assert.equal(reservedStart.session_id, installSessionId)

    await waitFor(async () => {
      const manifest = await readManifest(installSessionId)
      return manifest.runs.map((run) => run.script).join(',') === 'install.js,torch.js'
        ? manifest
        : null
    })

    await api.process({ uri: 'demo/start.js' })

    const manifest = await waitFor(async () => {
      const current = await readManifest(installSessionId)
      return current.runs.map((run) => run.script).join(',') === 'install.js,torch.js,start.js'
        ? current
        : null
    })

    const index = await readIndex()
    assert.equal(index.latest_session, installSessionId)
    assert.deepEqual(manifest.runs.map((run) => run.script), ['install.js', 'torch.js', 'start.js'])
  })
})

test('api queue cancellation finishes the app log run', async () => {
  await withProcessFixture(async ({ api, scriptPath }) => {
    const request = { path: scriptPath('install.js') }
    let finishedRequest = null
    api.step = async () => ({ cancelled: true, request })
    api.logSessions = {
      finishRun: async (value) => {
        finishedRequest = value
      }
    }
    api.running[request.path] = true

    api.queue(request, { method: 'cancel-test' }, null, 0, 1, path.dirname(request.path), null)
    await waitFor(() => finishedRequest)

    assert.equal(finishedRequest, request)
  })
})
