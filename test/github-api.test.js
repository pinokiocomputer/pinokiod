const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const Github = require('../kernel/api/github')

test('GitHub API parses credentials without exposing token handling to shell commands', () => {
  const credential = Github.parseCredentialOutput([
    'protocol=https',
    'host=github.com',
    'username=octocat',
    'password=secret-token',
    '',
  ].join('\n'))

  assert.equal(credential.username, 'octocat')
  assert.equal(credential.password, 'secret-token')
})

test('GitHub API parses common GitHub remote URL formats', () => {
  assert.deepEqual(
    Github.parseGithubRemote('https://github.com/octocat/hello-world.git'),
    { owner: 'octocat', repo: 'hello-world', fullName: 'octocat/hello-world' }
  )
  assert.deepEqual(
    Github.parseGithubRemote('git@github.com:octocat/hello-world.git'),
    { owner: 'octocat', repo: 'hello-world', fullName: 'octocat/hello-world' }
  )
  assert.deepEqual(
    Github.parseGithubRemote('ssh://git@github.com/octocat/hello-world.git'),
    { owner: 'octocat', repo: 'hello-world', fullName: 'octocat/hello-world' }
  )
  assert.equal(Github.parseGithubRemote('https://example.com/octocat/hello-world.git'), null)
})

test('GitHub API parses repository names for user and organization creation', () => {
  assert.deepEqual(
    Github.parseRepoName('', '/tmp/hello-world'),
    { owner: null, repo: 'hello-world' }
  )
  assert.deepEqual(
    Github.parseRepoName('octo-org/hello-world.git', '/tmp/ignored'),
    { owner: 'octo-org', repo: 'hello-world' }
  )
  assert.throws(() => Github.parseRepoName('bad owner/repo', '/tmp/ignored'), /Invalid GitHub owner/)
  assert.throws(() => Github.parseRepoName('owner/bad repo', '/tmp/ignored'), /Invalid GitHub repository name/)
})

test('GitHub API builds create repository requests for user and organization targets', () => {
  assert.deepEqual(
    Github.buildCreateRepoRequest({
      owner: null,
      repo: 'hello-world',
      authenticatedUser: { login: 'octocat' },
      visibility: 'private'
    }),
    { path: '/user/repos', body: { name: 'hello-world', private: true } }
  )
  assert.deepEqual(
    Github.buildCreateRepoRequest({
      owner: 'octo-org',
      repo: 'hello-world',
      authenticatedUser: { login: 'octocat' },
      visibility: 'public'
    }),
    { path: '/orgs/octo-org/repos', body: { name: 'hello-world', private: false } }
  )
  assert.deepEqual(
    Github.buildCreateRepoRequest({
      owner: 'octo-org',
      repo: 'hello-world',
      authenticatedUser: { login: 'octocat' },
      visibility: 'internal'
    }),
    { path: '/orgs/octo-org/repos', body: { name: 'hello-world', visibility: 'internal' } }
  )
  assert.throws(
    () => Github.buildCreateRepoRequest({
      owner: null,
      repo: 'hello-world',
      authenticatedUser: { login: 'octocat' },
      visibility: 'internal'
    }),
    /Internal repositories require an organization owner/
  )
})

test('GitHub create and fork scripts no longer invoke gh repo commands', async () => {
  const root = path.resolve(__dirname, '..')
  const createScript = await fs.readFile(path.join(root, 'kernel/scripts/git/create'), 'utf8')
  const forkScript = await fs.readFile(path.join(root, 'kernel/scripts/git/fork'), 'utf8')

  assert.match(createScript, /"method": "github\.create"/)
  assert.match(forkScript, /"method": "github\.fork"/)
  assert.doesNotMatch(createScript, /gh repo/)
  assert.doesNotMatch(forkScript, /gh repo/)
})

test('GitHub create refuses to push when origin points somewhere else', async () => {
  const api = new Github()
  let requests = 0
  const commands = []

  api.getCredential = async () => ({ password: 'secret-token' })
  api.getAuthenticatedUser = async () => ({ login: 'octocat' })
  api.remoteUrl = async () => 'https://github.com/octocat/old-repo.git'
  api.githubRequest = async () => {
    requests += 1
    return {}
  }
  api.runGit = async (args) => {
    commands.push(args)
  }

  await assert.rejects(
    () => api.create({
      params: {
        cwd: '/tmp/repo',
        name: 'octocat/new-repo',
        visibility: 'public'
      }
    }),
    /origin already points at https:\/\/github\.com\/octocat\/old-repo\.git/
  )

  assert.equal(requests, 0)
  assert.deepEqual(commands, [])
})

test('GitHub fork does not rename or repoint origin', async () => {
  const api = new Github()
  const commands = []

  api.remoteUrl = async (_cwd, name) => {
    if (name === 'origin') return 'https://github.com/source-org/project.git'
    return ''
  }
  api.runGit = async (args) => {
    commands.push(args)
  }

  await api.configureForkRemote({
    cwd: '/tmp/repo',
    kernel: {},
    source: { owner: 'source-org', repo: 'project', fullName: 'source-org/project' },
    forkRepo: {
      owner: { login: 'octocat' },
      name: 'project',
      full_name: 'octocat/project',
      clone_url: 'https://github.com/octocat/project.git'
    }
  })

  assert.deepEqual(commands, [
    ['remote', 'add', 'octocat', 'https://github.com/octocat/project.git']
  ])
})
