const assert = require('node:assert/strict')
const test = require('node:test')

const system = require('systeminformation')
const Sysinfo = require('../kernel/sysinfo')

test('GPU sysinfo exposes per-controller drivers and primary NVIDIA driver', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Intel',
        model: 'Intel Arc A770',
        vram: 8192,
        driverVersion: '31.0.101.5590'
      },
      {
        vendor: 'NVIDIA',
        model: 'NVIDIA RTX A4500',
        vram: 20480,
        driverVersion: '565.90'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'nvidia')
  assert.equal(sys.info.gpu_model, 'nvidia rtx a4500')
  assert.equal(sys.info.gpu_driver, '565.90')
  assert.deepEqual(sys.info.gpus, [
    {
      name: 'intel',
      model: 'intel arc a770',
      driver: '31.0.101.5590'
    },
    {
      name: 'nvidia',
      model: 'nvidia rtx a4500',
      driver: '565.90'
    }
  ])
})

test('GPU sysinfo uses selected highest-VRAM AMD controller for gpu_driver', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Advanced Micro Devices',
        model: 'AMD Radeon RX 7600',
        vram: 8192,
        driverVersion: '31.0.1'
      },
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 7900 XTX',
        vram: 24576,
        driverVersion: '31.0.2'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_model, 'amd radeon rx 7900 xtx')
  assert.equal(sys.info.gpu_driver, '31.0.2')
  assert.deepEqual(sys.info.gpus, [
    {
      name: 'advanced micro devices',
      model: 'amd radeon rx 7600',
      driver: '31.0.1'
    },
    {
      name: 'amd',
      model: 'amd radeon rx 7900 xtx',
      driver: '31.0.2'
    }
  ])
})
