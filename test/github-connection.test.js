const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Server = require('../server')

test('GitHub connection ignores legacy gh hosts when no GCM account exists', async () => {
  const connection = await Server.prototype.get_github_connection.call({
    get_legacy_github_hosts: async () => [
      'github.com:',
      '  git_protocol: https',
      '  users:',
      '    cocktailpeanut:',
      '  user: cocktailpeanut',
      '',
    ].join('\n'),
    github_gcm: async () => '',
  })

  assert.equal(connection.connected, false)
  assert.equal(connection.provider, null)
  assert.equal(connection.display, '')
  assert.match(connection.legacyHosts, /cocktailpeanut/)
})

test('GitHub connection reports GCM accounts as connected', async () => {
  const connection = await Server.prototype.get_github_connection.call({
    get_legacy_github_hosts: async () => '',
    github_gcm: async () => 'octocat\n',
  })

  assert.equal(connection.connected, true)
  assert.equal(connection.provider, 'gcm')
  assert.equal(connection.display, 'github.com: octocat')
})

test('GitHub connection forwards a bounded timeout to GCM status checks', async () => {
  let receivedOptions
  await Server.prototype.get_github_connection.call({
    get_legacy_github_hosts: async () => '',
    github_gcm: async (args, options) => {
      receivedOptions = options
      return ''
    },
  }, { timeout: 2500 })

  assert.deepEqual(receivedOptions, { timeout: 2500 })
})

test('GitHub connection coalesces only concurrent GCM checks', async () => {
  let calls = 0
  const context = {
    get_legacy_github_hosts: async () => '',
    github_gcm: async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'octocat\n'
    },
  }

  const [first, second] = await Promise.all([
    Server.prototype.get_github_connection.call(context),
    Server.prototype.get_github_connection.call(context),
  ])

  assert.equal(calls, 1)
  assert.equal(first.connected, true)
  assert.deepEqual(second, first)

  await Server.prototype.get_github_connection.call(context)
  assert.equal(calls, 2)
})

test('GitHub login only emits completion marker after credential verification', () => {
  const { doneMarker, message } = Server.prototype.github_login_params.call({
    kernel: { platform: 'darwin' }
  })

  assert.equal(doneMarker, 'PINOKIO_GITHUB_LOGIN_DONE')
  assert.match(message, /git credential-manager github login --device --force && printf 'protocol=https\\nhost=github\.com\\n\\n' \| GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git credential fill >\/dev\/null && \(GCM_DONE=INOKIO_GITHUB_LOGIN_DONE; printf 'P%s\\n' "\$GCM_DONE"\)/)
  assert.doesNotMatch(message, /git credential-manager github login --device --force\s*;/)
  assert.doesNotMatch(message, /--web/)
  assert.doesNotMatch(message, /PINOKIO_GITHUB_LOGIN_DONE/)
})

test('GitHub login uses success-only credential verification on Windows', () => {
  const { message } = Server.prototype.github_login_params.call({
    kernel: { platform: 'win32' }
  })

  assert.match(message, /git credential-manager github login --device --force && powershell\.exe -NoProfile -Command "\$env:GIT_TERMINAL_PROMPT='0'; \$env:GCM_INTERACTIVE='never'; @\('protocol=https','host=github\.com',''\) \| git credential fill > \$null; exit \$LASTEXITCODE" && echo P\^INOKIO_GITHUB_LOGIN_DONE/)
  assert.doesNotMatch(message, /--web/)
  assert.doesNotMatch(message, /PINOKIO_GITHUB_LOGIN_DONE/)
})

test('GitHub logout clears legacy gh auth even when GCM accounts exist', async () => {
  let clearedLegacyAuth = false
  const context = {
    kernel: { platform: 'darwin' },
    github_logout_command: Server.prototype.github_logout_command,
    clear_legacy_github_auth: async () => {
      clearedLegacyAuth = true
    }
  }

  const result = await Server.prototype.github_logout_params.call(context, {
    accounts: ['octocat'],
    legacyHosts: 'github.com:\n  user: octocat\n'
  })

  assert.equal(clearedLegacyAuth, true)
  assert.equal(result.hadLegacyAuth, true)
  assert.equal(result.message, 'git credential-manager github logout octocat')
})

test('GitHub legacy auth cleanup removes old gh hosts file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-gh-auth-'))
  const hostsFile = path.join(dir, 'config/gh/hosts.yml')
  await fs.mkdir(path.dirname(hostsFile), { recursive: true })
  await fs.writeFile(hostsFile, 'github.com:\n  user: octocat\n')

  await Server.prototype.clear_legacy_github_auth.call({
    kernel: {
      path: (relativePath) => path.join(dir, relativePath)
    }
  })

  await assert.rejects(() => fs.stat(hostsFile), { code: 'ENOENT' })
  await fs.rm(dir, { recursive: true, force: true })
})
