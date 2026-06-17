const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const ini = require('ini')

const KernelGit = require('../kernel/git')

async function withTempHome(fn) {
  const homedir = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-git-defaults-'))
  try {
    await fn(homedir)
  } finally {
    await fs.rm(homedir, { recursive: true, force: true })
  }
}

function createKernel(homedir) {
  return {
    homedir,
    path: (...parts) => path.resolve(homedir, ...parts),
  }
}

function githubCredentialSection(config) {
  return config['credential "https://github'] && config['credential "https://github']['com"']
}

test('Git defaults configure Git Credential Manager for new Pinokio gitconfig files', async () => {
  await withTempHome(async (homedir) => {
    const git = new KernelGit(createKernel(homedir))

    await git.ensureDefaults()

    const config = ini.parse(await fs.readFile(path.join(homedir, 'gitconfig'), 'utf8'))
    assert.equal(config.credential.helper, 'manager')
    assert.equal(config.credential.gitHubAuthModes, 'oauth')
    assert.equal(config.credential.namespace, 'pinokio')
    assert.equal(githubCredentialSection(config).helper, 'manager')
    assert.equal(githubCredentialSection(config).provider, 'github')
  })
})

test('Git defaults migrate the legacy gh GitHub helper to Git Credential Manager', async () => {
  await withTempHome(async (homedir) => {
    await fs.writeFile(path.join(homedir, 'gitconfig'), [
      '[credential "https://github.com"]',
      '  helper = !gh auth git-credential',
      '[user]',
      '  name = custom',
      '  email = custom@example.test',
      '',
    ].join('\n'))
    const git = new KernelGit(createKernel(homedir))

    await git.ensureDefaults()

    const config = ini.parse(await fs.readFile(path.join(homedir, 'gitconfig'), 'utf8'))
    assert.equal(config.credential.helper, 'manager')
    assert.equal(config.credential.gitHubAuthModes, 'oauth')
    assert.equal(config.credential.namespace, 'pinokio')
    assert.equal(githubCredentialSection(config).helper, 'manager')
    assert.equal(githubCredentialSection(config).provider, 'github')
    assert.equal(config.user.name, 'custom')
    assert.equal(config.user.email, 'custom@example.test')
  })
})

test('Git isomorphic auth callback returns GCM credentials for GitHub URLs', async () => {
  const git = new KernelGit(createKernel('/tmp/pinokio'))
  let requestedUrl = ''
  git.getCredentialForUrl = async (url) => {
    requestedUrl = url
    return {
      username: 'octocat',
      password: 'secret-token'
    }
  }

  const auth = await git.getIsomorphicGitAuth('https://github.com/octocat/private.git')

  assert.equal(requestedUrl, 'https://github.com/octocat/private.git')
  assert.deepEqual(auth, {
    username: 'octocat',
    password: 'secret-token'
  })
})

test('Git isomorphic auth callback stays anonymous when GCM has no credential', async () => {
  const git = new KernelGit(createKernel('/tmp/pinokio'))
  git.getCredentialForUrl = async () => null

  const auth = await git.getIsomorphicGitAuth('https://github.com/octocat/public.git')

  assert.equal(auth, undefined)
})
