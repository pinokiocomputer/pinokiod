const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Loader = require('../kernel/loader')
const setApi = require('../kernel/api/set')
const rmApi = require('../kernel/api/rm')
const SelfAPI = require('../kernel/api/self')

function createKernel () {
  return {
    memory: {
      local: {},
      global: {}
    },
    loader: new Loader()
  }
}

test('generic set and rm update local/global memory and self JSON files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-storage-api-'))
  const kernel = createKernel()
  const parent = {
    id: 'request-1',
    path: path.join(root, 'script.js')
  }

  try {
    await setApi({
      parent,
      cwd: root,
      params: {
        local: {
          'nested.value': 42,
          items: ['a', 'b', 'c']
        },
        global: {
          'state.ready': true
        },
        self: {
          'data/state.json': {
            'nested.keep': 'yes',
            'nested.drop': 'no',
            items: ['x', 'y', 'z']
          }
        }
      }
    }, () => {}, kernel)

    assert.deepEqual(kernel.memory.local[parent.id], {
      nested: { value: 42 },
      items: ['a', 'b', 'c']
    })
    assert.deepEqual(kernel.memory.global[parent.id], {
      state: { ready: true }
    })

    await rmApi({
      parent,
      cwd: root,
      params: {
        local: ['nested.value'],
        global: ['state.ready'],
        self: {
          'data/state.json': ['nested.drop', 'items.1']
        }
      }
    }, () => {}, kernel)

    assert.deepEqual(kernel.memory.local[parent.id], {
      nested: {},
      items: ['a', 'b', 'c']
    })
    assert.deepEqual(kernel.memory.global[parent.id], {
      state: {}
    })
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, 'data/state.json'), 'utf8')),
      {
        nested: { keep: 'yes' },
        items: ['x', 'z']
      }
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('self.set and self.rm wrap JSON file mutation without touching real launchers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-self-api-'))
  const kernel = createKernel()
  const selfApi = new SelfAPI()
  const parent = {
    id: 'request-2',
    path: path.join(root, 'script.js')
  }

  try {
    await selfApi.set({
      parent,
      cwd: root,
      params: {
        'pinokio.json': {
          title: 'Temporary launcher',
          'plugin.menu': ['Run']
        }
      }
    }, () => {}, kernel)

    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, 'pinokio.json'), 'utf8')),
      {
        title: 'Temporary launcher',
        plugin: { menu: ['Run'] }
      }
    )

    await selfApi.rm({
      parent,
      cwd: root,
      params: {
        'pinokio.json': ['plugin.menu']
      }
    }, () => {}, kernel)

    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, 'pinokio.json'), 'utf8')),
      {
        title: 'Temporary launcher',
        plugin: {}
      }
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
