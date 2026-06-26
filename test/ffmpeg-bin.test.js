const assert = require('node:assert/strict')
const test = require('node:test')

const Ffmpeg = require('../kernel/bin/ffmpeg')
const Setup = require('../kernel/bin/setup')

function createKernel(platform = 'win32') {
  return {
    platform,
    bin: {
      installed: {
        conda: new Set(),
        conda_versions: {},
      },
      exec: async () => {},
    },
  }
}

function createFfmpeg(kernel) {
  const ffmpeg = new Ffmpeg()
  ffmpeg.kernel = kernel
  return ffmpeg
}

test('FFmpeg bin installs pinned ffmpeg into base Conda on Windows', async () => {
  const calls = []
  const kernel = createKernel('win32')
  kernel.bin.exec = async (payload) => {
    calls.push(payload)
  }

  await createFfmpeg(kernel).install({}, () => {})

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].message, [
    'conda clean -y --all',
    'conda install -y -c conda-forge ffmpeg=8.1.2',
  ])
  assert.equal(calls[0].env, undefined)
  assert.equal(calls[0].message.some((command) => /ffmpeg-env|conda create|-p /.test(command)), false)
})

test('FFmpeg bin installs pinned ffmpeg into base Conda consistently across platforms', async () => {
  const calls = []
  const kernel = createKernel('darwin')
  kernel.bin.exec = async (payload) => {
    calls.push(payload)
  }

  await createFfmpeg(kernel).install({}, () => {})

  assert.deepEqual(calls[0].message, [
    'conda clean -y --all',
    'conda install -y -c conda-forge ffmpeg=8.1.2',
  ])
})

test('FFmpeg installed check requires the base Conda package at the pinned version', async () => {
  const kernel = createKernel('win32')
  const ffmpeg = createFfmpeg(kernel)

  kernel.bin.installed.conda = new Set(['ffmpeg'])
  kernel.bin.installed.conda_versions = { ffmpeg: '8.1.2' }
  assert.equal(await ffmpeg.installed(), true)

  kernel.bin.installed.conda_versions = { ffmpeg: '8.1.1' }
  assert.equal(await ffmpeg.installed(), false)

  kernel.bin.installed.conda = new Set()
  kernel.bin.installed.conda_versions = {}
  assert.equal(await ffmpeg.installed(), false)
})

test('setup presets bundle FFmpeg into Conda bootstrap and keep the module check', () => {
  const kernel = { gpu: null }
  for (const preset of ['ai', 'dev', 'advanced_dev']) {
    const config = Setup[preset](kernel)
    assert.equal(config.conda_requirements.includes('ffmpeg'), true)
    assert.equal(config.requirements.some((requirement) => requirement.name === 'ffmpeg'), true)
  }
})
