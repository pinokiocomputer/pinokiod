const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Socket = require('../server/socket')
const Util = require('../kernel/util')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createSocket(home) {
  const kernel = {
    homedir: home,
    path: (...parts) => path.resolve(home, ...parts),
    exists: async (targetPath) => {
      try {
        await fs.access(targetPath)
        return true
      } catch (_) {
        return false
      }
    }
  }
  return Object.assign(Object.create(Socket.prototype), {
    parent: { kernel },
    rawLog: {},
    logMeta: {},
    sessions: {}
  })
}

test('plugin source without cwd writes to home-relative logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = path.join(root, 'plugin', 'oc', 'pinokio.js')

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'logs', 'plugin', 'oc', 'pinokio.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('plugin source with cwd=undefined does not create repo-relative undefined logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = `${path.join(root, 'plugin', 'oc', 'pinokio.js')}?cwd=undefined`

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'logs', 'plugin', 'oc', 'pinokio.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('plugin source with app cwd writes app-local dev logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const appRoot = path.join(root, 'api', 'example')
    const key = `${path.join(root, 'plugin', 'oc', 'pinokio.js')}?cwd=${encodeURIComponent(appRoot)}`

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(appRoot, 'logs', 'dev', 'plugin', 'oc', 'pinokio.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('future top-level source with app cwd writes app-local dev logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const appRoot = path.join(root, 'api', 'example')
    const key = `${path.join(root, 'tasks', 'build', 'run.js')}?cwd=${encodeURIComponent(appRoot)}`

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(appRoot, 'logs', 'dev', 'tasks', 'build', 'run.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('global source with non-app cwd writes home-relative logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const workspace = path.join(root, 'workspaces', 'tmp')
    const key = `${path.join(root, 'plugin', 'oc', 'pinokio.js')}?cwd=${encodeURIComponent(workspace)}`

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'logs', 'plugin', 'oc', 'pinokio.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app script source writes app-local api logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = path.join(root, 'api', 'example', 'start.js')

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'api', 'example', 'logs', 'api', 'start.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app script source uses nested pinokio app root when present', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    await fs.mkdir(path.join(root, 'api', 'example', 'pinokio'), { recursive: true })
    const key = path.join(root, 'api', 'example', 'start.js')

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'api', 'example', 'pinokio', 'logs', 'api', 'start.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('future top-level source writes home-relative logs without a special case', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = path.join(root, 'tasks', 'build', 'run.js')

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'logs', 'tasks', 'build', 'run.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('api-like top-level source is not treated as an app script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = path.join(root, 'apiary', 'run.js')

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(root, 'logs', 'apiary', 'run.js')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('event and output logging use the same terminal log resolver', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = path.join(root, 'plugin', 'oc', 'pinokio.js')

    await socket.appendEventLog(key, { source: 'api', method: 'notify' }, 'event')
    socket.sessions[key] = 'session-1'
    await socket.log_buffer(key, 'hello\n', { source: 'api', method: 'shell.run' })

    const dir = await socket.resolveLogDir(key)
    assert.match(await fs.readFile(path.join(dir, 'events'), 'utf8'), /event/)
    assert.match(await fs.readFile(path.join(dir, 'latest'), 'utf8'), /hello/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app log metadata captures the active run before async log path resolution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const appRoot = path.join(root, 'api', 'demo')
    const key = path.join(appRoot, 'install.js')
    const run = {
      session_id: 'session-1',
      appRoot,
      scriptPath: key
    }
    let resolving = false
    let activeRunWasCapturedBeforeResolve = false
    let recorded = null

    socket.parent.kernel.api = {
      logSessions: {
        activeRun: () => {
          activeRunWasCapturedBeforeResolve = !resolving
          return run
        },
        recordLogFile: async (payload) => {
          recorded = payload
        }
      }
    }
    const resolveLogDir = socket.resolveLogDir.bind(socket)
    socket.resolveLogDir = async (...args) => {
      resolving = true
      await delay(5)
      return resolveLogDir(...args)
    }
    socket.sessions[key] = 'session-1'

    await socket.log_buffer(key, 'hello\n', { source: 'api', method: 'shell.run' })

    assert.equal(activeRunWasCapturedBeforeResolve, true)
    assert.equal(recorded.run, run)
    assert.equal(recorded.scriptPath, key)
    assert.equal(recorded.logFile, path.join(appRoot, 'logs', 'api', 'install.js', 'session-1'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('plugin output with invalid cwd writes latest under home-relative logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  try {
    const socket = createSocket(root)
    const key = `${path.join(root, 'plugin', 'oc', 'pinokio.js')}?cwd=undefined`
    socket.sessions[key] = 'session-1'

    await socket.log_buffer(key, 'hello\n', { source: 'api', method: 'shell.run' })

    const latest = await fs.readFile(path.join(root, 'logs', 'plugin', 'oc', 'pinokio.js', 'latest'), 'utf8')
    assert.match(latest, /\[api shell\.run\]/)
    assert.match(latest, /hello/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('absolute sources outside PINOKIO_HOME do not get guessed log paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-external-'))
  try {
    const socket = createSocket(root)

    assert.equal(
      await socket.resolveLogDir(path.join(outside, 'run.js')),
      null
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('legacy shell workspace logs remain workspace-owned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-terminal-log-'))
  const workspace = process.platform === 'win32'
    ? await fs.mkdtemp(path.join(os.tmpdir(), 'pinokioterminalworkspace-'))
    : await fs.mkdtemp('/tmp/pinokioterminalworkspace-')
  try {
    const socket = createSocket(root)
    const key = `shell/${Util.p2u(workspace)}_0`

    assert.equal(
      await socket.resolveLogDir(key),
      path.join(workspace, 'logs', 'shell')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
