const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const test = require('node:test')

const nvidia = require('../kernel/gpu/nvidia')

test('NVIDIA compute capability parser emits CUDA SM targets', () => {
  assert.deepEqual(
    nvidia.parse_nvidia_smi_compute_caps([
      '00000000:01:00.0, 8.6',
      '00000000:02:00.0, 8.9',
      '00000000:03:00.0, 12.0',
      '00000000:04:00.0, N/A'
    ].join('\n')),
    [
      { pci_bus: '01:00.0', target: 'sm_86' },
      { pci_bus: '02:00.0', target: 'sm_89' },
      { pci_bus: '03:00.0', target: 'sm_120' }
    ]
  )
})

test('NVIDIA target selection matches the selected controller by PCI bus', () => {
  const records = [
    { pci_bus: '01:00.0', target: 'sm_86' },
    { pci_bus: '02:00.0', target: 'sm_89' }
  ]

  assert.equal(nvidia.select_cuda_sm_target({ pciBus: '00000000:02:00.0' }, records), 'sm_89')
  assert.equal(nvidia.select_cuda_sm_target({ busAddress: '01:00.0' }, records), 'sm_86')
  assert.equal(nvidia.select_cuda_sm_target({ pciBus: '03:00.0' }, records), null)
})

test('NVIDIA target selection uses the only record when the controller has no PCI bus', () => {
  assert.equal(
    nvidia.select_cuda_sm_target({}, [{ pci_bus: '01:00.0', target: 'sm_86' }]),
    'sm_86'
  )
  assert.equal(
    nvidia.select_cuda_sm_target({}, [
      { pci_bus: '01:00.0', target: 'sm_86' },
      { pci_bus: '02:00.0', target: 'sm_89' }
    ]),
    null
  )
})

test('NVIDIA nvidia-smi query failure resolves to no targets', async () => {
  const records = await nvidia.query_cuda_sm_targets((_cmd, _args, _options, done) => {
    done(new Error('missing nvidia-smi'))
  })

  assert.deepEqual(records, [])
})

test('NVIDIA nvidia-smi query uses compute capability command and parses stdout', async () => {
  const calls = []
  const records = await nvidia.query_cuda_sm_targets((cmd, args, options, done) => {
    calls.push({ cmd, args, options })
    done(null, [
      '00000000:01:00.0, 8.6',
      '00000000:02:00.0, 8.9'
    ].join('\n'))
  })

  assert.deepEqual(calls, [{
    cmd: 'nvidia-smi',
    args: [
      '--query-gpu=pci.bus_id,compute_cap',
      '--format=csv,noheader,nounits'
    ],
    options: { windowsHide: true, timeout: 5000 }
  }])
  assert.deepEqual(records, [
    { pci_bus: '01:00.0', target: 'sm_86' },
    { pci_bus: '02:00.0', target: 'sm_89' }
  ])
})

test('NVIDIA gpu_target caches the nvidia-smi compute capability query', async (t) => {
  const modulePath = require.resolve('../kernel/gpu/nvidia')
  delete require.cache[modulePath]

  let calls = 0
  t.mock.method(childProcess, 'execFile', (_cmd, _args, _options, done) => {
    calls += 1
    done(null, '00000000:01:00.0, 8.6\n')
  })
  t.after(() => {
    delete require.cache[modulePath]
  })

  const freshNvidia = require('../kernel/gpu/nvidia')

  assert.equal(await freshNvidia.resolve_cuda_sm_target({ pciBus: '00000000:01:00.0' }), 'sm_86')
  assert.equal(await freshNvidia.resolve_cuda_sm_target({ pciBus: '00000000:01:00.0' }), 'sm_86')
  assert.equal(calls, 1)
})
