#!/usr/bin/env node

const fs = require('node:fs')
const fsp = fs.promises
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')

const ignore = require('ignore')

const CURRENT_GITIGNORE_SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', 'venv', '.venv'])
const CURRENT_REPO_SCAN_SKIP_DIRS = new Set(['node_modules', 'venv'])

const GIT_STATUS_IGNORE_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.ruff_cache\//,
  /(^|\/)\.tox\//,
  /(^|\/)\.terraform\//,
  /(^|\/)\.parcel-cache\//,
  /(^|\/)\.webpack\//,
  /(^|\/)\.mypy_cache\//,
  /(^|\/)\.pytest_cache\//,
  /(^|\/)\.git\//,
]

function usage() {
  return [
    'Usage: node test/workspace-gitignore-benchmark.js [options]',
    '',
    'Options:',
    '  --api-root <path>       API root. Defaults to $PINOKIO_API_ROOT or ~/pinokio/api.',
    '  --apps <list>           Comma-separated top-level app folders. Defaults to all folders.',
    '  --max-apps <n>          Limit number of app folders after sorting.',
    '  --out <path>            Output JSON path. Defaults to ~/.codex/benchmarks/pinokiod-gitignore/gitignore-<timestamp>.json.',
    '  --markdown-out <path>   Output Markdown summary path. Defaults to JSON path with .md extension.',
    '  --no-markdown           Do not write a Markdown summary.',
    '  --help                  Show this help.',
    '',
    'This is a focused component benchmark for replacing the workspace .gitignore pre-scan.',
    'It does not prove the runtime route no longer calls the pre-scan; route instrumentation must verify that after implementation.',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    apiRoot: process.env.PINOKIO_API_ROOT || path.join(os.homedir(), 'pinokio', 'api'),
    apps: null,
    maxApps: null,
    out: null,
    markdownOut: null,
    noMarkdown: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`${arg} requires a value`)
      return argv[i]
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--api-root') {
      args.apiRoot = path.resolve(next())
    } else if (arg === '--apps') {
      args.apps = next().split(',').map((item) => item.trim()).filter(Boolean)
    } else if (arg === '--max-apps') {
      args.maxApps = Number.parseInt(next(), 10)
    } else if (arg === '--out') {
      args.out = path.resolve(next())
    } else if (arg === '--markdown-out') {
      args.markdownOut = path.resolve(next())
    } else if (arg === '--no-markdown') {
      args.noMarkdown = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (args.maxApps != null && (!Number.isInteger(args.maxApps) || args.maxApps < 1)) {
    throw new Error('--max-apps must be a positive integer')
  }

  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    args.out = path.join(os.homedir(), '.codex', 'benchmarks', 'pinokiod-gitignore', `gitignore-${stamp}.json`)
  }

  if (!args.markdownOut && !args.noMarkdown) {
    args.markdownOut = args.out.replace(/\.json$/i, '.md')
    if (args.markdownOut === args.out) {
      args.markdownOut = `${args.out}.md`
    }
  }

  return args
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/')
}

function posixRelative(from, to) {
  return normalizePath(path.relative(from, to))
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = performance.now()
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let done = false
    const timeoutMs = options.timeout || 30000
    const timeout = setTimeout(() => {
      if (!done) {
        child.kill('SIGKILL')
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > (options.maxBuffer || 50 * 1024 * 1024)) {
        child.kill('SIGKILL')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.stdin.on('error', () => {
      // Some git commands can close stdin before Node finishes writing a large batch.
      // The process exit code and captured output are the source of truth.
    })
    child.on('error', (error) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      resolve({
        ok: false,
        code: 1,
        error: error ? (error.message || String(error)) : null,
        stdout,
        stderr,
        ms: performance.now() - started,
      })
    })
    child.on('close', (code, signal) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      resolve({
        ok: code === 0,
        code: typeof code === 'number' ? code : 1,
        signal,
        error: code === 0 ? null : `Command exited with code ${code}${signal ? ` signal ${signal}` : ''}`,
        stdout,
        stderr,
        ms: performance.now() - started,
      })
    })
    if (options.input != null) {
      child.stdin.end(options.input)
    } else {
      child.stdin.end()
    }
  })
}

function createEmptyWalkMetrics() {
  return {
    ms: 0,
    dirs: 0,
    readdir: 0,
    readdirEntries: 0,
    readFile: 0,
    readFileBytes: 0,
    gitignoreFiles: 0,
    errors: 0,
  }
}

async function buildCurrentWorkspaceIgnoreEngine(workspaceRoot) {
  const metrics = createEmptyWalkMetrics()
  const engine = ignore()
  const gitignoreFiles = []
  const started = performance.now()

  async function walk(dir) {
    metrics.dirs += 1
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
      metrics.readdir += 1
      metrics.readdirEntries += entries.length
    } catch (_) {
      metrics.errors += 1
      return
    }

    for (const entry of entries) {
      const child = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (CURRENT_GITIGNORE_SCAN_SKIP_DIRS.has(entry.name)) {
          continue
        }
        await walk(child)
      } else if (entry.isFile() && entry.name === '.gitignore') {
        gitignoreFiles.push(child)
      }
    }
  }

  await walk(workspaceRoot)

  for (const gitignorePath of gitignoreFiles) {
    let content
    try {
      content = await fsp.readFile(gitignorePath, 'utf8')
      metrics.readFile += 1
      metrics.readFileBytes += Buffer.byteLength(content)
      metrics.gitignoreFiles += 1
    } catch (_) {
      metrics.errors += 1
      continue
    }

    addGitignoreContent(engine, workspaceRoot, gitignorePath, content)
  }

  metrics.ms = performance.now() - started
  return { engine, metrics, gitignoreFiles }
}

function addGitignoreContent(engine, root, gitignorePath, content) {
  const relDir = path.relative(root, path.dirname(gitignorePath))
  const prefix = relDir && relDir !== '.' ? normalizePath(relDir) + '/' : ''
  for (let line of content.split(/\r?\n/)) {
    if (!line) continue
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    let negated = false
    if (line.startsWith('!')) {
      negated = true
      line = line.slice(1)
    }
    line = line.replace(/^\/+/, '')
    if (!line) continue
    const pattern = prefix + line
    engine.add((negated ? '!' : '') + pattern)
  }
}

async function candidateIgnoredByPathScopedGitignores(workspaceRoot, records) {
  const ignored = new Set()
  const contentCache = new Map()
  const metrics = {
    ms: 0,
    checked: records.length,
    readFile: 0,
    readFileBytes: 0,
  }
  const started = performance.now()

  const readGitignore = async (gitignorePath) => {
    if (contentCache.has(gitignorePath)) {
      return contentCache.get(gitignorePath)
    }
    try {
      const content = await fsp.readFile(gitignorePath, 'utf8')
      contentCache.set(gitignorePath, content)
      metrics.readFile += 1
      metrics.readFileBytes += Buffer.byteLength(content)
      return content
    } catch (_) {
      contentCache.set(gitignorePath, null)
      return null
    }
  }

  for (const record of records) {
    const engine = ignore()
    const workspaceRelative = normalizePath(record.workspaceRelative)
    const parts = workspaceRelative.split('/').filter(Boolean)
    let stopped = false

    for (let depth = 0; depth < parts.length; depth++) {
      const relDir = depth === 0 ? '' : parts.slice(0, depth).join('/')
      const gitignorePath = path.join(workspaceRoot, relDir, '.gitignore')
      const content = await readGitignore(gitignorePath)
      if (content) {
        addGitignoreContent(engine, workspaceRoot, gitignorePath, content)
      }

      const nextPart = parts[depth]
      if (CURRENT_GITIGNORE_SCAN_SKIP_DIRS.has(nextPart)) {
        stopped = true
        break
      }
    }

    if (!stopped || parts.length > 0) {
      if (workspaceRelative && engine.ignores(workspaceRelative)) {
        ignored.add(record.key)
      }
    }
  }

  metrics.ms = performance.now() - started
  return { ignored, metrics }
}

async function discoverReposCurrentStyle(workspaceRoot) {
  const metrics = {
    ms: 0,
    dirs: 0,
    readdir: 0,
    readdirEntries: 0,
    gitDirs: 0,
    errors: 0,
  }
  const repos = []
  const started = performance.now()

  async function walk(dir) {
    metrics.dirs += 1
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
      metrics.readdir += 1
      metrics.readdirEntries += entries.length
    } catch (_) {
      metrics.errors += 1
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      if (entry.name === '.git') {
        repos.push(path.dirname(child))
        metrics.gitDirs += 1
        continue
      }
      if (CURRENT_REPO_SCAN_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue
      }
      await walk(child)
    }
  }

  await walk(workspaceRoot)
  metrics.ms = performance.now() - started
  return { repos, metrics }
}

function extractGitStatusPath(statusLine) {
  if (!statusLine || statusLine.length < 4) return ''
  const rest = statusLine.slice(3)
  const renameIdx = rest.indexOf(' -> ')
  const candidate = renameIdx === -1 ? rest : rest.slice(renameIdx + 4)
  return candidate.replace(/^"|"$/g, '')
}

async function gitStatusRecords(workspaceRoot, repoRoot) {
  const result = await execFileText('git', [
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ], {
    cwd: repoRoot,
    timeout: 30000,
  })

  const records = []
  if (!result.ok) {
    return { records, metrics: { ms: result.ms, ok: false, error: result.error } }
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line || line.length < 4) continue
    const repoRelative = normalizePath(extractGitStatusPath(line))
    if (!repoRelative) continue
    const absolutePath = path.resolve(repoRoot, repoRelative)
    records.push({
      key: `${repoRoot}\0${repoRelative}`,
      statusCode: line.slice(0, 2),
      repoRoot,
      repoRelative,
      absolutePath,
      workspaceRelative: posixRelative(workspaceRoot, absolutePath),
      rawLine: line,
    })
  }

  return { records, metrics: { ms: result.ms, ok: true, error: null } }
}

function isHardcodedStatusIgnored(relativePath) {
  if (!relativePath) return false
  const normalized = normalizePath(relativePath)
  if (GIT_STATUS_IGNORE_PATTERNS.some((regex) => regex.test(normalized) || regex.test(`${normalized}/`))) {
    return true
  }
  if (normalized.includes('/site-packages/')) return true
  if (normalized.includes('/Scripts/')) return true
  if (normalized.includes('/bin/activate')) return true
  return false
}


function currentEngineIgnored(engine, records) {
  const ignored = new Set()
  const started = performance.now()
  for (const record of records) {
    const workspaceRelative = normalizePath(record.workspaceRelative)
    if (workspaceRelative && engine.ignores(workspaceRelative)) {
      ignored.add(record.key)
    }
  }
  return { ignored, metrics: { ms: performance.now() - started } }
}

function compareSets(left, right) {
  const onlyLeft = []
  const onlyRight = []
  for (const value of left) {
    if (!right.has(value)) onlyLeft.push(value)
  }
  for (const value of right) {
    if (!left.has(value)) onlyRight.push(value)
  }
  return { onlyLeft, onlyRight, same: onlyLeft.length === 0 && onlyRight.length === 0 }
}

async function listAppFolders(apiRoot, selectedApps, maxApps) {
  const entries = await fsp.readdir(apiRoot, { withFileTypes: true })
  let apps = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  if (selectedApps && selectedApps.length > 0) {
    const selected = new Set(selectedApps)
    apps = apps.filter((app) => selected.has(app))
  }
  if (maxApps) {
    apps = apps.slice(0, maxApps)
  }
  return apps
}

async function measureWorkspace(apiRoot, appName) {
  const workspaceRoot = path.join(apiRoot, appName)
  const workspaceStarted = performance.now()

  const currentPreScan = await buildCurrentWorkspaceIgnoreEngine(workspaceRoot)
  const repoDiscovery = await discoverReposCurrentStyle(workspaceRoot)

  const statusStarted = performance.now()
  const records = []
  const statusErrors = []
  let statusMs = 0
  for (const repoRoot of repoDiscovery.repos) {
    const status = await gitStatusRecords(workspaceRoot, repoRoot)
    statusMs += status.metrics.ms
    records.push(...status.records)
    if (!status.metrics.ok) {
      statusErrors.push({ repoRoot, error: status.metrics.error })
    }
  }
  const statusWallMs = performance.now() - statusStarted

  const hardcodedIgnored = new Set()
  for (const record of records) {
    if (isHardcodedStatusIgnored(record.repoRelative)) {
      hardcodedIgnored.add(record.key)
    }
  }

  const currentFilter = currentEngineIgnored(currentPreScan.engine, records)
  const candidateInputRecords = records.filter((record) => !hardcodedIgnored.has(record.key))
  const candidateFilter = await candidateIgnoredByPathScopedGitignores(workspaceRoot, candidateInputRecords)

  const currentFinalIgnored = new Set([...currentFilter.ignored, ...hardcodedIgnored])
  const candidateFinalIgnored = new Set([...candidateFilter.ignored, ...hardcodedIgnored])
  const comparison = compareSets(currentFinalIgnored, candidateFinalIgnored)
  const byKey = new Map(records.map((record) => [record.key, record]))
  const sampleFor = (keys) => keys.slice(0, 20).map((key) => {
    const record = byKey.get(key)
    return record ? {
      repo: posixRelative(apiRoot, record.repoRoot),
      file: record.repoRelative,
      workspaceRelative: record.workspaceRelative,
      statusCode: record.statusCode,
    } : { key }
  })

  return {
    app: appName,
    workspaceRoot,
    ok: true,
    wallMs: performance.now() - workspaceStarted,
    currentPreScan: currentPreScan.metrics,
    repoDiscovery: {
      ...repoDiscovery.metrics,
      repos: repoDiscovery.repos.length,
    },
    gitStatus: {
      ms: statusMs,
      wallMs: statusWallMs,
      records: records.length,
      errors: statusErrors,
    },
    currentFilter: {
      ...currentFilter.metrics,
      ignored: currentFilter.ignored.size,
      kept: records.length - currentFilter.ignored.size,
    },
    candidateFilter: {
      ...candidateFilter.metrics,
      checked: candidateInputRecords.length,
      ignored: candidateFilter.ignored.size,
      finalIgnored: candidateFinalIgnored.size,
      finalKept: records.length - candidateFinalIgnored.size,
    },
    hardcodedFilter: {
      ignored: hardcodedIgnored.size,
      keptAfterCurrentAndHardcoded: records.filter((record) => (
        !currentFilter.ignored.has(record.key) && !hardcodedIgnored.has(record.key)
      )).length,
      keptAfterCandidateAndHardcoded: records.filter((record) => (
        !candidateFilter.ignored.has(record.key) && !hardcodedIgnored.has(record.key)
      )).length,
    },
    parity: {
      same: comparison.same,
      onlyCurrentIgnored: comparison.onlyLeft.length,
      onlyCandidateIgnored: comparison.onlyRight.length,
      onlyCurrentIgnoredSample: sampleFor(comparison.onlyLeft),
      onlyCandidateIgnoredSample: sampleFor(comparison.onlyRight),
    },
  }
}

function summarize(rows) {
  const totals = {
    apps: rows.length,
    okApps: rows.filter((row) => row.ok).length,
    currentPreScanMs: 0,
    currentPreScanDirs: 0,
    currentPreScanEntries: 0,
    currentPreScanGitignoreFiles: 0,
    repoDiscoveryMs: 0,
    repoDiscoveryDirs: 0,
    repoDiscoveryEntries: 0,
    repos: 0,
    gitStatusRecords: 0,
    currentIgnored: 0,
    candidateIgnored: 0,
    hardcodedIgnored: 0,
    candidateChecked: 0,
    candidateFilterMs: 0,
    finalCurrentKept: 0,
    finalCandidateKept: 0,
    parityMismatchedApps: 0,
    parityOnlyCurrentIgnored: 0,
    parityOnlyCandidateIgnored: 0,
  }

  for (const row of rows) {
    if (!row.ok) continue
    totals.currentPreScanMs += row.currentPreScan.ms
    totals.currentPreScanDirs += row.currentPreScan.dirs
    totals.currentPreScanEntries += row.currentPreScan.readdirEntries
    totals.currentPreScanGitignoreFiles += row.currentPreScan.gitignoreFiles
    totals.repoDiscoveryMs += row.repoDiscovery.ms
    totals.repoDiscoveryDirs += row.repoDiscovery.dirs
    totals.repoDiscoveryEntries += row.repoDiscovery.readdirEntries
    totals.repos += row.repoDiscovery.repos
    totals.gitStatusRecords += row.gitStatus.records
    totals.currentIgnored += row.currentFilter.ignored
    totals.candidateIgnored += row.candidateFilter.ignored
    totals.hardcodedIgnored += row.hardcodedFilter.ignored
    totals.candidateChecked += row.candidateFilter.checked
    totals.candidateFilterMs += row.candidateFilter.ms
    totals.finalCurrentKept += row.hardcodedFilter.keptAfterCurrentAndHardcoded
    totals.finalCandidateKept += row.candidateFilter.finalKept
    if (!row.parity.same) {
      totals.parityMismatchedApps += 1
      totals.parityOnlyCurrentIgnored += row.parity.onlyCurrentIgnored
      totals.parityOnlyCandidateIgnored += row.parity.onlyCandidateIgnored
    }
  }

  return {
    totals,
    topByCurrentPreScanMs: rows.filter((row) => row.ok).slice().sort((a, b) => b.currentPreScan.ms - a.currentPreScan.ms).slice(0, 20).map(summaryRow),
    topByRepoDiscoveryMs: rows.filter((row) => row.ok).slice().sort((a, b) => b.repoDiscovery.ms - a.repoDiscovery.ms).slice(0, 20).map(summaryRow),
    parityMismatches: rows.filter((row) => row.ok && !row.parity.same).map((row) => ({
      app: row.app,
      onlyCurrentIgnored: row.parity.onlyCurrentIgnored,
      onlyCandidateIgnored: row.parity.onlyCandidateIgnored,
      onlyCurrentIgnoredSample: row.parity.onlyCurrentIgnoredSample,
      onlyCandidateIgnoredSample: row.parity.onlyCandidateIgnoredSample,
    })),
  }
}

function summaryRow(row) {
  return {
    app: row.app,
    currentPreScanMs: Number(row.currentPreScan.ms.toFixed(1)),
    currentPreScanDirs: row.currentPreScan.dirs,
    currentPreScanEntries: row.currentPreScan.readdirEntries,
    gitignoreFiles: row.currentPreScan.gitignoreFiles,
    repoDiscoveryMs: Number(row.repoDiscovery.ms.toFixed(1)),
    repos: row.repoDiscovery.repos,
    statusRecords: row.gitStatus.records,
    currentIgnored: row.currentFilter.ignored,
    hardcodedIgnored: row.hardcodedFilter.ignored,
    candidateChecked: row.candidateFilter.checked,
    candidateIgnored: row.candidateFilter.ignored,
    candidateFinalKept: row.candidateFilter.finalKept,
    candidateFilterMs: Number(row.candidateFilter.ms.toFixed(1)),
    paritySame: row.parity.same,
    mismatchCount: row.parity.onlyCurrentIgnored + row.parity.onlyCandidateIgnored,
  }
}

function markdownTable(rows) {
  const header = [
    '| App | Current pre-scan ms | Dirs | Entries | .gitignore files | Repo scan ms | Repos | Status paths | Hardcoded ignored | Candidate checked | Current gitignored | Candidate gitignored | Final kept | Candidate filter ms | Mismatches |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  const body = rows.map((row) => [
    `| \`${row.app}\``,
    Number(row.currentPreScan.ms).toFixed(1),
    row.currentPreScan.dirs,
    row.currentPreScan.readdirEntries,
    row.currentPreScan.gitignoreFiles,
    Number(row.repoDiscovery.ms).toFixed(1),
    row.repoDiscovery.repos,
    row.gitStatus.records,
    row.hardcodedFilter.ignored,
    row.candidateFilter.checked,
    row.currentFilter.ignored,
    row.candidateFilter.ignored,
    row.candidateFilter.finalKept,
    Number(row.candidateFilter.ms).toFixed(1),
    row.parity.onlyCurrentIgnored + row.parity.onlyCandidateIgnored,
  ].join(' | ') + ' |')
  return header.concat(body).join('\n')
}

function renderMarkdown(report) {
  const rows = report.rows.filter((row) => row.ok).slice().sort((a, b) => b.currentPreScan.ms - a.currentPreScan.ms)
  const totals = report.summary.totals
  const lines = []
  lines.push(`# Workspace Gitignore Benchmark`)
  lines.push('')
  lines.push(`Created: ${report.createdAt}`)
  lines.push(`API root: \`${report.apiRoot}\``)
  lines.push(`Apps measured: ${totals.okApps}/${totals.apps}`)
  lines.push('')
  lines.push(`## Totals`)
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('| --- | ---: |')
  lines.push(`| Current recursive pre-scan wall time | ${totals.currentPreScanMs.toFixed(1)} ms |`)
  lines.push(`| Current recursive pre-scan dirs | ${totals.currentPreScanDirs} |`)
  lines.push(`| Current recursive pre-scan entries | ${totals.currentPreScanEntries} |`)
  lines.push(`| Current .gitignore files read | ${totals.currentPreScanGitignoreFiles} |`)
  lines.push(`| Current repo discovery wall time | ${totals.repoDiscoveryMs.toFixed(1)} ms |`)
  lines.push(`| Current repo discovery dirs | ${totals.repoDiscoveryDirs} |`)
  lines.push(`| Current repo discovery entries | ${totals.repoDiscoveryEntries} |`)
  lines.push(`| Repos discovered | ${totals.repos} |`)
  lines.push(`| Raw git status paths | ${totals.gitStatusRecords} |`)
  lines.push(`| Current JS ignore-filter ignored paths | ${totals.currentIgnored} |`)
  lines.push(`| Hard-coded ignored paths | ${totals.hardcodedIgnored} |`)
  lines.push(`| Candidate paths checked after hard-coded prefilter | ${totals.candidateChecked} |`)
  lines.push(`| Candidate path-scoped ignored paths | ${totals.candidateIgnored} |`)
  lines.push(`| Final current kept paths | ${totals.finalCurrentKept} |`)
  lines.push(`| Final candidate kept paths | ${totals.finalCandidateKept} |`)
  lines.push(`| Candidate ignore-filter wall time | ${totals.candidateFilterMs.toFixed(1)} ms |`)
  lines.push(`| Apps with filter mismatches | ${totals.parityMismatchedApps} |`)
  lines.push(`| Current-only ignored paths | ${totals.parityOnlyCurrentIgnored} |`)
  lines.push(`| Candidate-only ignored paths | ${totals.parityOnlyCandidateIgnored} |`)
  lines.push('')
  lines.push(`## Per-App Rows`)
  lines.push('')
  lines.push(markdownTable(rows))
  if (report.summary.parityMismatches.length > 0) {
    lines.push('')
    lines.push('## Parity Mismatches')
    lines.push('')
    for (const mismatch of report.summary.parityMismatches) {
      lines.push(`### ${mismatch.app}`)
      lines.push('')
      lines.push(`Current-only ignored: ${mismatch.onlyCurrentIgnored}`)
      lines.push(`Candidate-only ignored: ${mismatch.onlyCandidateIgnored}`)
      lines.push('')
      lines.push('Current-only sample:')
      lines.push('')
      lines.push('```json')
      lines.push(JSON.stringify(mismatch.onlyCurrentIgnoredSample, null, 2))
      lines.push('```')
      lines.push('')
      lines.push('Candidate-only sample:')
      lines.push('')
      lines.push('```json')
      lines.push(JSON.stringify(mismatch.onlyCandidateIgnoredSample, null, 2))
      lines.push('```')
      lines.push('')
    }
  }
  lines.push('')
  return lines.join('\n')
}

function gitCommit(repoRoot) {
  try {
    return fs.existsSync(path.join(repoRoot, '.git'))
      ? execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
      : null
  } catch (_) {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const repoRoot = path.resolve(__dirname, '..')
  const appNames = await listAppFolders(args.apiRoot, args.apps, args.maxApps)
  const rows = []

  for (const appName of appNames) {
    try {
      const row = await measureWorkspace(args.apiRoot, appName)
      rows.push(row)
      console.error(`${appName}: preScan=${row.currentPreScan.ms.toFixed(1)}ms repoScan=${row.repoDiscovery.ms.toFixed(1)}ms statusPaths=${row.gitStatus.records} mismatches=${row.parity.onlyCurrentIgnored + row.parity.onlyCandidateIgnored}`)
    } catch (error) {
      rows.push({
        app: appName,
        ok: false,
        error: error && error.stack ? error.stack : String(error),
      })
      console.error(`${appName}: failed: ${error && error.message ? error.message : error}`)
    }
  }

  const report = {
    kind: 'pinokiod-workspace-gitignore-component-benchmark',
    createdAt: new Date().toISOString(),
    repoRoot,
    commit: gitCommit(repoRoot),
    node: process.version,
    platform: process.platform,
    apiRoot: args.apiRoot,
    selectedApps: args.apps,
    maxApps: args.maxApps,
    notes: [
      'Current pre-scan mimics WorkspaceStatusManager.ensureGitIgnoreEngine().',
      'Current repo discovery approximates kernel.git.findGitDirs() for measurement only.',
      'Candidate filtering uses path-scoped .gitignore evaluation with the same parser rules as the current pre-scan.',
      'This benchmark measures component algorithms, not live route integration.',
    ],
    rows,
    summary: null,
  }
  report.summary = summarize(rows)

  await fsp.mkdir(path.dirname(args.out), { recursive: true })
  await fsp.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(args.out)

  if (!args.noMarkdown && args.markdownOut) {
    await fsp.mkdir(path.dirname(args.markdownOut), { recursive: true })
    await fsp.writeFile(args.markdownOut, renderMarkdown(report))
    console.log(args.markdownOut)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
}

module.exports = {
  buildCurrentWorkspaceIgnoreEngine,
  candidateIgnoredByPathScopedGitignores,
  compareSets,
  currentEngineIgnored,
  discoverReposCurrentStyle,
  gitStatusRecords,
  isHardcodedStatusIgnored,
  measureWorkspace,
  normalizePath,
}
