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

test('Hugging Face connect preserves configured HF paths and ignores ambient HF_TOKEN', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-'))
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'HF_HOME=./custom/hf-home\nHF_TOKEN_PATH=./custom/hf-token\n')
  const oldToken = process.env.HF_TOKEN
  process.env.HF_TOKEN = 'hf_should_not_win'
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const env = await provider.authEnv()

    assert.equal(env.HF_HOME, path.join(root, 'custom', 'hf-home'))
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

test('Hugging Face connect isolates its managed Python from external packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-python-env-'))
  const childEnvPath = path.join(root, 'child-env.json')
  await fs.writeFile(
    path.join(root, 'ENVIRONMENT'),
    'PYTHONNOUSERSITE=0\nPYTHONPATH=system-packages\n'
  )
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    provider.hfPath = () => process.execPath
    const { env } = await provider.runHf([
      '-e',
      'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ pythonNoUserSite: process.env.PYTHONNOUSERSITE, pythonPath: process.env.PYTHONPATH || null }))',
      childEnvPath
    ], {}, {
      env: {
        PythonNoUserSite: '0',
        PythonPath: 'command-packages'
      }
    })
    const childEnv = JSON.parse(await fs.readFile(childEnvPath, 'utf8'))

    assert.equal(env.PYTHONNOUSERSITE, '1')
    assert.equal(env.PYTHONPATH, undefined)
    assert.equal(env.PythonNoUserSite, undefined)
    assert.equal(env.PythonPath, undefined)
    assert.deepEqual(childEnv, {
      pythonNoUserSite: '1',
      pythonPath: null
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect uses the app token path for its managed CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-app-env-'))
  const appDir = path.join(root, 'api', 'demo')
  const scriptPath = path.join(appDir, 'start.js')
  const tokenPath = path.join(appDir, 'auth', 'token')
  await fs.mkdir(appDir, { recursive: true })
  await fs.writeFile(scriptPath, '')
  await fs.writeFile(
    path.join(appDir, 'ENVIRONMENT'),
    'HF_HOME=./cache/huggingface\n'
  )
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const context = {
      parentPath: scriptPath,
      cwd: appDir,
    }
    const sharedEnv = await provider.authEnv(context)
    assert.equal(sharedEnv.HF_HOME, path.join(appDir, 'cache', 'huggingface'))
    assert.equal(sharedEnv.HF_TOKEN_PATH, path.join(root, 'cache', 'HF_AUTH', 'token'))

    await fs.writeFile(
      path.join(appDir, 'ENVIRONMENT'),
      'HF_HOME=./cache/huggingface\nHF_TOKEN_PATH=./auth/token\n'
    )
    provider.hfPath = () => process.execPath
    const { env } = await provider.runHf([
      '-e',
      'require("node:fs").writeFileSync(process.env.HF_TOKEN_PATH, "hf_app_token")'
    ], {}, context)

    assert.equal(env.HF_HOME, path.join(appDir, 'cache', 'huggingface'))
    assert.equal(env.HF_TOKEN_PATH, tokenPath)
    assert.equal(await fs.readFile(tokenPath, 'utf8'), 'hf_app_token')
    await assert.rejects(
      fs.access(path.join(root, 'cache', 'HF_AUTH', 'token')),
      { code: 'ENOENT' }
    )

    const commandTokenPath = path.join(appDir, 'command-auth', 'token')
    const commandContext = {
      parentPath: scriptPath,
      cwd: appDir,
      env: { HF_TOKEN_PATH: './command-auth/token' }
    }
    const commandResult = await provider.runHf([
      '-e',
      'require("node:fs").writeFileSync(process.env.HF_TOKEN_PATH, "hf_command_token")'
    ], {}, commandContext)

    assert.equal(commandResult.env.HF_TOKEN_PATH, commandTokenPath)
    assert.equal(await fs.readFile(commandTokenPath, 'utf8'), 'hf_command_token')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect verifies status with bounded whoami', async () => {
  const provider = new HuggingfaceConnect(createKernel('/tmp/pinokio'), {})
  let receivedArgs
  let receivedOptions
  provider.runHf = async (args, options) => {
    receivedArgs = args
    receivedOptions = options
  }

  const connected = await provider.connected({ timeout: 2500 })

  assert.deepEqual(receivedArgs, ['auth', 'whoami', '--format', 'quiet'])
  assert.deepEqual(receivedOptions, { timeout: 2500 })
  assert.equal(connected, true)

  provider.runHf = async () => {
    throw new Error('not logged in')
  }
  assert.equal(await provider.connected({ timeout: 2500 }), false)
})

test('Hugging Face connect supplies the shared token path when none is configured', async () => {
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

test('Hugging Face connect leaves existing token and refresh files unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-existing-login-'))
  const authDir = path.join(root, 'cache', 'HF_AUTH')
  await fs.mkdir(authDir, { recursive: true })
  await fs.writeFile(path.join(authDir, 'token'), 'hf_existing_token')
  await fs.writeFile(path.join(authDir, 'stored_tokens'), 'existing stored tokens')
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    const env = await provider.authEnv()

    assert.equal(env.HF_TOKEN_PATH, path.join(authDir, 'token'))
    assert.equal(await fs.readFile(path.join(authDir, 'token'), 'utf8'), 'hf_existing_token')
    assert.equal(await fs.readFile(path.join(authDir, 'stored_tokens'), 'utf8'), 'existing stored tokens')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Hugging Face connect removes a non-empty token directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-connect-invalid-dir-'))
  const authDir = path.join(root, 'cache', 'HF_AUTH')
  const tokenPath = path.join(authDir, 'token')
  await fs.mkdir(tokenPath, { recursive: true })
  await fs.writeFile(path.join(tokenPath, 'leftover.txt'), 'leftover')
  await fs.writeFile(path.join(authDir, 'stored_tokens'), 'refresh state')
  try {
    const provider = new HuggingfaceConnect(createKernel(root), {})
    await Promise.all([provider.authEnv(), provider.authEnv()])
    provider.hfPath = () => process.execPath
    const { env } = await provider.runHf([
      '-e',
      'require("node:fs").writeFileSync(process.env.HF_TOKEN_PATH, "hf_replacement_token")'
    ])

    assert.equal(env.HF_TOKEN_PATH, tokenPath)
    assert.equal(await fs.readFile(tokenPath, 'utf8'), 'hf_replacement_token')
    assert.equal(await fs.readFile(path.join(authDir, 'stored_tokens'), 'utf8'), 'refresh state')
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
