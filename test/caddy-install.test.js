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
