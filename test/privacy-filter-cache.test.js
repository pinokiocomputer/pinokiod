const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PassThrough, Readable } = require('node:stream')
const test = require('node:test')

const cacheModulePath = path.resolve(__dirname, '..', 'server', 'lib', 'privacy_filter_cache.js')
const axiosModulePath = require.resolve('axios')

function loadCacheWithAxiosMock(mockAxios) {
  const originalAxios = require.cache[axiosModulePath]
  delete require.cache[cacheModulePath]
  require.cache[axiosModulePath] = {
    id: axiosModulePath,
    filename: axiosModulePath,
    loaded: true,
    exports: mockAxios
  }
  const mod = require(cacheModulePath)
  return {
    mod,
    restore() {
      delete require.cache[cacheModulePath]
      if (originalAxios) {
        require.cache[axiosModulePath] = originalAxios
      } else {
        delete require.cache[axiosModulePath]
      }
    }
  }
}

function fakeRequest(headers) {
  const normalized = {}
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[key.toLowerCase()] = value
  }
  return {
    get(name) {
      return normalized[String(name).toLowerCase()]
    }
  }
}

async function waitForValue(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 1000) {
    const value = await fn()
    if (value) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

test('privacy filter cache installs requested dtype files under local model path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-privacy-filter-cache-'))
  const requests = []
  const { mod, restore } = loadCacheWithAxiosMock({
    get: async (url) => {
      requests.push(url)
      return {
        data: Readable.from([Buffer.from(`asset:${url}`)])
      }
    }
  })

  try {
    const kernel = { homedir: root }
    const staleRoot = path.resolve(root, 'cache', 'privacy-filter', 'models', 'openai', 'privacy-filter')
    await fs.mkdir(staleRoot, { recursive: true })
    await fs.writeFile(path.resolve(staleRoot, 'config.json'), 'stale')

    const before = await mod.status(kernel, { dtype: 'q4f16' })
    assert.equal(before.ready, false)
    assert.deepEqual(before.missing, [
      'config.json',
      'tokenizer_config.json',
      'tokenizer.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data'
    ])

    const ensured = await mod.ensure(kernel, { dtype: 'q4f16' })
    assert.equal(ensured.ready, true)
    assert.equal(ensured.downloaded, 5)
    assert.equal(ensured.local_model_path, `/pinokio/privacy-filter/models/${mod.PRIVACY_FILTER_REVISION}/`)
    assert.equal(requests.length, 5)
    assert.ok(requests.every((url) => url.includes(mod.PRIVACY_FILTER_REVISION)))

    const modelRoot = mod.modelRoot(kernel)
    assert.equal(modelRoot.includes(mod.PRIVACY_FILTER_REVISION), true)
    const config = await fs.readFile(path.resolve(modelRoot, 'config.json'), 'utf8')
    assert.match(config, /asset:https:\/\/huggingface\.co\/openai\/privacy-filter\/resolve\//)

    const after = await mod.ensure(kernel, { dtype: 'q4f16' })
    assert.equal(after.ready, true)
    assert.equal(after.downloaded, 0)
    assert.equal(after.cached, 5)
    assert.equal(requests.length, 5)
  } finally {
    restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('privacy filter cache install endpoint accepts only same-origin browser writes', async () => {
  const { mod, restore } = loadCacheWithAxiosMock({ get: async () => ({ data: Readable.from(['']) }) })
  try {
    assert.equal(mod.isInstallRequestAllowed(fakeRequest({})), true)
    assert.equal(mod.isInstallRequestAllowed(fakeRequest({
      Host: 'localhost:42000',
      Origin: 'http://localhost:42000',
      'Sec-Fetch-Site': 'same-origin'
    })), true)
    assert.equal(mod.isInstallRequestAllowed(fakeRequest({
      Host: 'localhost:42000',
      Origin: 'http://evil.example',
      'Sec-Fetch-Site': 'cross-site'
    })), false)
    assert.equal(mod.isInstallRequestAllowed(fakeRequest({
      Host: 'localhost:42000',
      Origin: 'http://localhost:5173',
      'Sec-Fetch-Site': 'same-site'
    })), false)
    assert.equal(mod.isInstallRequestAllowed(fakeRequest({
      Host: 'localhost:42000',
      Origin: 'not a url',
      'Sec-Fetch-Site': 'same-origin'
    })), false)
  } finally {
    restore()
  }
})

test('privacy filter cache requires an explicit Pinokio home', async () => {
  const { mod, restore } = loadCacheWithAxiosMock({
    get: async () => {
      throw new Error('download should not start')
    }
  })
  try {
    assert.throws(() => mod.cacheRoot({}), /Pinokio home directory is required/)
    await assert.rejects(() => mod.status({}, { dtype: 'q8' }), /Pinokio home directory is required/)
    await assert.rejects(() => mod.ensure({}, { dtype: 'q8' }), /Pinokio home directory is required/)
  } finally {
    restore()
  }
})

test('privacy filter cache removes stale temp files before retrying an asset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-privacy-filter-cache-temp-'))
  const { mod, restore } = loadCacheWithAxiosMock({
    get: async (url) => ({
      data: Readable.from([Buffer.from(`asset:${url}`)])
    })
  })

  try {
    const kernel = { homedir: root }
    const target = path.resolve(mod.modelRoot(kernel), 'config.json')
    const staleTemp = `${target}.999999.1.tmp`
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(staleTemp, 'partial')

    await mod.ensure(kernel, { dtype: 'q8' })

    await assert.rejects(() => fs.stat(staleTemp), /ENOENT/)
    const installed = await fs.readFile(target, 'utf8')
    assert.match(installed, /asset:https:\/\/huggingface\.co\/openai\/privacy-filter\/resolve\//)
  } finally {
    restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('privacy filter cache rejects truncated downloads when content length is available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-privacy-filter-cache-truncated-'))
  const { mod, restore } = loadCacheWithAxiosMock({
    get: async () => ({
      headers: {
        'content-length': '8'
      },
      data: Readable.from([Buffer.from('short')])
    })
  })

  try {
    const kernel = { homedir: root }
    const target = path.resolve(mod.modelRoot(kernel), 'config.json')
    await assert.rejects(
      () => mod.ensure(kernel, { dtype: 'q8' }),
      /Incomplete privacy filter asset: config\.json/
    )
    await assert.rejects(() => fs.stat(target), /ENOENT/)
    const dir = path.dirname(target)
    const entries = await fs.readdir(dir)
    assert.equal(entries.some((entry) => entry.endsWith('.tmp')), false)
  } finally {
    restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('privacy filter cache exposes in-progress install status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-privacy-filter-cache-progress-'))
  const { mod, restore } = loadCacheWithAxiosMock({
    get: async () => {
      const stream = new PassThrough()
      setTimeout(() => stream.write(Buffer.alloc(512)), 20)
      setTimeout(() => stream.end(Buffer.alloc(512)), 80)
      return {
        headers: {
          'content-length': '1024'
        },
        data: stream
      }
    }
  })

  try {
    const kernel = { homedir: root }
    const ensurePromise = mod.ensure(kernel, { dtype: 'q8' })
    const installing = await waitForValue(async () => {
      const current = await mod.status(kernel, { dtype: 'q8' })
      return current.installing && current.install && current.install.current_file && current.install.current_total === 1024 ? current : null
    }, 'privacy filter install progress')

    assert.equal(installing.install.total_files, 5)
    assert.equal(installing.install.current_file, 'config.json')
    assert.equal(installing.install.current_total, 1024)

    const ensured = await ensurePromise
    assert.equal(ensured.ready, true)
    assert.equal(ensured.downloaded, 5)
  } finally {
    restore()
    await fs.rm(root, { recursive: true, force: true })
  }
})
