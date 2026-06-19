const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm'
const MODEL_ID = 'openai/privacy-filter'
const MAX_CHUNK_CHARS = 1800
const CHUNK_OVERLAP_CHARS = 120
const URL_COMPONENT_LABELS = new Set([
  'private_url',
  'private_person',
  'private_organization',
  'private_username',
  'private_name'
])

let transformersPromise = null
let pipelinePromise = null
let pipelineKey = ''
let activeDevice = 'webgpu'
let activeDtype = 'q4f16'

const post = (message) => {
  self.postMessage(message)
}

const normalizeLabel = (value) => {
  const label = String(value || 'private')
    .replace(/^[bieos]-/i, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return label || 'private'
}

const trimUrlCandidate = (value) => {
  return String(value || '')
    .replace(/^[([{<]+/, '')
    .replace(/[)\]}>.,;:]+$/g, '')
}

const tokenAround = (text, start, end) => {
  const value = String(text || '')
  let left = Math.max(0, start)
  let right = Math.min(value.length, end)
  while (left > 0 && !/[\s"'`<>]/.test(value[left - 1])) {
    left -= 1
  }
  while (right < value.length && !/[\s"'`<>]/.test(value[right])) {
    right += 1
  }
  let raw = value.slice(left, right)
  const trimmed = trimUrlCandidate(raw)
  const leadingTrim = raw.length - raw.replace(/^[([{<]+/, '').length
  left += leadingTrim
  right = left + trimmed.length
  return {
    start: left,
    end: right,
    value: trimmed
  }
}

const parseUrlCandidate = (value) => {
  let candidate = trimUrlCandidate(value)
  candidate = candidate.replace(/^git\+/i, '')
  const sshMatch = candidate.match(/^git@([^:\s]+):(.+)$/i)
  if (sshMatch) {
    return {
      protocol: 'ssh:',
      username: 'git',
      password: '',
      hostname: sshMatch[1],
      search: '',
      hash: ''
    }
  }
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(candidate)) {
    candidate = `https://${candidate}`
  }
  try {
    return new URL(candidate)
  } catch (_) {
    return null
  }
}

const isExposableUrl = (value) => {
  const url = parseUrlCandidate(value)
  if (!url) {
    return false
  }
  if (url.protocol === 'ssh:') {
    return Boolean(url.hostname)
  }
  return /^(?:https?|git|ssh):$/i.test(url.protocol) && Boolean(url.hostname)
}

const shouldKeepEntityUnmasked = (text, entity) => {
  if (!URL_COMPONENT_LABELS.has(entity.label)) {
    return false
  }
  const candidate = tokenAround(text, entity.start, entity.end)
  return Boolean(candidate.value && isExposableUrl(candidate.value))
}

const detectUrlSecretEntities = (text) => {
  const value = String(text || '')
  const entities = []
  const urlPattern = /(?:git\+)?https?:\/\/[^\s"'`<>]+|git@[^\s"'`<>]+:[^\s"'`<>]+/gi
  let match = urlPattern.exec(value)
  while (match) {
    const token = tokenAround(value, match.index, match.index + match[0].length)
    const candidate = token.value
    const parsed = parseUrlCandidate(candidate)
    if (parsed) {
      if (parsed.protocol !== 'ssh:' && (parsed.username || parsed.password)) {
        const userInfoMatch = candidate.match(/^[a-z][a-z0-9+.-]*:\/\/([^/@]+)@/i)
        if (userInfoMatch) {
          const start = token.start + candidate.indexOf(userInfoMatch[1])
          entities.push({
            label: 'url_credential',
            start,
            end: start + userInfoMatch[1].length
          })
        }
      }
      const sensitiveValuePattern = /([?&#;](?:access[_-]?token|refresh[_-]?token|token|secret|password|passwd|api[_-]?key|apikey|auth|authorization|session|cookie|key|signature|sig|jwt)=)([^&#;\s"'`<>]+)/gi
      let sensitiveMatch = sensitiveValuePattern.exec(candidate)
      while (sensitiveMatch) {
        const start = token.start + sensitiveMatch.index + sensitiveMatch[1].length
        entities.push({
          label: 'url_secret',
          start,
          end: start + sensitiveMatch[2].length
        })
        sensitiveMatch = sensitiveValuePattern.exec(candidate)
      }
    }
    match = urlPattern.exec(value)
  }
  return entities
}

const prepareMaskEntities = (text, entities) => {
  return [
    ...detectUrlSecretEntities(text),
    ...(entities || []).filter((entity) => !shouldKeepEntityUnmasked(text, entity))
  ]
}

const attachOffsets = (text, raw, absoluteStart) => {
  const entities = []
  let cursor = 0
  for (const entry of raw || []) {
    const label = normalizeLabel(entry.entity_group || entry.entity || entry.label)
    const score = Number(entry.score)
    if (typeof entry.start === 'number' && typeof entry.end === 'number' && entry.end > entry.start) {
      entities.push({
        label,
        score: Number.isFinite(score) ? score : 0,
        start: absoluteStart + entry.start,
        end: absoluteStart + entry.end
      })
      cursor = Math.max(cursor, entry.end)
      continue
    }
    const word = String(entry.word || '').replace(/^\s+/, '')
    const found = word ? text.indexOf(word, cursor) : -1
    if (found >= 0) {
      entities.push({
        label,
        score: Number.isFinite(score) ? score : 0,
        start: absoluteStart + found,
        end: absoluteStart + found + word.length
      })
      cursor = found + word.length
    }
  }
  return entities
}

const chooseChunkEnd = (text, start, hardEnd) => {
  if (hardEnd >= text.length) {
    return text.length
  }
  const slice = text.slice(start, hardEnd)
  const candidates = [
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf(' ')
  ].filter((index) => index > Math.floor(MAX_CHUNK_CHARS * 0.55))
  if (candidates.length > 0) {
    return start + Math.max(...candidates) + 1
  }
  return hardEnd
}

const buildChunks = (text) => {
  const chunks = []
  let start = 0
  while (start < text.length) {
    const hardEnd = Math.min(start + MAX_CHUNK_CHARS, text.length)
    const end = chooseChunkEnd(text, start, hardEnd)
    chunks.push({
      start,
      text: text.slice(start, end)
    })
    if (end >= text.length) {
      break
    }
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1)
  }
  return chunks
}

const mergeEntities = (entities) => {
  const sorted = entities
    .filter((entity) => Number.isFinite(entity.start) && Number.isFinite(entity.end) && entity.end > entity.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || b.score - a.score)
  const merged = []
  for (const entity of sorted) {
    const last = merged[merged.length - 1]
    if (!last || entity.start >= last.end) {
      merged.push(entity)
      continue
    }
    const entityLength = entity.end - entity.start
    const lastLength = last.end - last.start
    if (entityLength > lastLength || (entityLength === lastLength && entity.score > last.score)) {
      merged[merged.length - 1] = entity
    }
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end)
}

const maskText = (text, entities) => {
  let cursor = 0
  let masked = ''
  const counts = {}
  const items = []
  for (const entity of entities) {
    if (entity.start < cursor) {
      continue
    }
    masked += text.slice(cursor, entity.start)
    const replacement = `[${entity.label}]`
    const maskedStart = masked.length
    masked += replacement
    const maskedEnd = masked.length
    counts[entity.label] = (counts[entity.label] || 0) + 1
    items.push({
      id: items.length,
      label: entity.label,
      score: entity.score,
      sourceStart: entity.start,
      sourceEnd: entity.end,
      maskedStart,
      maskedEnd,
      replacement
    })
    cursor = entity.end
  }
  masked += text.slice(cursor)
  for (const item of items) {
    const lineStart = masked.lastIndexOf('\n', item.maskedStart - 1) + 1
    const nextLine = masked.indexOf('\n', item.maskedEnd)
    const lineEnd = nextLine >= 0 ? nextLine : masked.length
    item.line = masked.slice(0, item.maskedStart).split('\n').length
    item.context = masked.slice(lineStart, lineEnd).trim()
  }
  return { masked, counts, items }
}

const loadTransformers = async () => {
  if (!transformersPromise) {
    transformersPromise = import(TRANSFORMERS_URL).then((mod) => {
      if (mod.env) {
        mod.env.allowLocalModels = false
        mod.env.allowRemoteModels = true
        mod.env.useBrowserCache = true
        mod.env.useWasmCache = true
        mod.env.cacheKey = 'pinokio-privacy-filter-cache'
      }
      return mod
    })
  }
  return transformersPromise
}

const getPipeline = async (device, dtype) => {
  const nextDevice = device || activeDevice
  const nextDtype = dtype || activeDtype
  const nextKey = `${nextDevice}:${nextDtype}`
  if (pipelinePromise && pipelineKey === nextKey) {
    return pipelinePromise
  }
  activeDevice = nextDevice
  activeDtype = nextDtype
  pipelineKey = nextKey
  pipelinePromise = loadTransformers().then(({ pipeline }) => {
    return pipeline('token-classification', MODEL_ID, {
      device: activeDevice,
      dtype: activeDtype,
      progress_callback: (progress) => {
        if (progress && progress.status === 'progress') {
          post({
            type: 'download',
            file: progress.file || '',
            loaded: progress.loaded || 0,
            total: progress.total || 0,
            progress: progress.progress || 0
          })
        }
      }
    })
  })
  pipelinePromise.catch(() => {
    if (pipelineKey === nextKey) {
      pipelinePromise = null
      pipelineKey = ''
    }
  })
  return pipelinePromise
}

const classifyChunks = async ({ classifier, chunks, id }) => {
  const entities = []
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    post({ type: 'chunk', id, done: index, total: chunks.length })
    const output = await classifier(chunk.text, { aggregation_strategy: 'simple' })
    entities.push(...attachOffsets(chunk.text, output, chunk.start))
  }
  return entities
}

const filterText = async ({ id, text, device, dtype }) => {
  const reportText = String(text || '')
  const chunks = buildChunks(reportText)
  const startedAt = performance.now()
  let requestedDevice = device || activeDevice
  let requestedDtype = dtype || activeDtype
  let classifier = null
  let entities = []
  try {
    classifier = await getPipeline(requestedDevice, requestedDtype)
    entities = await classifyChunks({ classifier, chunks, id })
  } catch (error) {
    if (requestedDevice === 'wasm') {
      throw error
    }
    pipelinePromise = null
    pipelineKey = ''
    requestedDevice = 'wasm'
    requestedDtype = 'q8'
    post({
      type: 'fallback',
      id,
      device: requestedDevice,
      dtype: requestedDtype,
      message: 'WebGPU privacy filtering failed. Retrying locally with WASM.'
    })
    classifier = await getPipeline(requestedDevice, requestedDtype)
    entities = await classifyChunks({ classifier, chunks, id })
  }
  const merged = mergeEntities(prepareMaskEntities(reportText, entities))
  const result = maskText(reportText, merged)
  post({
    type: 'result',
    id,
    text: result.masked,
    entities: merged,
    items: result.items,
    counts: result.counts,
    latencyMs: performance.now() - startedAt,
    device: activeDevice,
    dtype: activeDtype,
    chunks: chunks.length
  })
}

self.addEventListener('message', (event) => {
  const message = event.data || {}
  if (message.type !== 'filter') {
    return
  }
  filterText(message).catch((error) => {
    post({
      type: 'error',
      id: message.id,
      message: error && error.message ? error.message : String(error || 'Privacy filter failed')
    })
  })
})
