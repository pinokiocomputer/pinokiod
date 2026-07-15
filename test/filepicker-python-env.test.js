const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Util = require('../kernel/util')

function restoreEnv(name, value) {
  if (typeof value === 'undefined') {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

test('file picker isolates its managed Python from external packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-filepicker-python-env-'))
  const pickerPath = path.join(root, 'picker.js')
  const oldNoUserSite = process.env.PYTHONNOUSERSITE
  const oldPythonPath = process.env.PYTHONPATH
  await fs.writeFile(pickerPath, `
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  JSON.parse(input)
  process.stdout.write(JSON.stringify({
    paths: [process.env.PYTHONNOUSERSITE, process.env.PYTHONPATH || null]
  }))
})
`)

  process.env.PYTHONNOUSERSITE = '0'
  process.env.PYTHONPATH = 'external-packages'
  try {
    const kernel = {
      platform: 'linux',
      path: (target) => {
        if (target === 'bin/py/picker.py') return pickerPath
        if (target === 'bin/miniforge/bin/python') return process.execPath
        throw new Error(`Unexpected path: ${target}`)
      },
    }
    const result = await Util.filepicker({ params: {} }, () => {}, kernel)

    assert.deepEqual(result, {
      paths: ['1', null],
    })
  } finally {
    restoreEnv('PYTHONNOUSERSITE', oldNoUserSite)
    restoreEnv('PYTHONPATH', oldPythonPath)
    await fs.rm(root, { recursive: true, force: true })
  }
})
