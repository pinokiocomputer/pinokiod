const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const HF = require('../kernel/api/hf')
const HuggingfaceConnect = require('../kernel/connect/providers/huggingface')
const Shell = require('../kernel/shell')
const Shells = require('../kernel/shells')

function createKernel(root) {
  return {
    homedir: root,
    platform: process.platform,
    path: (...parts) => path.join(root, ...parts),
    exists: async (target) => fs.access(target).then(() => true, () => false)
  }
}

test('hf.login does not accept an invalid saved token', async () => {
  const context = {
    parentPath: '/pinokio/api/test/login.js',
    cwd: '/pinokio/api/test',
    env: { HF_TOKEN_PATH: './token' }
  }
  const kernel = {
    connect: {
      keys: async () => ({ access_token: 'invalid' }),
      async connected(provider, options, receivedContext) {
        assert.equal(provider, 'huggingface')
        assert.deepEqual(options, { timeout: 5000 })
        assert.deepEqual(receivedContext, context)
        return false
      },
      login: async () => ({ status: 'error', error: 'login started' })
    }
  }

  const result = await new HF().login({
    parent: { path: context.parentPath },
    cwd: context.cwd,
    params: { env: context.env }
  }, () => {}, kernel)

  assert.deepEqual(result, { status: 'error', error: 'login started' })
})

test('whoami updates only the managed shared token path', async () => {
  const root = path.join(os.tmpdir(), 'pinokio-hf-state')
  const tokenPath = path.join(root, 'cache', 'HF_AUTH', 'token')
  const anonymousPath = path.join(root, 'cache', 'HF_AUTH', 'anonymous')
  const kernel = createKernel(root)
  kernel.envs = { HF_TOKEN_PATH: anonymousPath }
  const provider = new HuggingfaceConnect(kernel, {})
  const customContext = { env: { HF_TOKEN_PATH: '/tmp/custom-hf-token' } }

  provider.runHf = async (_args, _options, receivedContext) => {
    assert.equal(receivedContext, customContext)
    return { env: { HF_TOKEN_PATH: customContext.env.HF_TOKEN_PATH } }
  }
  assert.equal(await provider.connected({}, customContext), true)
  assert.equal(kernel.envs.HF_TOKEN_PATH, anonymousPath)

  provider.runHf = async () => ({ env: { HF_TOKEN_PATH: tokenPath } })
  assert.equal(await provider.connected(), true)
  assert.equal(kernel.envs.HF_TOKEN_PATH, tokenPath)

  provider.runHf = async () => {
    const error = new Error('invalid token')
    error.tokenPath = tokenPath
    throw error
  }
  assert.equal(await provider.connected(), false)
  assert.equal(kernel.envs.HF_TOKEN_PATH, anonymousPath)
})

test('provider login ignores only Pinokio\'s inherited anonymous path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-context-'))
  const appDir = path.join(root, 'api', 'demo')
  const scriptPath = path.join(appDir, 'start.js')
  await fs.mkdir(appDir, { recursive: true })
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), '')
  await fs.writeFile(path.join(appDir, 'ENVIRONMENT'), '')
  await fs.writeFile(scriptPath, '')
  try {
    const kernel = createKernel(root)
    kernel.envs = { HF_TOKEN_PATH: path.join(root, 'cache', 'HF_AUTH', 'anonymous') }
    const provider = new HuggingfaceConnect(kernel, {})
    const context = { parentPath: scriptPath, cwd: appDir }

    assert.equal((await provider.authEnv(context)).HF_TOKEN_PATH, provider.defaultTokenPath())
    assert.equal(
      (await provider.authEnv({ ...context, env: { HF_TOKEN_PATH: './custom-token' } })).HF_TOKEN_PATH,
      path.join(appDir, 'custom-token')
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('invalid managed tokens are replaced once without overriding apps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-hf-shells-'))
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), '')
  let checks = 0
  const kernel = createKernel(root)
  kernel.bin = { envs: () => ({}) }
  kernel.bracketedPasteSupport = {}
  kernel.which = () => null
  kernel.connect = {
    connected: async () => {
      checks++
      return false
    }
  }
  const shells = new Shells(kernel)
  shells.ensureBracketedPasteSupport = async () => {}
  try {
    await shells.init()
    const anonymousPath = path.join(root, 'cache', 'HF_AUTH', 'anonymous')
    assert.equal(kernel.envs.HF_TOKEN_PATH, anonymousPath)
    await shells.init()
    assert.equal(checks, 1)

    const inheritedShell = new Shell(kernel)
    await inheritedShell.init_env({ env: {} })
    assert.equal(inheritedShell.env.HF_TOKEN_PATH, anonymousPath)

    const appShell = new Shell(kernel)
    await appShell.init_env({ env: { HF_TOKEN_PATH: '/tmp/app-hf-token' } })
    assert.equal(appShell.env.HF_TOKEN_PATH, '/tmp/app-hf-token')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
