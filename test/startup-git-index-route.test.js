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
const readyPrefix = 'PINOKIO_ROUTE_TEST_READY '
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
      GIT_AUTHOR_NAME: 'Codex Route Test',
      GIT_AUTHOR_EMAIL: 'codex-route-test@example.com',
      GIT_COMMITTER_NAME: 'Codex Route Test',
      GIT_COMMITTER_EMAIL: 'codex-route-test@example.com',
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
  git(['config', 'user.name', 'Codex Route Test'], repoPath)
  git(['config', 'user.email', 'codex-route-test@example.com'], repoPath)
  fs.writeFileSync(path.join(repoPath, file), content)
  git(['add', '.'], repoPath)
  git(['commit', '-m', message], repoPath)
  git(['branch', '-M', 'main'], repoPath)
  git(['remote', 'add', 'origin', remote], repoPath)
}

function fileUrl(targetPath) {
  return `file://${targetPath}`
}

function createBareRemote(root, name, { file = 'tracked.txt', content = 'remote clean\n' } = {}) {
  const remotesRoot = path.join(root, 'remotes')
  const workRoot = path.join(root, 'work')
  const bare = path.join(remotesRoot, `${name}.git`)
  const work = path.join(workRoot, name)
  fs.mkdirSync(remotesRoot, { recursive: true })
  fs.mkdirSync(workRoot, { recursive: true })
  git(['init', '--bare', bare], root)
  fs.mkdirSync(work, { recursive: true })
  git(['init'], work)
  git(['config', 'user.name', 'Codex Route Test'], work)
  git(['config', 'user.email', 'codex-route-test@example.com'], work)
  fs.writeFileSync(path.join(work, file), content)
  git(['add', '.'], work)
  git(['commit', '-m', 'baseline'], work)
  git(['branch', '-M', 'main'], work)
  git(['remote', 'add', 'origin', fileUrl(bare)], work)
  git(['push', '-u', 'origin', 'main'], work)
  return {
    bare,
    work,
    remote: fileUrl(bare),
    file,
  }
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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-route-test-'))
  const fakeUserHome = path.join(root, 'user')
  const pinokioHome = path.join(root, 'pinokio')
  const apiRoot = path.join(pinokioHome, 'api')
  const workspaceName = 'route-fixture'
  const workspace = path.join(apiRoot, workspaceName)
  const nested = path.join(workspace, 'nested')
  await fsp.mkdir(fakeUserHome, { recursive: true })
  await fsp.mkdir(apiRoot, { recursive: true })

  const topRemote = 'https://example.com/pinokio-route-fixture.git'
  const nestedRemote = 'https://example.com/pinokio-route-fixture-nested.git'

  initRepo(workspace, {
    remote: topRemote,
    file: 'tracked.txt',
    content: 'top clean\n',
    message: 'top baseline',
  })
  initRepo(nested, {
    remote: nestedRemote,
    file: 'nested.txt',
    content: 'nested clean\n',
    message: 'nested baseline',
  })

  return {
    root,
    fakeUserHome,
    pinokioHome,
    apiRoot,
    workspaceName,
    workspace,
    nested,
    topRemote,
    nestedRemote,
  }
}

async function runServerMode() {
  const args = parseArgs()
  const port = Number(args.port)
  const home = path.resolve(String(args.home || ''))
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
    redirect: options.redirect || 'follow',
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch (_) {
    json = null
  }
  return { response, text, json }
}

async function fetchForm(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch (_) {
    json = null
  }
  return { response, text, json }
}

async function waitForJson(baseUrl, route, predicate, timeoutMs = 30000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await fetchJson(baseUrl, route)
    if (last.response.ok && predicate(last.json)) {
      return last.json
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${route}; last=${last ? last.text : '<none>'}`)
}

async function withRouteServer(callback) {
  const fixture = await createFixtureHome()
  const port = await freePort()
  const env = {
    ...process.env,
    HOME: fixture.fakeUserHome,
    PINOKIO_HOME: fixture.pinokioHome,
    PINOKIO_DISABLE_WATCH: '1',
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

function repoWithUrl(payload, url) {
  assert.ok(payload && Array.isArray(payload.repos), 'payload must contain repos array')
  return payload.repos.find((repo) => repo && repo.url === url)
}

function diffContains(diffPayload, text) {
  return JSON.stringify(diffPayload.diff || []).includes(text)
}

async function assertBrowserResolves(baseUrl, remote, folder, file) {
  const response = await fetch(`${baseUrl}/pinokio/browser?uri=${encodeURIComponent(`${remote}/${file}`)}`, {
    redirect: 'manual',
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `/pinokio/browser/${folder}/${file}`)
}

if (!serverMode) test('/info/api routes preserve top-level, nested, and missing remote behavior', async () => {
  await withRouteServer(async ({
    baseUrl,
    workspaceName,
    topRemote,
    nestedRemote,
  }) => {
    const encodedTopRemote = encodeURIComponent(topRemote)
    const encodedNestedRemote = encodeURIComponent(nestedRemote)
    const missingRemote = encodeURIComponent('https://example.com/pinokio-route-missing.git')

    const apiByName = await fetchJson(baseUrl, `/info/api/${workspaceName}`)
    assert.equal(apiByName.response.status, 200)
    assert.ok(repoWithUrl(apiByName.json, topRemote), '/info/api/:name should include top-level remote')
    assert.ok(repoWithUrl(apiByName.json, nestedRemote), '/info/api/:name should include nested remote')

    const apiByTopRemote = await waitForJson(
      baseUrl,
      `/info/api?git=${encodedTopRemote}`,
      (payload) => !!repoWithUrl(payload, topRemote)
    )
    assert.ok(repoWithUrl(apiByTopRemote, topRemote), '/info/api?git should resolve top-level remote')

    const apiByNestedRemote = await waitForJson(
      baseUrl,
      `/info/api?git=${encodedNestedRemote}`,
      (payload) => !!repoWithUrl(payload, nestedRemote)
    )
    assert.ok(repoWithUrl(apiByNestedRemote, nestedRemote), '/info/api?git should resolve nested remote')

    const apiMissing = await fetchJson(baseUrl, `/info/api?git=${missingRemote}`)
    assert.equal(apiMissing.response.status, 200)
    assert.deepEqual(apiMissing.json, { repos: [] })
  })
})

if (!serverMode) test('/info/gitstatus and /gitdiff routes preserve selected-workspace behavior', async () => {
  await withRouteServer(async ({
    baseUrl,
    workspaceName,
    workspace,
    nested,
  }) => {
    const cleanStatus = await fetchJson(baseUrl, `/info/gitstatus/${workspaceName}`)
    assert.equal(cleanStatus.response.status, 200)
    assert.equal(cleanStatus.json.totalChanges, 0)
    assert.equal(cleanStatus.json.repos.length, 2)

    await fsp.writeFile(path.join(workspace, 'tracked.txt'), 'top clean\ntop dirty\n')
    await fsp.writeFile(path.join(nested, 'nested.txt'), 'nested clean\nnested dirty\n')

    const dirtyStatus = await fetchJson(baseUrl, `/info/gitstatus/${workspaceName}?force=1`)
    assert.equal(dirtyStatus.response.status, 200)
    assert.equal(dirtyStatus.json.totalChanges, 2)
    assert.equal(dirtyStatus.json.repos.length, 2)
    assert.ok(dirtyStatus.json.repos.some((repo) => repo.changeCount === 1 && repo.name === workspaceName))
    assert.ok(dirtyStatus.json.repos.some((repo) => repo.changeCount === 1 && repo.name === `${workspaceName}/nested`))

    const cachedDirtyStatus = await fetchJson(baseUrl, `/info/gitstatus/${workspaceName}`)
    assert.equal(cachedDirtyStatus.response.status, 200)
    assert.equal(cachedDirtyStatus.json.totalChanges, 2)

    const topDiff = await fetchJson(baseUrl, `/gitdiff/HEAD/${workspaceName}/tracked.txt`)
    assert.equal(topDiff.response.status, 200)
    assert.equal(topDiff.json.file, 'tracked.txt')
    assert.equal(topDiff.json.binary, false)
    assert.ok(diffContains(topDiff.json, 'top dirty'))

    const nestedDiff = await fetchJson(baseUrl, `/gitdiff/HEAD/${workspaceName}/nested/nested.txt`)
    assert.equal(nestedDiff.response.status, 200)
    assert.equal(nestedDiff.json.file, 'nested.txt')
    assert.equal(nestedDiff.json.binary, false)
    assert.ok(diffContains(nestedDiff.json, 'nested dirty'))
  })
})

if (!serverMode) test('/pinokio/delete refreshes top-level git URI inventory after app removal', async () => {
  await withRouteServer(async ({
    baseUrl,
    workspaceName,
    workspace,
    topRemote,
  }) => {
    const browserBeforeDelete = await fetch(`${baseUrl}/pinokio/browser?uri=${encodeURIComponent(`${topRemote}/tracked.txt`)}`, {
      redirect: 'manual',
    })
    assert.equal(browserBeforeDelete.status, 302)
    assert.equal(browserBeforeDelete.headers.get('location'), `/pinokio/browser/${workspaceName}/tracked.txt`)

    const deleteResult = await fetchJson(baseUrl, '/pinokio/delete', {
      method: 'POST',
      body: { name: workspaceName },
    })
    assert.equal(deleteResult.response.status, 200)
    assert.deepEqual(deleteResult.json, { success: true })

    await assert.rejects(
      fsp.access(workspace),
      /ENOENT/
    )

    const browserAfterDelete = await fetch(`${baseUrl}/pinokio/browser?uri=${encodeURIComponent(`${topRemote}/tracked.txt`)}`, {
      redirect: 'manual',
    })
    assert.notEqual(
      browserAfterDelete.headers.get('location'),
      `/pinokio/browser/${workspaceName}/tracked.txt`,
      '/pinokio/delete must refresh kernel.api.gitPath so deleted remotes no longer resolve to stale app paths'
    )
  })
})

if (!serverMode) test('/pinokio/upload move refreshes top-level git URI inventory', async () => {
  await withRouteServer(async ({
    baseUrl,
    workspaceName,
    workspace,
    topRemote,
  }) => {
    await assertBrowserResolves(baseUrl, topRemote, workspaceName, 'tracked.txt')

    const movedName = 'route-fixture-moved'
    const moveResult = await fetchForm(baseUrl, '/pinokio/upload', {
      move: '1',
      old_path: workspaceName,
      new_path: movedName,
    })
    assert.equal(moveResult.response.status, 200)
    assert.equal(moveResult.json.success, true)
    await assert.rejects(fsp.access(workspace), /ENOENT/)
    await fsp.access(path.join(path.dirname(workspace), movedName))

    await assertBrowserResolves(baseUrl, topRemote, movedName, 'tracked.txt')
  })
})

if (!serverMode) test('/pinokio/fs clone refreshes top-level git URI inventory', async () => {
  await withRouteServer(async ({
    baseUrl,
    root,
    apiRoot,
  }) => {
    const remote = createBareRemote(root, 'fs-clone-remote', {
      file: 'tracked.txt',
      content: 'fs clone\n',
    })
    const folder = 'fs-clone-fixture'
    const cloneResult = await fetchForm(baseUrl, '/pinokio/fs', {
      drive: 'api',
      path: remote.remote,
      method: 'clone',
      types: JSON.stringify(['string']),
      arg0: folder,
    })
    assert.equal(cloneResult.response.status, 200)
    assert.deepEqual(cloneResult.json, { result: 'success' })
    await fsp.access(path.join(apiRoot, folder, '.git'))
    await assertBrowserResolves(baseUrl, remote.remote, folder, remote.file)
  })
})

if (!serverMode) test('/launcher/download create_app refreshes top-level git URI inventory', async () => {
  await withRouteServer(async ({
    baseUrl,
    root,
    apiRoot,
  }) => {
    const remote = createBareRemote(root, 'launcher-download-remote', {
      file: 'pinokio.js',
      content: 'module.exports = { title: "Launcher Download Fixture", menu: [] }\n',
    })
    const folder = 'launcher-download-fixture'
    const downloadResult = await fetchJson(baseUrl, '/launcher/download', {
      method: 'POST',
      body: {
        intent: 'create_app',
        ref: remote.remote,
        name: folder,
      },
    })
    assert.equal(downloadResult.response.status, 200)
    assert.equal(downloadResult.json.ok, true)
    await fsp.access(path.join(apiRoot, folder, '.git'))
    await assertBrowserResolves(baseUrl, remote.remote, folder, remote.file)
  })
})

if (!serverMode) test('/launcher/download/finalize create_app refreshes top-level git URI inventory after prepared clone', async () => {
  await withRouteServer(async ({
    baseUrl,
    root,
    apiRoot,
  }) => {
    const remote = createBareRemote(root, 'launcher-finalize-remote', {
      file: 'pinokio.js',
      content: 'module.exports = { title: "Launcher Finalize Fixture", menu: [] }\n',
    })
    const folder = 'launcher-finalize-fixture'
    git(['clone', '--depth', '1', '--single-branch', remote.remote, path.join(apiRoot, folder)], apiRoot)
    await fsp.access(path.join(apiRoot, folder, '.git'))

    const finalizeResult = await fetchJson(baseUrl, '/launcher/download/finalize', {
      method: 'POST',
      body: {
        intent: 'create_app',
        ref: remote.remote,
        name: folder,
      },
    })
    assert.equal(finalizeResult.response.status, 200)
    assert.equal(finalizeResult.json.ok, true)
    await assertBrowserResolves(baseUrl, remote.remote, folder, remote.file)
  })
})

if (!serverMode) test('/checkpoints/install latest refreshes top-level git URI inventory', async () => {
  await withRouteServer(async ({
    baseUrl,
    root,
    apiRoot,
  }) => {
    const remote = createBareRemote(root, 'checkpoint-latest-remote', {
      file: 'tracked.txt',
      content: 'checkpoint latest\n',
    })
    const folder = 'checkpoint-latest-fixture'
    const installResult = await fetchJson(baseUrl, '/checkpoints/install', {
      method: 'POST',
      body: {
        remote: remote.remote,
        folder,
        snapshotId: 'latest',
      },
    })
    assert.equal(installResult.response.status, 200)
    assert.equal(installResult.json.ok, true)
    await fsp.access(path.join(apiRoot, folder, '.git'))
    await assertBrowserResolves(baseUrl, remote.remote, folder, remote.file)
  })
})

if (!serverMode) test('/terminals/deploy/local refreshes top-level git URI inventory', async () => {
  await withRouteServer(async ({
    baseUrl,
    root,
    pinokioHome,
    apiRoot,
  }) => {
    const remote = createBareRemote(root, 'terminal-deploy-remote', {
      file: 'tracked.txt',
      content: 'terminal deploy\n',
    })
    const workspacesRoot = path.join(pinokioHome, 'workspaces')
    const sourceFolder = path.join(workspacesRoot, 'terminal-source')
    const folder = 'terminal-deploy-fixture'
    await fsp.mkdir(workspacesRoot, { recursive: true })
    git(['clone', '--depth', '1', '--single-branch', remote.remote, sourceFolder], workspacesRoot)

    const deployResult = await fetchJson(baseUrl, '/terminals/deploy/local', {
      method: 'POST',
      body: {
        folderName: folder,
        sessionCwd: sourceFolder,
      },
    })
    assert.equal(deployResult.response.status, 200)
    assert.equal(deployResult.json.ok, true)
    await fsp.access(path.join(apiRoot, folder, '.git'))
    await assertBrowserResolves(baseUrl, remote.remote, folder, remote.file)
  })
})

if (serverMode) {
  runServerMode().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}
