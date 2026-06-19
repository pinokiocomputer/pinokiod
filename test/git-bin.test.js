const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const GitBin = require('../kernel/bin/git')

function createGitBin(platform, packages) {
  const git = new GitBin()
  git.kernel = {
    platform,
    homedir: '/tmp/pinokio',
    path: (...parts) => path.join('/tmp/pinokio', ...parts),
    bin: {
      installed: {
        conda: new Set(packages),
        conda_versions: { git: '2.51.0' },
      },
    },
  }
  return git
}

test('Git bin installs Git Credential Manager with the Git bundle', () => {
  assert.equal(
    createGitBin('darwin', []).cmd(),
    'git=2.51.0 git-lfs git-credential-manager=2.7.3 gh=2.82.1'
  )
  assert.equal(
    createGitBin('linux', []).cmd(),
    'git=2.51.0 git-lfs git-credential-manager=2.7.3 gh=2.82.1'
  )
  assert.equal(
    createGitBin('win32', []).cmd(),
    'git=2.51.0 git-lfs git-credential-manager=2.7.3 gh=2.82.1 m2-base'
  )
})

test('Git bin readiness requires Git Credential Manager and GitHub CLI', async () => {
  assert.equal(
    await createGitBin('darwin', ['git', 'git-lfs']).installed(),
    false
  )
  assert.equal(
    await createGitBin('darwin', ['git', 'git-lfs', 'git-credential-manager']).installed(),
    false
  )
  assert.equal(
    await createGitBin('darwin', ['git', 'git-lfs', 'git-credential-manager', 'gh']).installed(),
    true
  )
  assert.equal(
    await createGitBin('win32', ['git', 'git-lfs', 'git-credential-manager', 'gh']).installed(),
    false
  )
  assert.equal(
    await createGitBin('win32', ['git', 'git-lfs', 'git-credential-manager', 'gh', 'm2-base']).installed(),
    true
  )
})
