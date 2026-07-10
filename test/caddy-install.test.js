const assert = require('node:assert/strict')
const test = require('node:test')

const Caddy = require('../kernel/bin/caddy')
const LocalhostHomeRouter = require('../kernel/router/localhost_home_router')

test('localhost router disables caddy automatic trust install', () => {
  const router = {
    kernel: {
      peer: { host: 'pinokio.localhost' },
      path: (...segments) => segments.join('/')
    },
    default_host: '127.0.0.1',
    default_port: 42000,
    default_match: 'pinokio.localhost',
    add() {}
  }

  new LocalhostHomeRouter(router).handle()

  assert.equal(
    router.config.apps.pki.certificate_authorities.local.install_trust,
    false
  )
})

test('caddy admin wait returns false on timeout', async () => {
  const caddy = new Caddy()
  let checks = 0
  caddy.running = async () => {
    checks += 1
    return false
  }

  const ready = await caddy.waitForAdmin(5, 1)

  assert.equal(ready, false)
  assert.ok(checks >= 1)
})

test('caddy admin wait returns true when admin responds', async () => {
  const caddy = new Caddy()
  let checks = 0
  caddy.running = async () => {
    checks += 1
    return checks === 2
  }

  const ready = await caddy.waitForAdmin(100, 1)

  assert.equal(ready, true)
  assert.equal(checks, 2)
})

test('caddy start uses the normal shell execution contract', async () => {
  const caddy = new Caddy()
  let running = false
  let launch
  caddy.kernel = {
    homedir: '/tmp/pinokio',
    peer: {
      https_active: true,
      announce() {}
    },
    processes: {},
    exec(params, ondata) {
      launch = params
      running = true
      ondata({ raw: '', cleaned: 'admin endpoint started' })
    }
  }
  caddy.running = async () => running
  caddy.installed = async () => true

  await caddy.start()

  assert.equal(launch.message, 'caddy run --watch')
  assert.deepEqual(Object.keys(launch).sort(), ['message', 'path'])
})

test('caddy stop uses the native admin API only when Caddy is running', async () => {
  const caddy = new Caddy()
  let running = true
  caddy.running = async () => running
  const originalPost = require('axios').post
  const calls = []
  require('axios').post = async (...args) => {
    calls.push(args)
    running = false
  }

  try {
    assert.equal(await caddy.stop(), true)
    assert.equal(await caddy.stop(), false)
  } finally {
    require('axios').post = originalPost
  }

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'http://127.0.0.1:2019/stop')
})

test('caddy stop refuses to continue when native shutdown is not confirmed', async () => {
  const caddy = new Caddy()
  caddy.running = async () => true
  caddy.waitForStopped = async () => false
  const originalPost = require('axios').post
  require('axios').post = async () => {}

  try {
    await assert.rejects(
      caddy.stop(),
      /could not stop Caddy/
    )
  } finally {
    require('axios').post = originalPost
  }
})
