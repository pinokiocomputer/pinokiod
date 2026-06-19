const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadWorkerHelpers() {
  const workerPath = path.resolve(__dirname, '..', 'server', 'public', 'privacy_filter_worker.js')
  const code = `${fs.readFileSync(workerPath, 'utf8')}\n;globalThis.__test = { prepareMaskEntities, maskText }`
  const sandbox = {
    URL,
    console,
    performance: { now: () => 0 },
    self: {
      postMessage: () => {},
      addEventListener: () => {}
    }
  }
  vm.runInNewContext(code, sandbox, { filename: workerPath })
  return sandbox.__test
}

test('privacy filter preserves URLs by default and masks URL credentials only', () => {
  const { prepareMaskEntities, maskText } = loadWorkerHelpers()

  const publicText = [
    '+ mlx==0.31.3 (from git+https://github.com/ml-explore/mlx.git)',
    '+ tool==1.0.0 (from https://example.org/packages/tool.tar.gz)',
    '+ sshpkg (from git@gitlab.com:group/project.git)'
  ].join('\n')
  const publicStart = publicText.indexOf('https://github.com')
  assert.equal(
    prepareMaskEntities(publicText, [{
      label: 'private_url',
      start: publicStart,
      end: publicText.indexOf(')', publicStart)
    }]).length,
    0
  )

  const credentialText = 'from https://x-access-token:ghp_secret@github.com/org/private.git'
  const credentialStart = credentialText.indexOf('https://')
  const credentialMasked = maskText(credentialText, prepareMaskEntities(credentialText, [{
    label: 'private_url',
    start: credentialStart,
    end: credentialText.length
  }])).masked
  assert.equal(credentialMasked, 'from https://[url_credential]@github.com/org/private.git')

  const tokenText = 'from https://github.com/org/repo.git?token=secret'
  const tokenStart = tokenText.indexOf('https://')
  const tokenMasked = maskText(tokenText, prepareMaskEntities(tokenText, [{
    label: 'private_url',
    start: tokenStart,
    end: tokenText.length
  }])).masked
  assert.equal(tokenMasked, 'from https://github.com/org/repo.git?token=[url_secret]')

  const privateHostText = 'callback https://customer.example.test/install'
  const privateHostStart = privateHostText.indexOf('https://')
  assert.equal(
    prepareMaskEntities(privateHostText, [{
      label: 'private_url',
      start: privateHostStart,
      end: privateHostText.length
    }]).length,
    0
  )
})
