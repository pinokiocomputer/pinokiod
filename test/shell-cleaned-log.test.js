const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Kernel = require('../kernel')

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch (_) {
    return false
  }
}

test('kernel shell logs write cleaned output without creating info logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-shell-cleaned-log-'))
  try {
    const kernel = Object.create(Kernel.prototype)
    kernel.homedir = root

    const group = path.join(root, 'api', 'demo', 'start.js')
    await Kernel.prototype._log.call(kernel, {
      cleaned: 'hello from cleaned log\n'
    }, group, {
      index: 3
    })

    const relativeGroup = path.relative(root, group)
    const cleanedLog = path.join(root, 'logs', 'shell', 'cleaned', `${relativeGroup}.3.txt`)
    const infoLog = path.join(root, 'logs', 'shell', 'info', `${relativeGroup}.3.txt`)

    assert.equal(await exists(cleanedLog), true)
    assert.equal(await fs.readFile(cleanedLog, 'utf8'), 'hello from cleaned log\n')
    assert.equal(await exists(infoLog), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('kernel shell log clearing removes cleaned files and legacy info files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-shell-cleaned-clear-'))
  try {
    const kernel = Object.create(Kernel.prototype)
    kernel.homedir = root

    const group = path.join(root, 'api', 'demo', 'start.js')
    const relativeGroup = path.relative(root, group)
    const cleanedLog = path.join(root, 'logs', 'shell', 'cleaned', `${relativeGroup}.3.txt`)
    const infoLog = path.join(root, 'logs', 'shell', 'info', `${relativeGroup}.3.txt`)

    await fs.mkdir(path.dirname(cleanedLog), { recursive: true })
    await fs.mkdir(path.dirname(infoLog), { recursive: true })
    await fs.writeFile(cleanedLog, 'cleaned\n')
    await fs.writeFile(infoLog, 'legacy info\n')

    await Kernel.prototype.clearLog.call(kernel, group)

    assert.equal(await exists(cleanedLog), false)
    assert.equal(await exists(infoLog), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
