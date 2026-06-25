#!/usr/bin/env node

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const repoRoot = path.resolve(__dirname, '..')
const readyPrefix = 'PINOKIO_STARTUP_PERF_READY '
const serverMode = process.argv.includes('--server')

function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function run(cmd, args, cwd, options = {}) {
  return childProcess.execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codex Perf Test',
      GIT_AUTHOR_EMAIL: 'codex-perf-test@example.com',
      GIT_COMMITTER_NAME: 'Codex Perf Test',
      GIT_COMMITTER_EMAIL: 'codex-perf-test@example.com',
      GIT_TERMINAL_PROMPT: '0',
      ...options.env,
    },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function git(args, cwd) {
  return run('git', args, cwd)
}

function initRepo(repoPath, { remote, file, content, message }) {
  fs.mkdirSync(repoPath, { recursive: true })
  git(['init'], repoPath)
  git(['config', 'user.name', 'Codex Perf Test'], repoPath)
  git(['config', 'user.email', 'codex-perf-test@example.com'], repoPath)
  fs.writeFileSync(path.join(repoPath, file), content)
  git(['add', '.'], repoPath)
  git(['commit', '-m', message], repoPath)
  git(['branch', '-M', 'main'], repoPath)
  git(['remote', 'add', 'origin', remote], repoPath)
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function createFixtureHome() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-startup-perf-'))
  const fakeUserHome = path.join(root, 'user')
  const pinokioHome = path.join(root, 'pinokio')
  const apiRoot = path.join(pinokioHome, 'api')
  const workspaceName = 'perf-fixture'
  const workspace = path.join(apiRoot, workspaceName)
  const nested = path.join(workspace, 'nested')
  await fsp.mkdir(fakeUserHome, { recursive: true })
  await fsp.mkdir(apiRoot, { recursive: true })
  initRepo(workspace, {
    remote: 'https://example.com/pinokio-perf-fixture.git',
    file: 'tracked.txt',
    content: 'top clean\n',
    message: 'top baseline',
  })
  initRepo(nested, {
    remote: 'https://example.com/pinokio-perf-fixture-nested.git',
    file: 'nested.txt',
    content: 'nested clean\n',
    message: 'nested baseline',
  })
  return { root, fakeUserHome, pinokioHome, apiRoot, workspaceName, workspace, nested }
}

function createMetrics(home) {
  const apiRoot = path.resolve(home, 'api')
  const empty = () => ({
    startedAt: Date.now(),
    gitIndexCalls: 0,
    gitReposCalls: 0,
    apiRootReposCalls: 0,
    workspaceReposCalls: 0,
    rootWatcherCalls: 0,
    workspaceWatcherCalls: 0,
    fs: {
      readdir: 0,
      readFile: 0,
      stat: 0,
      lstat: 0,
      access: 0,
      readdirEntries: 0,
      readFileBytes: 0,
    },
  })
  let current = empty()
  return {
    apiRoot,
    reset() {
      current = empty()
    },
    snapshot() {
      return JSON.parse(JSON.stringify(current))
    },
    inc(key, amount = 1) {
      current[key] += amount
    },
    incFs(key, amount = 1) {
      current.fs[key] += amount
    },
  }
}

function installInstrumentation(home) {
  const metrics = createMetrics(home)
  const fsMethods = ['readdir', 'readFile', 'stat', 'lstat', 'access']
  const originals = {}
  for (const method of fsMethods) {
    originals[method] = fs.promises[method]
    fs.promises[method] = async function instrumentedFsMethod(...args) {
      const result = await originals[method].apply(this, args)
      metrics.incFs(method)
      if (method === 'readdir' && Array.isArray(result)) {
        metrics.incFs('readdirEntries', result.length)
      } else if (method === 'readFile') {
        metrics.incFs('readFileBytes', Buffer.isBuffer(result) ? result.length : Buffer.byteLength(String(result)))
      }
      return result
    }
  }

  const Git = require(path.join(repoRoot, 'kernel/git'))
  const WorkspaceStatusManager = require(path.join(repoRoot, 'kernel/workspace_status'))
  const originalIndex = Git.prototype.index
  const originalRepos = Git.prototype.repos
  const originalEnsureWatcher = WorkspaceStatusManager.prototype.ensureWatcher

  Git.prototype.index = async function instrumentedGitIndex(...args) {
    metrics.inc('gitIndexCalls')
    return originalIndex.apply(this, args)
  }
  Git.prototype.repos = async function instrumentedGitRepos(root, ...args) {
    metrics.inc('gitReposCalls')
    const resolvedRoot = root ? path.resolve(root) : ''
    if (resolvedRoot === metrics.apiRoot) {
      metrics.inc('apiRootReposCalls')
    } else if (resolvedRoot.startsWith(`${metrics.apiRoot}${path.sep}`)) {
      metrics.inc('workspaceReposCalls')
    }
    return originalRepos.call(this, root, ...args)
  }
  WorkspaceStatusManager.prototype.ensureWatcher = async function instrumentedEnsureWatcher(workspaceName, workspaceRoot, ...args) {
    const resolvedRoot = workspaceRoot ? path.resolve(workspaceRoot) : ''
    if (workspaceName === 'api' && resolvedRoot === metrics.apiRoot) {
      metrics.inc('rootWatcherCalls')
    } else {
      metrics.inc('workspaceWatcherCalls')
    }
    return originalEnsureWatcher.call(this, workspaceName, workspaceRoot, ...args)
  }

  return metrics
}

async function runServerMode() {
  const args = parseArgs()
  const port = Number(args.port)
  const home = path.resolve(String(args.home || ''))
  const metrics = installInstrumentation(home)
  const pkg = require(path.join(repoRoot, 'package.json'))
  const Server = require(path.join(repoRoot, 'server'))
  const server = new Server({
    store: { store: { home, version: pkg.version } },
    agent: 'test',
    newsfeed: '',
    portal: '',
  })
  server.port = port
  await server.start({ debug: true })
  server.app.get('/__startup-git-index-test/metrics', (req, res) => {
    res.json({ ok: true, metrics: metrics.snapshot() })
  })
  server.app.post('/__startup-git-index-test/reset', (req, res) => {
    metrics.reset()
    res.json({ ok: true })
  })
  process.stdout.write(`${readyPrefix}${JSON.stringify({ port, home, pid: process.pid })}\n`)
  setInterval(() => {}, 1000)
}

function waitForReady(child, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      reject(new Error(`server did not become ready in ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith(readyPrefix)) {
          clearTimeout(timer)
          resolve({ ready: JSON.parse(line.slice(readyPrefix.length)), stdout, stderr })
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`server exited before ready: code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}

async function fetchJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch (_) {}
  assert.ok(response.ok, `${route} failed with ${response.status}: ${text}`)
  return json
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withPerfServer(callback, options = {}) {
  const fixture = await createFixtureHome()
  const port = await freePort()
  const env = {
    ...process.env,
    HOME: fixture.fakeUserHome,
    PINOKIO_HOME: fixture.pinokioHome,
  }
  if (options.disableWatch) {
    env.PINOKIO_DISABLE_WATCH = '1'
  }
  const child = childProcess.spawn(process.execPath, [
    __filename,
    '--server',
    '--port',
    String(port),
    '--home',
    fixture.pinokioHome,
  ], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  try {
    await waitForReady(child)
    await callback({
      ...fixture,
      baseUrl: `http://127.0.0.1:${port}`,
    })
  } catch (error) {
    error.message = `${error.message}\nserver log:\n${logs.join('')}`
    throw error
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (_) {
        child.kill('SIGTERM')
      }
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await fsp.rm(fixture.root, { recursive: true, force: true })
  }
}

if (!serverMode) test('startup path does not run global git index or root API watcher pre-scan', async () => {
  await withPerfServer(async ({ baseUrl }) => {
    await sleep(5000)
    const { metrics } = await fetchJson(baseUrl, '/__startup-git-index-test/metrics')
    assert.equal(metrics.gitIndexCalls, 0, 'startup must not call kernel.git.index()')
    assert.equal(metrics.rootWatcherCalls, 0, 'startup must not call root ensureWatcher("api")')
    assert.equal(metrics.apiRootReposCalls, 0, 'startup must not recursively scan the API root with kernel.git.repos(apiRoot)')
  })
})

if (!serverMode) test('/info/gitstatus stays selected-workspace scoped and avoids whole API scans', async () => {
  await withPerfServer(async ({ baseUrl, workspaceName, workspace }) => {
    await sleep(5000)
    await fetchJson(baseUrl, '/__startup-git-index-test/reset', { method: 'POST', body: {} })
    await fsp.writeFile(path.join(workspace, 'tracked.txt'), 'top clean\ntop dirty\n')
    const status = await fetchJson(baseUrl, `/info/gitstatus/${workspaceName}?force=1`)
    assert.equal(status.totalChanges, 1)
    const { metrics } = await fetchJson(baseUrl, '/__startup-git-index-test/metrics')
    assert.equal(metrics.apiRootReposCalls, 0, '/info/gitstatus must not call kernel.git.repos(apiRoot)')
    assert.ok(metrics.workspaceReposCalls >= 1, '/info/gitstatus should scan the selected workspace')
    assert.ok(metrics.fs.readdir < 10000, `/info/gitstatus should stay below whole-tree scale; readdir=${metrics.fs.readdir}`)
  }, { disableWatch: true })
})

if (serverMode) {
  runServerMode().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}
