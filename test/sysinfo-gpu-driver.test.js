const assert = require('node:assert/strict')
const test = require('node:test')

const system = require('systeminformation')
const nvidia = require('../kernel/gpu/nvidia')
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
        driverVersion: '565.90',
        pciBus: '00000000:02:00.0'
      }
    ],
    displays: []
  }))
  t.mock.method(nvidia, 'resolve_cuda_sm_target', async (controller) => {
    assert.equal(controller.pciBus, '00000000:02:00.0')
    return 'sm_86'
  })

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'nvidia')
  assert.equal(sys.info.gpu_model, 'nvidia rtx a4500')
  assert.equal(sys.info.gpu_driver, '565.90')
  assert.equal(sys.info.gpu_target, 'sm_86')
  assert.equal(sys.info.vram, 20)
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
  assert.equal(sys.info.gpu_target, 'gfx1100')
  assert.equal(sys.info.vram, 24)
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

test('GPU sysinfo leaves gpu_target null for Intel targets', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Intel',
        model: 'Intel Arc A770',
        vram: 16384,
        driverVersion: '31.0.101.5590'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'intel')
  assert.equal(sys.info.gpu_model, 'intel arc a770')
  assert.equal(sys.info.gpu_driver, '31.0.101.5590')
  assert.equal(sys.info.gpu_target, null)
})

test('GPU sysinfo resolves gpu_target for the selected NVIDIA controller when AMD is also present', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 7900 XTX',
        vram: 24576,
        driverVersion: '31.0.2'
      },
      {
        vendor: 'NVIDIA',
        model: 'NVIDIA GeForce RTX 4090',
        vram: 24576,
        driverVersion: '565.90',
        pciBus: '00000000:02:00.0'
      }
    ],
    displays: []
  }))
  t.mock.method(nvidia, 'resolve_cuda_sm_target', async (controller) => {
    assert.equal(controller.model, 'NVIDIA GeForce RTX 4090')
    return 'sm_89'
  })

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'nvidia')
  assert.equal(sys.info.gpu_model, 'nvidia geforce rtx 4090')
  assert.equal(sys.info.gpu_target, 'sm_89')
})

test('GPU sysinfo leaves gpu_target null for Apple targets', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Apple',
        model: 'Apple M3',
        vram: 0,
        driverVersion: null
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'apple')
  assert.equal(sys.info.gpu_model, 'apple m3')
  assert.equal(sys.info.gpu_target, null)
})

test('GPU sysinfo leaves gpu_target null for unknown GPU vendors', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'Qualcomm',
        model: 'Adreno X1',
        vram: 16384,
        driverVersion: '1.2.3'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'qualcomm')
  assert.equal(sys.info.gpu_model, 'adreno x1')
  assert.equal(sys.info.gpu_driver, '1.2.3')
  assert.equal(sys.info.gpu_target, null)
})

test('GPU sysinfo leaves gpu_target null when no GPU controller is detected', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'none')
  assert.equal(sys.info.gpu_model, undefined)
  assert.equal(sys.info.gpu_target, null)
  assert.deepEqual(sys.info.gpus, [])
  assert.equal(sys.info.vram, 0)
})
