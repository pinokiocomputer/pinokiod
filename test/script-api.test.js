const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

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
