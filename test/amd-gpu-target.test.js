const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const system = require('systeminformation')

const amd = require('../kernel/gpu/amd')
const gfxTargets = require('../kernel/gpu/amd_gfx_targets.json')
const packageJson = require('../package.json')
const Sysinfo = require('../kernel/sysinfo')

const root = path.join(__dirname, '..')

test('AMD gfx generated data is checked in and self describing', () => {
  assert.equal(
    gfxTargets.source,
    'https://raw.githubusercontent.com/ROCm/ROCm/develop/docs/reference/gpu-arch-specs.rst'
  )
  assert.equal(gfxTargets.generated_by, 'script/update-amd-gfx-targets.js')

  assert.equal(gfxTargets.entries['radeon rx 6800 xt'], 'gfx1030')
  assert.equal(gfxTargets.entries['radeon rx 7900 xtx'], 'gfx1100')
  assert.equal(gfxTargets.entries.mi210, 'gfx90a')
})

test('AMD gfx target refresh is an explicit maintainer command', () => {
  assert.equal(packageJson.scripts['update:amd-gfx-targets'], 'node script/update-amd-gfx-targets.js')
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.scripts, 'update:amd-rocm-targets'), false)

  for (const script of ['preinstall', 'install', 'postinstall', 'prestart', 'start', 'poststart']) {
    assert.doesNotMatch(packageJson.scripts[script] || '', /update-amd-gfx-targets/)
  }
})

test('AMD gfx resolver maps common product names to exact gfx targets', () => {
  const cases = [
    ['AMD Radeon RX 6800 XT', 'gfx1030'],
    ['AMD Radeon RX 7600', 'gfx1102'],
    ['Advanced Micro Devices Radeon RX 7900 XTX', 'gfx1100'],
    ['AMD Radeon RX 9070 XT', 'gfx1201'],
    ['AMD Radeon AI PRO R9700', 'gfx1201'],
    ['AMD Instinct MI210', 'gfx90a'],
    ['AMD Radeon 780M', 'gfx1103'],
    ['AMD Radeon 890M', 'gfx1150'],
    ['gfx1030', 'gfx1030']
  ]

  for (const [model, target] of cases) {
    assert.equal(amd.resolve_rocm_gfx_target(model), target, model)
  }
})

test('AMD gfx resolver rejects unknown products and preserves raw gfx targets', () => {
  const unknownModels = [
    'AMD Radeon RX 480',
    'AMD Radeon RX 5700 XT',
    'AMD Radeon RX 9999',
    'AMD Radeon RX 9999M XT'
  ]

  for (const model of unknownModels) {
    assert.equal(amd.resolve_rocm_gfx_target(model), null, model)
  }

  for (const target of ['gfx803', 'gfx1013', 'gfx1104', 'gfx1209', 'GFX90A']) {
    assert.equal(amd.resolve_rocm_gfx_target(target), target.toLowerCase(), target)
  }
})

test('AMD gpu_target resolution uses CPU brand only for generic Radeon Graphics models', async () => {
  let cpuBrandCalls = 0
  const cpuBrand = async () => {
    cpuBrandCalls += 1
    return 'AMD Ryzen AI 9 HX 375'
  }

  assert.equal(await amd.resolve_gpu_target('AMD Radeon RX 6800 XT', cpuBrand), 'gfx1030')
  assert.equal(cpuBrandCalls, 0)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon RX 480', cpuBrand), null)
  assert.equal(cpuBrandCalls, 0)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon Graphics', cpuBrand), 'gfx1150')
  assert.equal(cpuBrandCalls, 1)

  assert.equal(await amd.resolve_gpu_target('AMD Radeon Graphics', 'Unknown AMD CPU'), null)
})

test('Sysinfo exposes AMD gpu_target for resolved discrete GPUs', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 6800 XT',
        vram: 16384,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, 'gfx1030')
})

test('Sysinfo leaves unresolved AMD gpu_target null', async (t) => {
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon RX 480',
        vram: 8192,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, null)
})

test('Sysinfo exposes AMD gpu_target through generic APU CPU fallback', async (t) => {
  let cpuBrandCalls = 0
  t.mock.method(system, 'graphics', async () => ({
    controllers: [
      {
        vendor: 'AMD',
        model: 'AMD Radeon Graphics',
        vram: 16384,
        driverVersion: '31.0.1'
      }
    ],
    displays: []
  }))
  t.mock.method(system, 'cpu', async () => {
    cpuBrandCalls += 1
    return { brand: 'AMD Ryzen AI 9 HX 375' }
  })

  const sys = new Sysinfo()
  sys.info = {}

  await sys.gpus()

  assert.equal(sys.info.gpu, 'amd')
  assert.equal(sys.info.gpu_target, 'gfx1150')
  assert.equal(cpuBrandCalls, 1)
})

test('AMD gfx runtime resolver stays offline and data-only', () => {
  const source = fs.readFileSync(path.join(root, 'kernel', 'gpu', 'amd.js'), 'utf8')

  assert.doesNotMatch(source, /require\(["'](?:node:)?https?["']\)/)
  assert.doesNotMatch(source, /require\(["'](?:node:)?child_process["']\)/)
  assert.doesNotMatch(source, /\b(fetch|axios|rocminfo|hipInfo|ze_info)\b/)
  assert.doesNotMatch(source, /\b(kfd|topology)\b/i)
})
