const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const HuggingfaceConnect = require('../kernel/connect/providers/huggingface')
const Environment = require('../kernel/environment')

function createKernel(root) {
  return {
    homedir: root,
    platform: process.platform,
    path: (...parts) => path.join(root, ...parts),
    exists: async (...parts) => {
      const target = parts.length === 1 && path.isAbsolute(parts[0]) ? parts[0] : path.join(root, ...parts)
      try {
        await fs.access(target)
        return true
      } catch (_) {
        return false
      }
    }
  }
}

test('system environment does not persist the default Hugging Face token path', async () => {
  const content = await Environment.ENV('system', '/tmp/pinokio', {})
  assert.doesNotMatch(content, /^HF_TOKEN_PATH=/m)
})

test('Hugging Face connect parses managed hf JSON device login events', () => {
  const provider = new HuggingfaceConnect(createKernel('/tmp/pinokio'), {})
  const parsed = provider.parseDeviceLogin(
    '{"event":"device_code","verification_uri":"https://hf.co/oauth/device","user_code":"ABCD-EFGH","verification_uri_complete":"https://hf.co/oauth/device","expires_in":300,"interval":5}\n'
  )

  assert.deepEqual(parsed, {
    verification_uri_complete: 'https://hf.co/oauth/device',
    user_code: 'ABCD-EFGH',
    expires_in: 300,
    interval: 5
  })
})

test('Hugging Face connect parses managed hf agent login instructions', () => {
  const provider = new HuggingfaceConnect(createKernel('/tmp/pinokio'), {})
  const parsed = provider.parseDeviceLogin(
    'Ask the user to open https://hf.co/oauth/device in a browser and enter the code ABCD-EFGH. The code expires in 300 seconds. Waiting for authorization...'
  )

  assert.deepEqual(parsed, {
    verification_uri_complete: 'https://hf.co/oauth/device',
    user_code: 'ABCD-EFGH',
    expires_in: 300
  })
})

test('Hugging Face connect uses shared HF_TOKEN_PATH and ignores ambient HF_TOKEN', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-'))
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'HF_TOKEN_PATH=./custom/hf-token\n')
  const oldToken = process.env.HF_TOKEN
  process.env.HF_TOKEN = 'hf_should_not_win'
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const env = await provider.authEnv()

    assert.equal(env.HF_TOKEN_PATH, path.join(root, 'custom', 'hf-token'))
    assert.equal(env.HF_TOKEN, undefined)
    assert.equal(env.HF_HUB_DISABLE_UPDATE_CHECK, '1')
  } finally {
    if (typeof oldToken === 'undefined') {
      delete process.env.HF_TOKEN
    } else {
      process.env.HF_TOKEN = oldToken
    }
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect supplies the shared token path at runtime when it is not persisted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-default-'))
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'OTHER=value\n')
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const env = await provider.authEnv()

    assert.equal(env.HF_TOKEN_PATH, path.join(root, 'cache', 'HF_AUTH', 'token'))
    await assert.doesNotReject(fs.access(path.join(root, 'cache', 'HF_AUTH')))
    await assert.rejects(fs.access(env.HF_TOKEN_PATH), { code: 'ENOENT' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect repairs an empty directory at the token file path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-repair-'))
  const tokenPath = path.join(root, 'cache', 'HF_AUTH', 'token')
  await fs.mkdir(tokenPath, { recursive: true })
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const env = await provider.authEnv()

    assert.equal(env.HF_TOKEN_PATH, tokenPath)
    await assert.rejects(fs.access(tokenPath), { code: 'ENOENT' })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect preserves and rejects a non-empty token directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-invalid-'))
  const tokenPath = path.join(root, 'cache', 'HF_AUTH', 'token')
  await fs.mkdir(tokenPath, { recursive: true })
  await fs.writeFile(path.join(tokenPath, 'keep.txt'), 'keep')
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})

    await assert.rejects(provider.authEnv(), /Hugging Face token path must be a file/)
    assert.equal(await fs.readFile(path.join(tokenPath, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect cancelLogin only stops a pending login session', async () => {
  const provider = new HuggingfaceConnect(createKernel('/tmp/pinokio'), {})
  let killed = false
  provider.loginSession = {
    status: 'pending',
    error: null,
    child: {
      kill() {
        killed = true
      }
    }
  }

  await provider.cancelLogin()

  assert.equal(killed, true)
  assert.equal(provider.loginSession, null)

  const completeSession = {
    status: 'success',
    child: {
      kill() {
        throw new Error('should not kill completed sessions')
      }
    }
  }
  provider.loginSession = completeSession

  await provider.cancelLogin()

  assert.equal(provider.loginSession, completeSession)
})
