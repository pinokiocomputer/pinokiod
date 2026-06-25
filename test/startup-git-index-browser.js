#!/usr/bin/env node

const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const outputRoot = path.resolve(repoRoot, 'output/playwright/startup-git-index')
const readyPrefix = 'PINOKIO_STARTUP_BROWSER_READY '
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

function loadPlaywright() {
  try {
    return require('playwright')
  } catch (_) {}

  try {
    const bin = childProcess.execFileSync('which', ['playwright'], { encoding: 'utf8' }).trim()
    if (bin) {
      return require(path.join(path.dirname(path.dirname(bin)), 'playwright'))
    }
  } catch (_) {}

  throw new Error('Playwright is required. Run: npx -y -p playwright node test/startup-git-index-browser.js')
}

function chromiumExecutablePath(playwright) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    playwright.chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

function run(cmd, args, cwd, options = {}) {
  return childProcess.execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codex Browser Test',
      GIT_AUTHOR_EMAIL: 'codex-browser-test@example.com',
      GIT_COMMITTER_NAME: 'Codex Browser Test',
      GIT_COMMITTER_EMAIL: 'codex-browser-test@example.com',
      GIT_TERMINAL_PROMPT: '0',
      ...options.env,
    },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function git(args, cwd) {
  return run('git', args, cwd)
}

function initAppRepo(repoPath, { remote }) {
  fs.mkdirSync(repoPath, { recursive: true })
  git(['init'], repoPath)
  git(['config', 'user.name', 'Codex Browser Test'], repoPath)
  git(['config', 'user.email', 'codex-browser-test@example.com'], repoPath)
  fs.writeFileSync(path.join(repoPath, 'pinokio.js'), [
    'module.exports = {',
    '  title: "Startup Browser Fixture",',
    '  description: "Fixture for startup git index Browser verification.",',
    '  menu: []',
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'top clean\n')
  git(['add', '.'], repoPath)
  git(['commit', '-m', 'top baseline'], repoPath)
  git(['branch', '-M', 'main'], repoPath)
  git(['remote', 'add', 'origin', remote], repoPath)
}

function initNestedRepo(repoPath, { remote }) {
  fs.mkdirSync(repoPath, { recursive: true })
  git(['init'], repoPath)
  git(['config', 'user.name', 'Codex Browser Test'], repoPath)
  git(['config', 'user.email', 'codex-browser-test@example.com'], repoPath)
  fs.writeFileSync(path.join(repoPath, 'nested.txt'), 'nested clean\n')
  git(['add', '.'], repoPath)
  git(['commit', '-m', 'nested baseline'], repoPath)
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

async function createHome() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-startup-browser-'))
  const fakeUserHome = path.join(root, 'user')
  const pinokioHome = path.join(root, 'pinokio')
  const apiRoot = path.join(pinokioHome, 'api')
  const workspaceName = 'browser-fixture'
  const workspace = path.join(apiRoot, workspaceName)
  const nested = path.join(workspace, 'nested')
  await fsp.mkdir(fakeUserHome, { recursive: true })
  await fsp.mkdir(apiRoot, { recursive: true })
  const runtimeBin = path.resolve(process.env.PINOKIO_REAL_BROWSER_BIN || path.join(os.homedir(), 'pinokio', 'bin'))
  if (fs.existsSync(runtimeBin)) {
    await fsp.symlink(runtimeBin, path.join(pinokioHome, 'bin'), 'dir')
  }
  initAppRepo(workspace, { remote: 'https://example.com/pinokio-browser-fixture.git' })
  initNestedRepo(nested, { remote: 'https://example.com/pinokio-browser-fixture-nested.git' })
  return { root, fakeUserHome, pinokioHome, workspaceName, workspace, nested }
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

async function withBrowserServer(callback) {
  const home = await createHome()
  const port = await freePort()
  const artifacts = path.join(outputRoot, `${Date.now()}-changes-ui`)
  await fsp.mkdir(artifacts, { recursive: true })
  const child = childProcess.spawn(process.execPath, [
    __filename,
    '--server',
    '--port',
    String(port),
    '--home',
    home.pinokioHome,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home.fakeUserHome,
      PINOKIO_HOME: home.pinokioHome,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))

  const playwright = loadPlaywright()
  const executablePath = chromiumExecutablePath(playwright)
  assert.ok(executablePath, 'No Chromium executable is available for Browser verification')
  let browser
  let page
  try {
    await waitForReady(child)
    browser = await playwright.chromium.launch({ headless: true, executablePath })
    page = await browser.newPage()
    page.setDefaultTimeout(20000)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message || String(error)))
    await callback({
      ...home,
      baseUrl: `http://127.0.0.1:${port}`,
      artifacts,
      page,
    })
    assert.deepEqual(pageErrors, [])
    await fsp.writeFile(path.join(artifacts, 'server.log'), logs.join(''))
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
      await fsp.writeFile(path.join(artifacts, 'body.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => {})
    }
    await fsp.writeFile(path.join(artifacts, 'server.log'), logs.join('')).catch(() => {})
    error.message = `${error.message}\nartifacts: ${artifacts}`
    throw error
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
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
    await fsp.rm(home.root, { recursive: true, force: true })
  }
}

async function main() {
  await withBrowserServer(async ({ page, baseUrl, workspaceName, workspace, nested, artifacts }) => {
    await page.goto(`${baseUrl}/p/${workspaceName}/files`, { waitUntil: 'domcontentloaded' })
    await page.locator('#fs-status').waitFor({ state: 'visible' })
    await page.screenshot({ path: path.join(artifacts, 'initial.png'), fullPage: true })

    await fsp.writeFile(path.join(workspace, 'tracked.txt'), 'top clean\ntop dirty\n')
    await fsp.writeFile(path.join(nested, 'nested.txt'), 'nested clean\nnested dirty\n')

    await page.locator('#fs-changes-btn').click()
    await page.locator('#fs-changes-btn .badge').waitFor({ state: 'visible' })
    await page.waitForFunction(() => {
      const badge = document.querySelector('#fs-changes-btn .badge')
      return badge && badge.textContent && badge.textContent.trim() === '2'
    }, null, { timeout: 15000 })

    const topRepoItem = page.locator(`#fs-changes-menu .git-changes-item[data-repo="${workspaceName}"]`)
    const nestedRepoItem = page.locator(`#fs-changes-menu .git-changes-item[data-repo="${workspaceName}/nested"]`)
    await topRepoItem.waitFor()
    await nestedRepoItem.waitFor()
    await page.screenshot({ path: path.join(artifacts, 'changes-expanded.png'), fullPage: true })

    await topRepoItem.click()
    await page.locator('.pinokio-diff-modal').waitFor({ state: 'visible' })
    await page.locator('.pinokio-git-diff-file-item-row[data-filepath="tracked.txt"]').click()
    await page.locator('.pinokio-git-diff-viewer-panel').getByText('top dirty').waitFor()
    await page.screenshot({ path: path.join(artifacts, 'top-diff.png'), fullPage: true })

    const closeButton = page.locator('.swal2-close')
    if (await closeButton.count()) {
      await closeButton.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await page.locator('.pinokio-diff-modal').waitFor({ state: 'hidden' }).catch(() => {})
    await page.locator('#fs-changes-btn').click()
    const nestedRepoItemAfterModal = page.locator(`#fs-changes-menu .git-changes-item[data-repo="${workspaceName}/nested"]`)
    await nestedRepoItemAfterModal.waitFor({ state: 'visible' })
    await nestedRepoItemAfterModal.click()
    await page.locator('.pinokio-diff-modal').waitFor({ state: 'visible' })
    await page.locator('.pinokio-git-diff-file-item-row[data-filepath="nested.txt"]').click()
    await page.locator('.pinokio-git-diff-viewer-panel').getByText('nested dirty').waitFor()
    await page.screenshot({ path: path.join(artifacts, 'nested-diff.png'), fullPage: true })

    console.log(JSON.stringify({ ok: true, artifacts }))
  })
}

if (serverMode) {
  runServerMode().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
} else {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}
