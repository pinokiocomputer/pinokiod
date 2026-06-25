const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const WorkspaceStatusManager = require('../kernel/workspace_status')

const {
  buildCurrentWorkspaceIgnoreEngine,
  candidateIgnoredByPathScopedGitignores,
  currentEngineIgnored,
  normalizePath,
} = require('./workspace-gitignore-benchmark')

function run(cmd, args, cwd) {
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function git(args, cwd) {
  return run('git', args, cwd)
}

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function initRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true })
  git(['init'], repoPath)
  git(['config', 'user.name', 'Codex Test'], repoPath)
  git(['config', 'user.email', 'codex-test@example.com'], repoPath)
}

function writeFile(filePath, content = 'x\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function makeRecord(workspaceRoot, repoRoot, repoRelative) {
  const absolutePath = path.resolve(repoRoot, repoRelative)
  return {
    key: `${repoRoot}\0${normalizePath(repoRelative)}`,
    repoRoot,
    repoRelative: normalizePath(repoRelative),
    absolutePath,
    workspaceRelative: normalizePath(path.relative(workspaceRoot, absolutePath)),
    statusCode: '??',
    rawLine: `?? ${normalizePath(repoRelative)}`,
  }
}

test('path-scoped candidate honors top-level workspace ignores for deep nested repos', async () => {
  const root = makeTempRoot('pinokio-gitignore-top-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    const nested = path.join(workspace, 'a', 'b', 'c', 'repo')
    initRepo(workspace)
    writeFile(path.join(workspace, '.gitignore'), 'a/b/c/repo/parent-hidden.txt\n')
    initRepo(nested)
    writeFile(path.join(nested, 'parent-hidden.txt'))
    writeFile(path.join(nested, 'visible.txt'))

    const records = [
      makeRecord(workspace, nested, 'parent-hidden.txt'),
      makeRecord(workspace, nested, 'visible.txt'),
    ]
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(candidate.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[1].key), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('path-scoped candidate includes intermediate .gitignore files before the leaf repo', async () => {
  const root = makeTempRoot('pinokio-gitignore-intermediate-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    const middle = path.join(workspace, 'a')
    const leaf = path.join(middle, 'b', 'c', 'repo')
    initRepo(workspace)
    initRepo(middle)
    writeFile(path.join(middle, '.gitignore'), 'b/c/repo/intermediate-hidden.txt\n')
    initRepo(leaf)
    writeFile(path.join(leaf, '.gitignore'), 'leaf-hidden.txt\n')
    writeFile(path.join(leaf, 'intermediate-hidden.txt'))
    writeFile(path.join(leaf, 'leaf-hidden.txt'))
    writeFile(path.join(leaf, 'visible.txt'))

    const records = [
      makeRecord(workspace, leaf, 'intermediate-hidden.txt'),
      makeRecord(workspace, leaf, 'leaf-hidden.txt'),
      makeRecord(workspace, leaf, 'visible.txt'),
    ]
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(candidate.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[1].key), true)
    assert.equal(candidate.ignored.has(records[2].key), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('path-scoped candidate hides tracked paths the same way current JS filtering does', async () => {
  const root = makeTempRoot('pinokio-gitignore-no-index-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    initRepo(workspace)
    writeFile(path.join(workspace, 'tracked-hidden.txt'), 'tracked\n')
    git(['add', 'tracked-hidden.txt'], workspace)
    git(['commit', '-m', 'track hidden fixture'], workspace)
    writeFile(path.join(workspace, '.gitignore'), 'tracked-hidden.txt\n')

    const records = [makeRecord(workspace, workspace, 'tracked-hidden.txt')]
    const current = currentEngineIgnored((await buildCurrentWorkspaceIgnoreEngine(workspace)).engine, records)
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(current.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[0].key), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('path-scoped candidate evaluates symlinked directory paths as strings', async () => {
  const root = makeTempRoot('pinokio-gitignore-symlink-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    const external = path.join(root, 'external-models')
    initRepo(workspace)
    writeFile(path.join(workspace, '.gitignore'), '/models/\n/output/\n')
    fs.mkdirSync(path.join(workspace, 'models'), { recursive: true })
    fs.mkdirSync(path.join(external, 'output'), { recursive: true })
    fs.mkdirSync(path.join(external, 'checkpoints'), { recursive: true })
    fs.symlinkSync(path.join(external, 'checkpoints'), path.join(workspace, 'models', 'checkpoints'), 'dir')
    fs.symlinkSync(path.join(external, 'output'), path.join(workspace, 'output'), 'dir')

    const records = [
      makeRecord(workspace, workspace, 'models/checkpoints/deleted-placeholder'),
      makeRecord(workspace, workspace, 'output/deleted-placeholder'),
    ]
    const current = currentEngineIgnored((await buildCurrentWorkspaceIgnoreEngine(workspace)).engine, records)
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(current.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[0].key), true)
    assert.equal(current.ignored.has(records[1].key), true)
    assert.equal(candidate.ignored.has(records[1].key), true)
    assert.equal(candidate.metrics.checked, records.length)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('candidate filtering matches current workspace pre-scan model on multi-level fixture', async () => {
  const root = makeTempRoot('pinokio-gitignore-parity-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    const middle = path.join(workspace, 'packages', 'middle')
    const leaf = path.join(middle, 'runtime', 'leaf')
    initRepo(workspace)
    writeFile(path.join(workspace, '.gitignore'), 'workspace-hidden.txt\npackages/middle/runtime/leaf/workspace-leaf-hidden.txt\n')
    writeFile(path.join(workspace, 'packages', '.gitignore'), 'middle/runtime/leaf/package-hidden.txt\n')
    initRepo(middle)
    writeFile(path.join(middle, '.gitignore'), 'runtime/leaf/middle-hidden.txt\n')
    initRepo(leaf)
    writeFile(path.join(leaf, '.gitignore'), 'leaf-hidden.txt\n')

    const records = [
      makeRecord(workspace, workspace, 'workspace-hidden.txt'),
      makeRecord(workspace, leaf, 'package-hidden.txt'),
      makeRecord(workspace, leaf, 'workspace-leaf-hidden.txt'),
      makeRecord(workspace, leaf, 'middle-hidden.txt'),
      makeRecord(workspace, leaf, 'leaf-hidden.txt'),
      makeRecord(workspace, leaf, 'visible.txt'),
    ]
    for (const record of records) {
      writeFile(record.absolutePath)
    }

    const current = currentEngineIgnored((await buildCurrentWorkspaceIgnoreEngine(workspace)).engine, records)
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)
    const manager = new WorkspaceStatusManager({ enableWatchers: false })
    const runtimeIgnored = await manager.filterPathScopedGitIgnored(workspace, records)

    assert.deepEqual(new Set(candidate.ignored), new Set(current.ignored))
    assert.deepEqual(new Set(runtimeIgnored), new Set(current.ignored))
    assert.equal(candidate.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[1].key), true)
    assert.equal(candidate.ignored.has(records[2].key), true)
    assert.equal(candidate.ignored.has(records[3].key), true)
    assert.equal(candidate.ignored.has(records[4].key), true)
    assert.equal(candidate.ignored.has(records[5].key), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('path-scoped candidate preserves current leading-slash normalization behavior', async () => {
  const root = makeTempRoot('pinokio-gitignore-leading-slash-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    initRepo(workspace)
    writeFile(path.join(workspace, '.gitignore'), '/AGENTS.md\n')
    writeFile(path.join(workspace, 'app', 'AGENTS.md'))

    const records = [makeRecord(workspace, workspace, 'app/AGENTS.md')]
    const current = currentEngineIgnored((await buildCurrentWorkspaceIgnoreEngine(workspace)).engine, records)
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(current.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[0].key), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('path-scoped candidate preserves current trailing directory path behavior', async () => {
  const root = makeTempRoot('pinokio-gitignore-trailing-dir-')
  try {
    const workspace = path.join(root, 'api', 'foo')
    initRepo(workspace)
    writeFile(path.join(workspace, 'app', '.gitignore'), [
      'demosite/timelines/*',
      '!demosite/timelines/friendfeed.com/',
      '!demosite/timelines/friendfeed.com/**',
      '',
    ].join('\n'))
    fs.mkdirSync(path.join(workspace, 'app', 'demosite', 'timelines', 'friendfeed.com'), { recursive: true })

    const records = [makeRecord(workspace, workspace, 'app/demosite/timelines/friendfeed.com')]
    const current = currentEngineIgnored((await buildCurrentWorkspaceIgnoreEngine(workspace)).engine, records)
    const candidate = await candidateIgnoredByPathScopedGitignores(workspace, records)

    assert.equal(current.ignored.has(records[0].key), true)
    assert.equal(candidate.ignored.has(records[0].key), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
