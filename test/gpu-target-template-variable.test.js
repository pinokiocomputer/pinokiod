const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Kernel = require('../kernel')

test('Kernel propagates sysinfo gpu_target to template state and public info', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-gpu-target-info-'))
  const apiRoot = path.join(root, 'api')
  await fs.mkdir(apiRoot, { recursive: true })

  const templateUpdates = []
  const kernel = {
    version: 'test',
    platform: 'linux',
    arch: 'x64',
    homedir: root,
    shell: { shells: [] },
    vars: {},
    memory: {
      local: {},
      global: {},
      key: {},
      rpc: {},
      input: {},
      args: {}
    },
    procs: {},
    api: {
      running: {},
      proxies: {},
      userdir: apiRoot,
      meta: async () => null
    },
    bin: { installed: {} },
    template: {
      update: (info) => templateUpdates.push(info)
    },
    sys: {
      info: {
        gpu: 'amd',
        gpu_model: 'amd radeon rx 6800 xt',
        gpu_driver: '31.0.1',
        gpu_target: 'gfx1030',
        gpus: [],
        vram: 16,
        ram: 64
      }
    },
    path: (...parts) => path.join(root, ...parts),
    dns: async () => {}
  }

  try {
    await Kernel.prototype.update_sysinfo.call(kernel)
    await Kernel.prototype.getInfo.call(kernel, false)

    assert.equal(kernel.gpu, 'amd')
    assert.equal(kernel.gpu_model, 'amd radeon rx 6800 xt')
    assert.equal(kernel.gpu_target, 'gfx1030')
    assert.equal(templateUpdates.length, 1)
    assert.equal(templateUpdates[0].gpu_target, 'gfx1030')
    assert.equal(kernel.i.gpu_target, 'gfx1030')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
