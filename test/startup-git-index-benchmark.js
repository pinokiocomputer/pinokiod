#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')

const Git = require('../kernel/git')
const WorkspaceStatusManager = require('../kernel/workspace_status')

const FS_METHODS = ['readdir', 'readFile', 'stat', 'lstat', 'access']

function usage() {
  return [
    'Usage: node test/startup-git-index-benchmark.js [options]',
    '',
    'Options:',
    '  --home <path>          Pinokio home. Defaults to $PINOKIO_HOME or ~/pinokio.',
    '  --api-root <path>      API root. Defaults to <home>/api.',
    '  --iterations <n>       Iterations per case. Defaults to 3.',
    '  --cases <list>         Comma-separated cases. Defaults to git.index,workspace.ensureWatcher(api).',
    '  --out <path>           Output JSON path. Defaults to ~/.codex/benchmarks/pinokiod-startup/focused-<timestamp>.json.',
    '  --disk <device>        Also sample system-wide iostat for the device, for example disk0.',
    '  --help                 Show this help.',
    '',
    'This is a focused component benchmark. After the refactor, direct git.index() may still be slow;',
    'the startup-path proof must separately show startup no longer calls it.',
  ].join('\n')
}

function parseArgs(argv) {
  const args = {
    home: process.env.PINOKIO_HOME || path.join(os.homedir(), 'pinokio'),
    apiRoot: null,
    iterations: 3,
    cases: ['git.index', 'workspace.ensureWatcher(api)'],
    out: null,
    disk: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) {
        throw new Error(`${arg} requires a value`)
      }
      return argv[i]
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--home') {
      args.home = path.resolve(next())
    } else if (arg === '--api-root') {
      args.apiRoot = path.resolve(next())
    } else if (arg === '--iterations') {
      args.iterations = Number.parseInt(next(), 10)
    } else if (arg === '--cases') {
      args.cases = next().split(',').map((item) => item.trim()).filter(Boolean)
    } else if (arg === '--out') {
      args.out = path.resolve(next())
    } else if (arg === '--disk') {
      args.disk = next()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!args.apiRoot) {
    args.apiRoot = path.join(args.home, 'api')
  }
  if (!Number.isInteger(args.iterations) || args.iterations < 1) {
    throw new Error('--iterations must be a positive integer')
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    args.out = path.join(os.homedir(), '.codex', 'benchmarks', 'pinokiod-startup', `focused-${stamp}.json`)
  }
  return args
}

function makeEmptyFsStats() {
  const byMethod = {}
  for (const method of FS_METHODS) {
    byMethod[method] = { count: 0, errors: 0, timeMs: 0 }
  }
  return {
    byMethod,
    readdirEntries: 0,
    readFileBytes: 0,
    gitignoreReadFiles: 0,
    gitignoreReadBytes: 0,
    errorCodes: {},
  }
}

function installFsInstrumentation() {
  const originals = {}
  let current = null

  for (const method of FS_METHODS) {
    originals[method] = fs.promises[method]
    fs.promises[method] = async function instrumentedFsMethod(...args) {
      const stats = current
      const started = performance.now()
      try {
        const result = await originals[method].apply(this, args)
        if (stats) {
          const bucket = stats.byMethod[method]
          bucket.count += 1
          bucket.timeMs += performance.now() - started
          if (method === 'readdir' && Array.isArray(result)) {
            stats.readdirEntries += result.length
          } else if (method === 'readFile') {
            const byteLength = Buffer.isBuffer(result) ? result.length : Buffer.byteLength(String(result))
            stats.readFileBytes += byteLength
            if (path.basename(String(args[0])) === '.gitignore') {
              stats.gitignoreReadFiles += 1
              stats.gitignoreReadBytes += byteLength
            }
          }
        }
        return result
      } catch (error) {
        if (stats) {
          const bucket = stats.byMethod[method]
          bucket.count += 1
          bucket.errors += 1
          bucket.timeMs += performance.now() - started
          const code = error && error.code ? error.code : 'UNKNOWN'
          stats.errorCodes[code] = (stats.errorCodes[code] || 0) + 1
        }
        throw error
      }
    }
  }

  return {
    runWithStats: async (fn) => {
      const stats = makeEmptyFsStats()
      current = stats
      try {
        const payload = await fn()
        return { stats, payload }
      } finally {
        current = null
      }
    },
    restore: () => {
      for (const method of FS_METHODS) {
        fs.promises[method] = originals[method]
      }
    },
  }
}

function createKernel(home, apiRoot) {
  const kernel = {
    homedir: home,
    envs: { ...process.env },
    path: (...parts) => {
      if (parts[0] === 'api') {
        return path.join(apiRoot, ...parts.slice(1))
      }
      return path.join(home, ...parts)
    },
  }
  kernel.git = new Git(kernel)
  return kernel
}

function resourceSnapshot() {
  return {
    usage: process.resourceUsage(),
    memory: process.memoryUsage(),
  }
}

function resourceDelta(before, after) {
  return {
    userCpuMs: (after.usage.userCPUTime - before.usage.userCPUTime) / 1000,
    systemCpuMs: (after.usage.systemCPUTime - before.usage.systemCPUTime) / 1000,
    fsRead: after.usage.fsRead - before.usage.fsRead,
    fsWrite: after.usage.fsWrite - before.usage.fsWrite,
    majorPageFault: after.usage.majorPageFault - before.usage.majorPageFault,
    minorPageFault: after.usage.minorPageFault - before.usage.minorPageFault,
    voluntaryContextSwitches: after.usage.voluntaryContextSwitches - before.usage.voluntaryContextSwitches,
    involuntaryContextSwitches: after.usage.involuntaryContextSwitches - before.usage.involuntaryContextSwitches,
    maxRSSKb: after.usage.maxRSS,
    rssBeforeBytes: before.memory.rss,
    rssAfterBytes: after.memory.rss,
    heapUsedBeforeBytes: before.memory.heapUsed,
    heapUsedAfterBytes: after.memory.heapUsed,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withIostat(device, fn) {
  if (!device) {
    return { result: await fn(), iostat: null, rawIostat: null }
  }

  const child = spawn('iostat', ['-Id', device, '1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  await sleep(1200)
  let result
  try {
    result = await fn()
  } finally {
    child.kill('SIGINT')
    await new Promise((resolve) => child.once('close', resolve))
  }

  if (stderr.trim()) {
    stdout += `\n[stderr]\n${stderr}`
  }
  return { result, iostat: parseIostat(stdout), rawIostat: stdout }
}

function parseIostat(raw) {
  const rows = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.includes('KB/t') || trimmed.includes('disk')) {
      continue
    }
    const match = trimmed.match(/^([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)$/)
    if (!match) {
      continue
    }
    rows.push({
      kbPerTransfer: Number(match[1]),
      transfers: Number(match[2]),
      mb: Number(match[3]),
    })
  }
  const intervalSamples = rows.slice(1)
  const totalMb = intervalSamples.reduce((sum, sample) => sum + sample.mb, 0)
  const maxMbPerSec = intervalSamples.reduce((max, sample) => Math.max(max, sample.mb), 0)
  const avgMbPerSec = intervalSamples.length ? totalMb / intervalSamples.length : 0
  return {
    rawSampleCount: rows.length,
    intervalSampleCount: intervalSamples.length,
    totalMb,
    totalTransfers: intervalSamples.reduce((sum, sample) => sum + sample.transfers, 0),
    maxMbPerSec,
    avgMbPerSec,
    intervalSamples,
  }
}

async function cleanupWatchers(manager) {
  for (const subscription of manager.watchers.values()) {
    if (subscription && typeof subscription.unsubscribe === 'function') {
      await subscription.unsubscribe()
    }
  }
}

async function runCase(name, context) {
  if (name === 'git.index') {
    const kernel = createKernel(context.home, context.apiRoot)
    await kernel.git.index(kernel)
    return {
      dirs: kernel.git.dirs.size,
      mappings: Object.keys(kernel.git.mapping).length,
    }
  }

  if (name === 'workspace.ensureWatcher(api)') {
    const manager = new WorkspaceStatusManager({ enableWatchers: true })
    try {
      await manager.ensureWatcher('api', context.apiRoot)
      return {
        watchers: manager.watchers.size,
        gitIgnoreEngines: manager.gitIgnoreEngines.size,
      }
    } finally {
      await cleanupWatchers(manager)
    }
  }

  throw new Error(`Unknown benchmark case: ${name}`)
}

async function measureOne(name, context, instrumentation) {
  const started = performance.now()
  const resourceBefore = resourceSnapshot()
  try {
    const { result, iostat, rawIostat } = await withIostat(context.disk, async () => (
      instrumentation.runWithStats(async () => runCase(name, context))
    ))
    const resourceAfter = resourceSnapshot()
    return {
      name,
      ok: true,
      error: null,
      metrics: {
        wallMs: performance.now() - started,
        ...resourceDelta(resourceBefore, resourceAfter),
      },
      fs: result.stats,
      iostat,
      rawIostat,
      payload: result.payload,
    }
  } catch (error) {
    const resourceAfter = resourceSnapshot()
    return {
      name,
      ok: false,
      error: error && error.stack ? error.stack : String(error),
      metrics: {
        wallMs: performance.now() - started,
        ...resourceDelta(resourceBefore, resourceAfter),
      },
      fs: makeEmptyFsStats(),
      iostat: null,
      rawIostat: null,
      payload: null,
    }
  }
}

function gitCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
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
  const context = {
    home: args.home,
    apiRoot: args.apiRoot,
    disk: args.disk,
  }
  const instrumentation = installFsInstrumentation()
  const results = []

  try {
    for (let iteration = 1; iteration <= args.iterations; iteration++) {
      for (const name of args.cases) {
        const test = await measureOne(name, context, instrumentation)
        results.push({ iteration, test })
        const readdir = test.fs && test.fs.byMethod && test.fs.byMethod.readdir
          ? test.fs.byMethod.readdir.count
          : 0
        console.error(`${name} iteration ${iteration}: ${test.ok ? 'ok' : 'failed'}, wallMs=${test.metrics.wallMs.toFixed(1)}, readdir=${readdir}`)
      }
    }
  } finally {
    instrumentation.restore()
  }

  const report = {
    kind: 'pinokiod-startup-focused-component-benchmark',
    createdAt: new Date().toISOString(),
    repoRoot,
    home: args.home,
    apiRoot: args.apiRoot,
    commit: gitCommit(repoRoot),
    node: process.version,
    platform: process.platform,
    iterations: args.iterations,
    cases: args.cases,
    diskDevice: args.disk,
    notes: [
      'This is a focused component benchmark, not proof that these operations run at startup.',
      'After the startup refactor, direct git.index() may remain expensive; startup-path instrumentation must prove startup no longer calls it.',
      args.disk ? 'iostat samples are system-wide, not process-scoped.' : 'No OS disk sampler was enabled.',
    ],
    results,
  }

  await fs.promises.mkdir(path.dirname(args.out), { recursive: true })
  await fs.promises.writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(args.out)
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
