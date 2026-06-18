const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Api = require('../kernel/api')
const Script = require('../kernel/api/script')

test('script.restart stops explicit target and schedules start with explicit params', async () => {
  const script = new Script()
  const scheduled = []
  script.scheduleStart = (req) => {
    scheduled.push(req)
  }
  const stopped = []
  const kernel = {
    memory: { args: {} },
    api: {
      filePath: (uri, cwd) => path.resolve(cwd, uri),
      stop: async (req) => {
        stopped.push(req)
      }
    }
  }
  const events = []

  const result = await script.restart({
    cwd: '/pinokio/api/demo',
    parent: {
      path: '/pinokio/api/demo/main.js',
      id: 'main-session'
    },
    params: {
      uri: 'child.js',
      params: { prompt: 'hello' }
    }
  }, (data, type) => {
    events.push({ data, type })
  }, kernel)

  assert.deepEqual(stopped, [
    { params: { uri: '/pinokio/api/demo/child.js' } }
  ])
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].params.uri, 'child.js')
  assert.deepEqual(scheduled[0].params.params, { prompt: 'hello' })
  assert.deepEqual(result, {
    uri: 'child.js',
    scheduled: true,
    self: false,
    params: { prompt: 'hello' }
  })
  assert.equal(events[0].type, 'restart')
  assert.equal(events[0].data.id, '/pinokio/api/demo/child.js')
})

test('script.restart self restart preserves session id and parent args', async () => {
  const script = new Script()
  const scheduled = []
  script.scheduleStart = (req) => {
    scheduled.push(req)
  }
  const stopped = []
  const kernel = {
    memory: { args: {} },
    api: {
      filePath: (uri, cwd) => path.resolve(cwd, uri),
      stop: async (req) => {
        stopped.push(req)
      }
    }
  }

  const result = await script.restart({
    cwd: '/pinokio/api/demo',
    parent: {
      path: '/pinokio/api/demo/main.js',
      id: 'main-session',
      caller: 'caller-session',
      args: { prompt: 'again' }
    },
    params: {}
  }, () => {}, kernel)

  assert.deepEqual(stopped, [
    { params: { id: 'main-session' } }
  ])
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].id, 'main-session')
  assert.equal(scheduled[0].caller, 'caller-session')
  assert.equal(scheduled[0].params.uri, '/pinokio/api/demo/main.js')
  assert.deepEqual(scheduled[0].params.params, { prompt: 'again' })
  assert.deepEqual(result, {
    uri: '/pinokio/api/demo/main.js',
    scheduled: true,
    self: true,
    params: { prompt: 'again' }
  })
})

test('script.run refreshes git mapping before resolving remote dependency uri', async () => {
  const script = new Script()
  const calls = []
  let initialized = false
  const remoteUri = 'https://github.com/example/dependency.pinokio.git/start.js'
  const resolvedPath = '/pinokio/api/github_com_example_dependency_pinokio_git/start.js'
  const kernel = {
    path: (...parts) => path.join('/pinokio', ...parts),
    bin: {
      sh: async () => {
        throw new Error('should not clone when init maps existing dependency')
      }
    },
    api: {
      userdir: '/pinokio/api',
      running: {},
      init: async () => {
        calls.push('init')
        initialized = true
      },
      filePath: (uri) => {
        calls.push('filePath')
        assert.equal(initialized, true)
        assert.equal(uri, remoteUri)
        return resolvedPath
      },
      resolveGitURI: (uri) => {
        calls.push('resolveGitURI')
        assert.equal(initialized, true)
        assert.equal(uri, remoteUri)
        return resolvedPath
      },
      getGitURI: () => 'https://github.com/example/dependency.pinokio.git',
      process: (request, done) => {
        calls.push('process')
        assert.equal(request.uri, remoteUri)
        done({ input: { ok: true } })
      }
    }
  }

  const result = await script.run({
    params: {
      uri: remoteUri,
      params: { prompt: 'go' }
    }
  }, () => {}, kernel)

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, ['init', 'filePath', 'resolveGitURI', 'init', 'process'])
})

test('api.linkGit keeps previous git mapping until refresh completes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinokio-linkgit-'))
  const userdir = path.join(root, 'api')
  const repo = path.join(userdir, 'demo')
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'config'), [
    '[remote "origin"]',
    '\turl = https://github.com/example/demo.git',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    ''
  ].join('\n'))

  try {
    const api = new Api({
      homedir: root,
      path: (...parts) => path.join(root, ...parts)
    })
    api.userdir = userdir
    api.gitPath = {
      'https://github.com/example/old.git': path.join(userdir, 'old')
    }

    const refresh = api.linkGit()
    assert.deepEqual(api.gitPath, {
      'https://github.com/example/old.git': path.join(userdir, 'old')
    })
    await refresh
    assert.deepEqual(api.gitPath, {
      'https://github.com/example/demo.git': repo
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
