const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Api = require('../kernel/api')
const Git = require('../kernel/git')
const Shell = require('../kernel/shell')
const Shells = require('../kernel/shells')
const WorkspaceStatusManager = require('../kernel/workspace_status')

function run(cmd, args, cwd, options = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codex Test',
      GIT_AUTHOR_EMAIL: 'codex-test@example.com',
      GIT_COMMITTER_NAME: 'Codex Test',
      GIT_COMMITTER_EMAIL: 'codex-test@example.com',
      GIT_TERMINAL_PROMPT: '0',
      ...options.env,
    },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function git(args, cwd) {
  return run('git', args, cwd)
}

function fileUrl(targetPath) {
  return `file://${targetPath}`
}

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeLowercaseTmpRoot(name) {
  const root = path.join('/tmp', `${name}-${process.pid}-${Date.now()}`)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  return root
}

function createKernel(root) {
  const kernel = {
    homedir: root,
    platform: 'test',
    arch: 'test',
    gpu_model: 'test-gpu',
    ram: 1,
    vram: 0,
    envs: { ...process.env },
    path: (...parts) => path.join(root, ...parts),
    api: {
      exists: async (targetPath) => {
        try {
          await fsp.access(targetPath)
          return true
        } catch (_) {
          return false
        }
      },
    },
    exec: async (params) => {
      const messages = Array.isArray(params.message) ? params.message : [params.message]
      for (const message of messages) {
        run('/bin/sh', ['-lc', message], params.path || root)
      }
    },
  }
  kernel.git = new Git(kernel)
  return kernel
}

function initRepo(repoPath, { remote, file = 'tracked.txt', content = 'baseline\n', message = 'baseline' } = {}) {
  fs.mkdirSync(repoPath, { recursive: true })
  git(['init'], repoPath)
  git(['config', 'user.name', 'Codex Test'], repoPath)
  git(['config', 'user.email', 'codex-test@example.com'], repoPath)
  fs.writeFileSync(path.join(repoPath, file), content)
  git(['add', '.'], repoPath)
  git(['commit', '-m', message], repoPath)
  git(['branch', '-M', 'main'], repoPath)
  if (remote) {
    git(['remote', 'add', 'origin', remote], repoPath)
  }
  return git(['rev-parse', 'HEAD'], repoPath)
}

function pushWorkRepoToBare({ root, bareName, workName, file, firstContent, firstMessage, secondContent, secondMessage }) {
  const bare = path.join(root, 'remotes', bareName)
  const work = path.join(root, 'work', workName)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  fs.mkdirSync(path.dirname(work), { recursive: true })
  git(['init', '--bare', bare], root)
  fs.mkdirSync(work, { recursive: true })
  git(['init'], work)
  git(['config', 'user.name', 'Codex Test'], work)
  git(['config', 'user.email', 'codex-test@example.com'], work)
  fs.writeFileSync(path.join(work, file), firstContent)
  git(['add', '.'], work)
  git(['commit', '-m', firstMessage], work)
  git(['branch', '-M', 'main'], work)
  git(['remote', 'add', 'origin', fileUrl(bare)], work)
  git(['push', '-u', 'origin', 'main'], work)
  const firstHead = git(['rev-parse', 'HEAD'], work)

  let secondHead = firstHead
  if (secondContent != null) {
    fs.writeFileSync(path.join(work, file), secondContent)
    git(['commit', '-am', secondMessage || 'second'], work)
    git(['push'], work)
    secondHead = git(['rev-parse', 'HEAD'], work)
  }

  return {
    bare,
    work,
    remote: fileUrl(bare),
    firstHead,
    secondHead,
  }
}

function readCheckpointPayload(gitApi, saved) {
  const payloadPath = gitApi.checkpointFilePath(saved.hash)
  assert.ok(payloadPath, 'checkpoint hash should map to a payload path')
  return JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
}

test('recursive git repo scan preserves /info/api?git compatibility for top-level, nested, and missing remotes', async () => {
  const root = makeTempRoot('pinokio-startup-info-api-')
  try {
    const apiRoot = path.join(root, 'api')
    const workspace = path.join(apiRoot, 'fixture')
    const nested = path.join(workspace, 'nested')
    fs.mkdirSync(apiRoot, { recursive: true })

    const topRemote = 'https://example.com/pinokio-startup-fixture.git'
    const nestedRemote = 'https://example.com/pinokio-startup-fixture-nested.git'
    initRepo(workspace, { remote: topRemote, content: 'top\n', message: 'top baseline' })
    initRepo(nested, { remote: nestedRemote, file: 'nested.txt', content: 'nested\n', message: 'nested baseline' })

    const kernel = createKernel(root)
    await kernel.git.repos(apiRoot)

    const topHit = kernel.git.find(topRemote)
    assert.ok(topHit)
    assert.equal(topHit.path, workspace)
    const topRepos = (await kernel.git.repos(topHit.path)).filter((repo) => repo.main)
    assert.equal(topRepos.length, 1)
    assert.equal(topRepos[0].url, topRemote)

    const nestedHit = kernel.git.find(nestedRemote)
    assert.ok(nestedHit)
    assert.equal(nestedHit.path, nested)
    const nestedRepos = (await kernel.git.repos(nestedHit.path)).filter((repo) => repo.main)
    assert.equal(nestedRepos.length, 1)
    assert.equal(nestedRepos[0].url, nestedRemote)

    assert.equal(kernel.git.find('https://example.com/missing.git'), undefined)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('workspace repo scans clear stale git index locks without a startup API-root scan', async () => {
  const root = makeTempRoot('pinokio-startup-stale-lock-')
  try {
    const apiRoot = path.join(root, 'api')
    const workspace = path.join(apiRoot, 'fixture')
    const nested = path.join(workspace, 'nested')
    fs.mkdirSync(apiRoot, { recursive: true })
    initRepo(workspace, { remote: 'https://example.com/stale-lock-root.git', content: 'top\n' })
    initRepo(nested, { remote: 'https://example.com/stale-lock-nested.git', file: 'nested.txt', content: 'nested\n' })

    const topLock = path.join(workspace, '.git', 'index.lock')
    const nestedLock = path.join(nested, '.git', 'index.lock')
    fs.writeFileSync(topLock, '')
    fs.writeFileSync(nestedLock, '')

    const kernel = createKernel(root)
    await kernel.git.repos(workspace)

    assert.equal(fs.existsSync(topLock), false)
    assert.equal(fs.existsSync(nestedLock), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('findRepoRootForPath resolves top-level and nested repo roots without prefilled git dirs', async () => {
  const root = makeTempRoot('pinokio-startup-diff-root-')
  try {
    const apiRoot = path.join(root, 'api')
    const workspace = path.join(apiRoot, 'fixture')
    const nested = path.join(workspace, 'nested')
    fs.mkdirSync(apiRoot, { recursive: true })
    initRepo(workspace, { remote: 'https://example.com/root.git', content: 'top\n' })
    initRepo(nested, { remote: 'https://example.com/nested.git', file: 'nested.txt', content: 'nested\n' })

    const kernel = createKernel(root)
    assert.equal(kernel.git.dirs.size, 0)

    assert.equal(
      await kernel.git.findRepoRootForPath(path.join(workspace, 'tracked.txt')),
      workspace
    )
    assert.equal(
      await kernel.git.findRepoRootForPath(path.join(nested, 'nested.txt')),
      nested
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('workspace status cache returns cached data, marks dirty, then refreshes the selected workspace', async () => {
  const manager = new WorkspaceStatusManager({
    enableWatchers: true,
    fallbackIntervalMs: 60000,
  })
  let computeCount = 0
  const computeStatus = async () => ({
    totalChanges: computeCount++,
    repos: [{ name: 'fixture', changeCount: computeCount }],
  })

  const first = await manager.getStatus('fixture', computeStatus)
  assert.equal(first.totalChanges, 0)

  const cached = await manager.getStatus('fixture', computeStatus)
  assert.equal(cached, first)
  assert.equal(computeCount, 1)

  manager.markDirty('fixture')
  const staleWhileRefreshing = await manager.getStatus('fixture', computeStatus)
  assert.equal(staleWhileRefreshing, first)

  const entry = manager.cache.get('fixture')
  if (entry && entry.inflight) {
    await entry.inflight
  }

  const refreshed = await manager.getStatus('fixture', computeStatus)
  assert.equal(refreshed.totalChanges, 1)
  assert.equal(computeCount, 2)
})

test('appendWorkspaceSnapshot writes the same checkpoint shape for main and nested repos', async () => {
  const root = makeTempRoot('pinokio-startup-checkpoint-save-')
  try {
    const apiRoot = path.join(root, 'api')
    const workspaceName = 'fixture'
    const workspace = path.join(apiRoot, workspaceName)
    const nested = path.join(workspace, 'nested')
    fs.mkdirSync(apiRoot, { recursive: true })

    const topRemote = 'https://example.com/checkpoint-fixture.git'
    const nestedRemote = 'https://example.com/checkpoint-fixture-nested.git'
    const topHead = initRepo(workspace, { remote: topRemote, content: 'top\n', message: 'top baseline' })
    const nestedHead = initRepo(nested, { remote: nestedRemote, file: 'nested.txt', content: 'nested\n', message: 'nested baseline' })

    const kernel = createKernel(root)
    await kernel.git.loadCheckpoints()
    const repos = await kernel.git.repos(workspace)
    const saved = await kernel.git.appendWorkspaceSnapshot(workspaceName, repos)
    assert.ok(saved)

    const payload = readCheckpointPayload(kernel.git, saved)
    assert.deepEqual(payload, {
      version: 1,
      root: 'https://example.com/checkpoint-fixture',
      repos: [
        {
          path: '.',
          repo: 'https://example.com/checkpoint-fixture',
          commit: topHead,
        },
        {
          path: 'nested',
          repo: 'https://example.com/checkpoint-fixture-nested',
          commit: nestedHead,
        },
      ],
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('restoreNewReposForActiveSnapshot pins nested repos created after the workspace before-set', async () => {
  const root = makeLowercaseTmpRoot('pinokio-startup-restore')
  try {
    const home = path.join(root, 'home')
    const apiRoot = path.join(home, 'api')
    fs.mkdirSync(apiRoot, { recursive: true })

    const main = pushWorkRepoToBare({
      root,
      bareName: 'main.git',
      workName: 'main-work',
      file: 'pinokio.json',
      firstContent: '{"title":"Restore Fixture","menu":[]}\n',
      firstMessage: 'main baseline',
    })
    const nested = pushWorkRepoToBare({
      root,
      bareName: 'nested.git',
      workName: 'nested-work',
      file: 'nested.txt',
      firstContent: 'nested pinned\n',
      firstMessage: 'nested pinned',
      secondContent: 'nested latest\n',
      secondMessage: 'nested latest',
    })

    const workspaceName = 'restore-fixture'
    const workspace = path.join(apiRoot, workspaceName)
    git(['clone', main.remote, workspace], apiRoot)
    const beforeDirs = new Set([workspace])
    git(['clone', nested.remote, path.join(workspace, 'nested')], workspace)

    const nestedHeadBefore = git(['-C', path.join(workspace, 'nested'), 'rev-parse', 'HEAD'], root)
    assert.equal(nestedHeadBefore, nested.secondHead)

    const kernel = createKernel(home)
    await kernel.git.loadCheckpoints()
    const snapshotId = 'restore-fixture'
    const remoteKey = kernel.git.normalizeRemote(main.remote)
    const saved = await kernel.git.writeCheckpointPayload(remoteKey, main.remote, {
      id: snapshotId,
      visibility: 'public',
      checkpoint: {
        root: main.remote,
        repos: [
          { path: '.', remote: main.remote, commit: main.firstHead },
          { path: 'nested', remote: nested.remote, commit: nested.firstHead },
        ],
      },
    })
    assert.ok(saved)

    kernel.git.activeSnapshot[workspaceName] = { id: snapshotId, remoteKey }
    await kernel.git.restoreNewReposForActiveSnapshot(workspaceName, workspace, beforeDirs)

    const nestedHeadAfter = git(['-C', path.join(workspace, 'nested'), 'rev-parse', 'HEAD'], root)
    assert.equal(nestedHeadAfter, nested.firstHead)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('shell launch computes checkpoint restore before-set from the selected workspace, not global git dirs', async () => {
  const root = makeTempRoot('pinokio-startup-shell-before-dirs-')
  const originalStart = Shell.prototype.start
  try {
    const apiRoot = path.join(root, 'api')
    const workspaceName = 'fixture'
    const workspace = path.join(apiRoot, workspaceName)
    const existingNested = path.join(workspace, 'existing-nested')
    const unrelatedRepo = path.join(apiRoot, 'other-app')
    fs.mkdirSync(existingNested, { recursive: true })
    fs.mkdirSync(unrelatedRepo, { recursive: true })

    const reposCalls = []
    let restoreArgs = null
    const kernel = {
      homedir: root,
      platform: 'darwin',
      path: (...parts) => path.join(root, ...parts),
      bin: {
        envs: (env = {}) => env,
      },
      api: {
        running: {},
        resolvePath: (cwd, targetPath) => path.resolve(cwd, targetPath),
      },
      git: {
        dirs: new Set([unrelatedRepo, workspace]),
        repos: async (scanRoot) => {
          reposCalls.push(scanRoot)
          return [
            { gitParentPath: workspace },
            { gitParentPath: existingNested },
          ]
        },
        restoreNewReposForActiveSnapshot: async (name, restoreRoot, beforeDirs) => {
          restoreArgs = { name, restoreRoot, beforeDirs }
        },
      },
    }
    const shells = new Shells(kernel)
    shells.ensureBracketedPasteSupport = async () => true
    Shell.prototype.start = async () => ''

    await shells.launch({
      message: 'noop',
      path: path.join(workspace, 'scripts'),
    }, {}, () => {})

    assert.deepEqual(reposCalls, [workspace])
    assert.ok(restoreArgs)
    assert.equal(restoreArgs.name, workspaceName)
    assert.equal(restoreArgs.restoreRoot, workspace)
    assert.deepEqual(
      Array.from(restoreArgs.beforeDirs).sort(),
      [workspace, existingNested].sort()
    )
    assert.equal(restoreArgs.beforeDirs.has(unrelatedRepo), false)
  } finally {
    Shell.prototype.start = originalStart
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('api.linkGit drops deleted top-level app remotes after an explicit refresh', async () => {
  const root = makeTempRoot('pinokio-startup-linkgit-delete-')
  try {
    const apiRoot = path.join(root, 'api')
    const workspace = path.join(apiRoot, 'delete-me')
    fs.mkdirSync(apiRoot, { recursive: true })
    const remote = 'https://example.com/delete-me.git'
    initRepo(workspace, { remote, content: 'delete me\n' })

    const api = new Api({
      homedir: root,
      path: (...parts) => path.join(root, ...parts),
    })
    api.userdir = apiRoot

    await api.linkGit()
    assert.deepEqual(api.gitPath, {
      [remote]: workspace,
    })

    fs.rmSync(workspace, { recursive: true, force: true })
    await api.linkGit()
    assert.deepEqual(api.gitPath, {})
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
