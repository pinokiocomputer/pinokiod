const fs = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')
const axios = require('axios')

const PRIVACY_FILTER_MODEL_ID = 'openai/privacy-filter'
const PRIVACY_FILTER_REVISION = '7ffa9a043d54d1be65afb281eddf0ffbe629385b'
const PRIVACY_FILTER_LOCAL_MODEL_PATH = `/pinokio/privacy-filter/models/${PRIVACY_FILTER_REVISION}/`
const PRIVACY_FILTER_SHARED_FILES = [
  'config.json',
  'tokenizer_config.json',
  'tokenizer.json'
]
const PRIVACY_FILTER_DTYPE_FILES = {
  q4f16: [
    'onnx/model_q4f16.onnx',
    'onnx/model_q4f16.onnx_data'
  ],
  q4: [
    'onnx/model_q4.onnx',
    'onnx/model_q4.onnx_data'
  ],
  q8: [
    'onnx/model_quantized.onnx',
    'onnx/model_quantized.onnx_data'
  ]
}
const PRIVACY_FILTER_ASSET_SET = new Set([
  ...PRIVACY_FILTER_SHARED_FILES,
  ...Object.values(PRIVACY_FILTER_DTYPE_FILES).flat()
])

const ensurePromises = new Map()
const installStates = new Map()

function normalizeDtype(value) {
  const dtype = String(value || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(PRIVACY_FILTER_DTYPE_FILES, dtype) ? dtype : 'q8'
}

function cacheRoot(kernel) {
  const home = kernel && typeof kernel.homedir === 'string' ? kernel.homedir : ''
  if (!home.trim()) {
    throw new Error('Pinokio home directory is required for privacy filter cache.')
  }
  return path.resolve(home, 'cache', 'privacy-filter', 'models')
}

function modelRoot(kernel) {
  return path.resolve(cacheRoot(kernel), PRIVACY_FILTER_REVISION, 'openai', 'privacy-filter')
}

function assetFilesForDtype(dtype) {
  const normalized = normalizeDtype(dtype)
  return [
    ...PRIVACY_FILTER_SHARED_FILES,
    ...PRIVACY_FILTER_DTYPE_FILES[normalized]
  ]
}

function assertKnownAsset(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/')
  if (!PRIVACY_FILTER_ASSET_SET.has(normalized)) {
    throw new Error(`Unknown privacy filter asset: ${relativePath}`)
  }
  return normalized
}

function isInstallRequestAllowed(req) {
  const fetchSite = String(req && typeof req.get === 'function' ? req.get('Sec-Fetch-Site') || '' : '').trim().toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false
  }

  const origin = String(req && typeof req.get === 'function' ? req.get('Origin') || '' : '').trim()
  if (!origin) {
    return true
  }

  const host = String(req && typeof req.get === 'function' ? req.get('Host') || '' : '').trim().toLowerCase()
  if (!host) {
    return false
  }

  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host.toLowerCase() === host
  } catch (_) {
    return false
  }
}

function assetPath(kernel, relativePath) {
  const normalized = assertKnownAsset(relativePath)
  return path.resolve(modelRoot(kernel), ...normalized.split('/'))
}

function ensureKey(kernel, dtype) {
  return `${modelRoot(kernel)}:${normalizeDtype(dtype)}`
}

function remoteAssetUrl(relativePath) {
  const normalized = assertKnownAsset(relativePath)
  return `https://huggingface.co/${PRIVACY_FILTER_MODEL_ID}/resolve/${PRIVACY_FILTER_REVISION}/${normalized}`
}

function copyInstallState(install) {
  return install ? { ...install } : null
}

async function cleanupStaleAssetTemps(target) {
  const dir = path.dirname(target)
  const base = path.basename(target)
  const currentProcessPrefix = `${base}.${process.pid}.`
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
  await Promise.all(entries
    .filter((entry) => {
      return entry.isFile() &&
        entry.name.startsWith(`${base}.`) &&
        entry.name.endsWith('.tmp') &&
        !entry.name.startsWith(currentProcessPrefix)
    })
    .map((entry) => fs.promises.rm(path.resolve(dir, entry.name), { force: true })))
}

async function fileStatus(kernel, relativePath) {
  const target = assetPath(kernel, relativePath)
  try {
    const stats = await fs.promises.stat(target)
    return {
      path: relativePath,
      exists: stats.isFile() && stats.size > 0,
      size: stats.isFile() ? stats.size : 0
    }
  } catch (_) {
    return {
      path: relativePath,
      exists: false,
      size: 0
    }
  }
}

async function status(kernel, options = {}) {
  const dtype = normalizeDtype(options.dtype)
  const install = copyInstallState(installStates.get(ensureKey(kernel, dtype)))
  const files = await Promise.all(assetFilesForDtype(dtype).map((file) => fileStatus(kernel, file)))
  const missing = files.filter((file) => !file.exists).map((file) => file.path)
  return {
    model_id: PRIVACY_FILTER_MODEL_ID,
    revision: PRIVACY_FILTER_REVISION,
    dtype,
    local_model_path: PRIVACY_FILTER_LOCAL_MODEL_PATH,
    ready: missing.length === 0,
    files,
    missing,
    missing_count: missing.length,
    installing: Boolean(install),
    install
  }
}

async function downloadAsset(kernel, relativePath, onProgress) {
  const target = assetPath(kernel, relativePath)
  const existing = await fileStatus(kernel, relativePath)
  if (existing.exists) {
    return { path: relativePath, status: 'cached', size: existing.size }
  }

  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await cleanupStaleAssetTemps(target)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    const response = await axios.get(remoteAssetUrl(relativePath), {
      responseType: 'stream',
      maxRedirects: 5,
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (statusCode) => statusCode >= 200 && statusCode < 300
    })
    let loaded = 0
    const total = Number(response.headers && response.headers['content-length']) || 0
    const encoded = Boolean(response.headers && response.headers['content-encoding'])
    if (typeof onProgress === 'function') {
      onProgress({ loaded, total })
    }
    response.data.on('data', (chunk) => {
      loaded += chunk && chunk.length ? chunk.length : 0
      if (typeof onProgress === 'function') {
        onProgress({ loaded, total })
      }
    })
    await pipeline(response.data, fs.createWriteStream(tmp))
    const stats = await fs.promises.stat(tmp)
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error(`Downloaded empty privacy filter asset: ${relativePath}`)
    }
    if (total > 0 && !encoded && stats.size !== total) {
      throw new Error(`Incomplete privacy filter asset: ${relativePath} (${stats.size}/${total} bytes)`)
    }
    await fs.promises.rename(tmp, target)
    return { path: relativePath, status: 'downloaded', size: stats.size }
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

async function ensure(kernel, options = {}) {
  const dtype = normalizeDtype(options.dtype)
  const key = ensureKey(kernel, dtype)
  if (ensurePromises.has(key)) {
    return ensurePromises.get(key)
  }
  const promise = (async () => {
    const files = assetFilesForDtype(dtype)
    const install = {
      dtype,
      total_files: files.length,
      completed_files: 0,
      cached_files: 0,
      downloaded_files: 0,
      current_file: '',
      current_loaded: 0,
      current_total: 0,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    installStates.set(key, install)
    const results = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      install.current_file = file
      install.current_index = index + 1
      install.current_loaded = 0
      install.current_total = 0
      install.updated_at = new Date().toISOString()
      const result = await downloadAsset(kernel, file, ({ loaded, total }) => {
        install.current_loaded = loaded
        install.current_total = total
        install.updated_at = new Date().toISOString()
      })
      results.push(result)
      install.completed_files += 1
      if (result.status === 'cached') {
        install.cached_files += 1
      } else if (result.status === 'downloaded') {
        install.downloaded_files += 1
      }
      install.updated_at = new Date().toISOString()
    }
    const current = await status(kernel, { dtype })
    return {
      ...current,
      results,
      downloaded: results.filter((result) => result.status === 'downloaded').length,
      cached: results.filter((result) => result.status === 'cached').length
    }
  })().finally(() => {
    ensurePromises.delete(key)
    installStates.delete(key)
  })
  ensurePromises.set(key, promise)
  return promise
}

module.exports = {
  PRIVACY_FILTER_MODEL_ID,
  PRIVACY_FILTER_REVISION,
  PRIVACY_FILTER_LOCAL_MODEL_PATH,
  normalizeDtype,
  cacheRoot,
  modelRoot,
  isInstallRequestAllowed,
  status,
  ensure
}
