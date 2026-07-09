const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Loader = require('../kernel/loader')

test('loader unwraps an ESM namespace default export', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-loader-esm-'))
  const filepath = path.join(root, 'pinokio.js')
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await fs.writeFile(filepath, `
    export default {
      title: 'ESM launcher',
      menu: async () => []
    }
  `)

  const loaded = await new Loader().load(filepath)

  assert.equal(loaded.resolved.title, 'ESM launcher')
  assert.equal(typeof loaded.resolved.menu, 'function')
  assert.equal(Object.hasOwn(loaded.resolved, 'default'), false)
})
