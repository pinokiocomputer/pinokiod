const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const AppLogReportService = require('../server/lib/app_log_report')

const createRegistry = () => ({
  parseTailCount: (value, fallback) => Number.parseInt(value, 10) || fallback,
  async pathIsDirectory(targetPath) {
    try {
      return (await fs.stat(targetPath)).isDirectory()
    } catch (_) {
      return false
    }
  },
  isPathWithin(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath)
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
})

const createKernel = (home) => ({
  homedir: home,
  path: (...parts) => path.resolve(home, ...parts),
  exists: async (targetPath) => {
    try {
      await fs.access(targetPath)
      return true
    } catch (_) {
      return false
    }
  }
})

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2))
}

test('app log report reads the latest session manifest and ignores logs/api/**/latest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'demo')
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'start.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', '111'), 'session install log\n')
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', 'latest'), 'wrong latest install log\n')
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'start.js', 'latest'), 'wrong latest start log\n')
    await fs.mkdir(path.join(appRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(appRoot, '.git', 'config'), [
      '[remote "origin"]',
      '  url = https://token:secret@github.com/example/demo.git',
      ''
    ].join('\n'))

    await writeJson(path.join(appRoot, 'logs', 'sessions', 'index.json'), {
      version: 1,
      latest_session: 'session-1',
      sessions: [
        {
          id: 'session-1',
          created_at: '2026-07-02T22:10:15.123Z',
          updated_at: '2026-07-02T22:14:41.902Z',
          runs: ['install.js']
        }
      ]
    })
    await writeJson(path.join(appRoot, 'logs', 'sessions', 'session-1.json'), {
      version: 1,
      id: 'session-1',
      created_at: '2026-07-02T22:10:15.123Z',
      updated_at: '2026-07-02T22:14:41.902Z',
      runs: [
        {
          script: 'install.js',
          started_at: '2026-07-02T22:10:15.123Z',
          ended_at: '2026-07-02T22:12:02.551Z',
          logs: [
            { path: 'logs/api/install.js/111' }
          ]
        }
      ]
    })

    const service = new AppLogReportService({ registry: createRegistry() })
    const report = await service.buildReport({
      appId: 'demo',
      status: {
        path: appRoot,
        title: 'Demo'
      },
      redact: false
    })

    assert.equal(report.latest_session, 'session-1')
    assert.equal(report.session, 'session-1')
    assert.deepEqual(report.sessions.map((session) => session.id), ['session-1'])
    assert.deepEqual(report.sections.map((section) => section.file), [
      'logs/api/install.js/111'
    ])
    assert.equal(report.markdown.includes('session install log'), true)
    assert.equal(report.markdown.includes('wrong latest'), false)
    assert.equal(report.repo_url, 'https://github.com/example/demo.git')
    assert.equal(report.markdown.includes('token:secret'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app log report can select an older indexed session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'demo')
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'start.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', '111'), 'install log\n')
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'start.js', '222'), 'start log\n')

    await writeJson(path.join(appRoot, 'logs', 'sessions', 'index.json'), {
      version: 1,
      latest_session: 'session-2',
      sessions: [
        { id: 'session-2', created_at: '2026-07-02T22:20:00.000Z', updated_at: '2026-07-02T22:20:01.000Z', runs: ['start.js'] },
        { id: 'session-1', created_at: '2026-07-02T22:10:00.000Z', updated_at: '2026-07-02T22:10:01.000Z', runs: ['install.js'] }
      ]
    })
    await writeJson(path.join(appRoot, 'logs', 'sessions', 'session-1.json'), {
      version: 1,
      id: 'session-1',
      runs: [
        { script: 'install.js', logs: [{ path: 'logs/api/install.js/111' }] }
      ]
    })
    await writeJson(path.join(appRoot, 'logs', 'sessions', 'session-2.json'), {
      version: 1,
      id: 'session-2',
      runs: [
        { script: 'start.js', logs: [{ path: 'logs/api/start.js/222' }] }
      ]
    })

    const service = new AppLogReportService({ registry: createRegistry() })
    const report = await service.buildReport({
      appId: 'demo',
      status: { path: appRoot, title: 'Demo' },
      session: 'session-1',
      redact: false
    })

    assert.equal(report.latest_session, 'session-2')
    assert.equal(report.session, 'session-1')
    assert.deepEqual(report.sections.map((section) => section.file), [
      'logs/api/install.js/111'
    ])
    assert.equal(report.markdown.includes('install log'), true)
    assert.equal(report.markdown.includes('start log'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app log report reads sessions from the existing nested pinokio app root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'api', 'demo')
    const nestedRoot = path.join(appRoot, 'pinokio')
    await fs.mkdir(path.join(nestedRoot, 'logs', 'api', 'start.js'), { recursive: true })
    await fs.writeFile(path.join(nestedRoot, 'logs', 'api', 'start.js', '111'), `nested start log ${appRoot}\n${nestedRoot}\n`)

    await writeJson(path.join(nestedRoot, 'logs', 'sessions', 'index.json'), {
      version: 1,
      latest_session: 'session-1',
      sessions: [{ id: 'session-1', runs: ['start.js'] }]
    })
    await writeJson(path.join(nestedRoot, 'logs', 'sessions', 'session-1.json'), {
      version: 1,
      id: 'session-1',
      runs: [
        { script: 'start.js', logs: [{ path: 'logs/api/start.js/111' }] }
      ]
    })

    const service = new AppLogReportService({
      registry: createRegistry(),
      kernel: createKernel(root)
    })
    const report = await service.buildReport({
      appId: 'demo',
      status: { path: appRoot, title: 'Demo' }
    })

    assert.equal(report.session, 'session-1')
    assert.deepEqual(report.sections.map((section) => section.file), [
      'logs/api/start.js/111'
    ])
    assert.equal(report.markdown.includes('nested start log'), true)
    assert.equal(report.markdown.includes(appRoot), false)
    assert.equal(report.markdown.includes(nestedRoot), false)
    assert.equal(report.markdown.includes('[REDACTED_LOCAL_PATH]'), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app log report does not fall back to latest files when no session exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'demo')
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'start.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'start.js', 'latest'), 'latest only log\n')

    const service = new AppLogReportService({ registry: createRegistry() })
    const report = await service.buildReport({
      appId: 'demo',
      status: { path: appRoot, title: 'Demo' },
      redact: false
    })

    assert.equal(report.latest_session, null)
    assert.equal(report.session, null)
    assert.deepEqual(report.sessions, [])
    assert.deepEqual(report.sections, [])
    assert.equal(report.markdown.includes('latest only log'), false)
    assert.equal(report.markdown.includes('No session log bundle found.'), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('app log report rejects manifest paths outside the app log folder and logs/sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'demo')
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'start.js'), { recursive: true })
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'start.js', '111'), 'valid log\n')
    await fs.writeFile(path.join(appRoot, 'outside.txt'), 'outside log\n')

    await writeJson(path.join(appRoot, 'logs', 'sessions', 'index.json'), {
      version: 1,
      latest_session: 'session-1',
      sessions: [{ id: 'session-1', runs: ['start.js'] }]
    })
    await writeJson(path.join(appRoot, 'logs', 'sessions', 'session-1.json'), {
      version: 1,
      id: 'session-1',
      runs: [
        {
          script: 'start.js',
          logs: [
            { path: 'logs/api/start.js/111' },
            { path: 'logs/api/start.js/latest' },
            { path: 'logs/sessions/index.json' },
            { path: '../outside.txt' }
          ]
        }
      ]
    })

    const service = new AppLogReportService({ registry: createRegistry() })
    const report = await service.buildReport({
      appId: 'demo',
      status: { path: appRoot, title: 'Demo' },
      redact: false
    })

    assert.deepEqual(report.sections.map((section) => section.file), [
      'logs/api/start.js/111'
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
