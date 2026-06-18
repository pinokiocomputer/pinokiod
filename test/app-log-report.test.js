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

test('app log report includes every logs/api/**/latest file and ignores shell logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-app-log-report-'))
  try {
    const appRoot = path.join(root, 'demo')
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'install.js'), { recursive: true })
    await fs.mkdir(path.join(appRoot, 'logs', 'api', 'nested', 'start.js'), { recursive: true })
    await fs.mkdir(path.join(appRoot, 'logs', 'shell'), { recursive: true })

    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'install.js', 'latest'), 'install log\n')
    await fs.writeFile(path.join(appRoot, 'logs', 'api', 'nested', 'start.js', 'latest'), 'nested start log\n')
    await fs.writeFile(path.join(appRoot, 'logs', 'shell', 'latest'), 'shell log should not be included\n')

    const service = new AppLogReportService({ registry: createRegistry() })
    const report = await service.buildReport({
      appId: 'demo',
      status: {
        path: appRoot,
        title: 'Demo'
      },
      redact: false
    })

    assert.deepEqual(
      report.sections.map((section) => section.file).sort(),
      [
        'logs/api/install.js/latest',
        'logs/api/nested/start.js/latest'
      ]
    )
    assert.equal(report.markdown.includes('## Sanitization'), false)
    assert.equal(report.markdown.includes('shell log should not be included'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
