const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')
const multer = require('multer')
const FormData = require('form-data')
const sanitize = require('sanitize-filename')
const AppLogReportService = require('../lib/app_log_report')

const DEFAULT_PEER_PORT = 42000
const DEFAULT_PEER_TIMEOUT_MS = 2500
const DEFAULT_PEER_UPLOAD_TIMEOUT_MS = 30000
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
const PINOKIO_REF_PROTOCOL = 'pinokio:'

const isQualifiedHost = (value = '') => {
  return IPV4_HOST_PATTERN.test(String(value || '').trim())
}

const parseQualifiedAppId = (value = '') => {
  if (typeof value !== 'string') {
    return {
      app_id: '',
      host: null,
      qualified: false
    }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      app_id: '',
      host: null,
      qualified: false
    }
  }
  const atIndex = trimmed.lastIndexOf('@')
  if (atIndex <= 0 || atIndex >= trimmed.length - 1) {
    return {
      app_id: trimmed,
      host: null,
      qualified: false
    }
  }
  const appId = trimmed.slice(0, atIndex).trim()
  const host = trimmed.slice(atIndex + 1).trim()
  if (!appId || !isQualifiedHost(host)) {
    return {
      app_id: trimmed,
      host: null,
      qualified: false
    }
  }
  return {
    app_id: appId,
    host,
    qualified: true
  }
}

const isLoopbackHost = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '[::1]'
}

const parsePinokioRef = (value = '') => {
  if (typeof value !== 'string') {
    return {
      valid: false,
      error: 'Invalid ref'
    }
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      valid: false,
      error: 'Missing ref'
    }
  }
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch (_) {
    return {
      valid: false,
      error: 'Invalid ref'
    }
  }
  if (parsed.protocol !== PINOKIO_REF_PROTOCOL) {
    return {
      valid: false,
      error: 'Invalid ref protocol'
    }
  }
  const host = typeof parsed.hostname === 'string' ? parsed.hostname.trim() : ''
  const port = Number.parseInt(String(parsed.port || ''), 10)
  const pathSegments = String(parsed.pathname || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch (_) {
        return segment
      }
    })
  const scope = pathSegments.length > 0 ? pathSegments[0] : ''
  const id = pathSegments.length > 1 ? pathSegments.slice(1).join('/') : ''
  if (!host || !Number.isFinite(port) || port <= 0 || !scope || !id) {
    return {
      valid: false,
      error: 'Invalid ref'
    }
  }
  return {
    valid: true,
    ref: trimmed,
    host,
    port,
    scope,
    id
  }
}

const buildPinokioRef = ({ host, port, scope, id }) => {
  const normalizedHost = typeof host === 'string' ? host.trim() : ''
  const normalizedScope = typeof scope === 'string' ? scope.trim() : ''
  const normalizedId = typeof id === 'string' ? id.trim() : ''
  const normalizedPort = Number.parseInt(String(port || ''), 10)
  if (!normalizedHost || !normalizedScope || !normalizedId || !Number.isFinite(normalizedPort) || normalizedPort <= 0) {
    return null
  }
  const encodedPath = [normalizedScope, ...normalizedId.split('/').filter(Boolean)]
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `pinokio://${normalizedHost}:${normalizedPort}/${encodedPath}`
}

module.exports = function registerAppRoutes(app, { registry, preferences, appSearch, appLogs, appLogReports, getTheme }) {
  if (!app || !registry || !preferences || !appSearch || !appLogs) {
    throw new Error('App routes require app, registry, preferences, appSearch, and appLogs')
  }
  const appLogReportService = appLogReports || new AppLogReportService({ registry })

  const router = express.Router()
  const upload = multer()

  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
  const readTheme = () => {
    if (typeof getTheme === 'function') {
      return getTheme()
    }
    return 'light'
  }
  const parseBooleanInput = (value, fallback = false) => {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'number') {
      return value !== 0
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false
      }
    }
    return fallback
  }
  const includePeersForSearch = (req) => {
    const scope = typeof req.query.peer_scope === 'string' ? req.query.peer_scope.trim().toLowerCase() : ''
    if (scope === 'local') {
      return false
    }
    return parseBooleanInput(req.query.include_peers, true)
  }
  const currentPeerHost = () => {
    return registry?.kernel?.peer?.host ? String(registry.kernel.peer.host).trim() : ''
  }
  const currentPeerName = () => {
    return registry?.kernel?.peer?.name ? String(registry.kernel.peer.name).trim() : ''
  }
  const buildSource = (host, local = false) => {
    const peerInfo = host && registry?.kernel?.peer?.info ? registry.kernel.peer.info[host] : null
    const name = peerInfo && peerInfo.name ? peerInfo.name : (local ? currentPeerName() : '')
    return {
      host: host || null,
      name: name || host || null,
      local: Boolean(local)
    }
  }
  const qualifyAppId = (appId, host) => {
    const normalizedAppId = typeof appId === 'string' ? appId.trim() : ''
    if (!normalizedAppId || !host || host === currentPeerHost()) {
      return normalizedAppId
    }
    return `${normalizedAppId}@${host}`
  }
  const canonicalRefHost = (source, overrideHost = '') => {
    const hostOverride = typeof overrideHost === 'string' ? overrideHost.trim() : ''
    if (hostOverride) {
      return hostOverride
    }
    if (source && typeof source.host === 'string' && source.host.trim()) {
      return source.host.trim()
    }
    return currentPeerHost() || '127.0.0.1'
  }
  const isLocalPinokioRef = (parsedRef) => {
    if (!parsedRef || !parsedRef.valid) {
      return false
    }
    if (parsedRef.port !== peerPort()) {
      return false
    }
    const localHost = currentPeerHost()
    return isLoopbackHost(parsedRef.host) || (localHost && parsedRef.host === localHost)
  }
  const attachApiRef = (payload, source, appId, options = {}) => {
    const next = payload && typeof payload === 'object' ? { ...payload } : {}
    const normalizedAppId = typeof appId === 'string' ? appId.trim() : ''
    if (!normalizedAppId) {
      return next
    }
    const ref = buildPinokioRef({
      host: canonicalRefHost(source, options.host),
      port: Number.parseInt(String(options.port || peerPort()), 10) || peerPort(),
      scope: 'api',
      id: normalizedAppId
    })
    if (ref) {
      next.ref = ref
    }
    return next
  }
  const neutralizeRemoteSearchPreferences = (appResult) => {
    const next = appResult && typeof appResult === 'object' ? { ...appResult } : {}
    next.starred = false
    next.starred_at = null
    next.last_launch_at = null
    next.last_launch_source = 'unknown'
    next.launch_count_total = 0
    next.launch_count_pterm = 0
    next.launch_count_ui = 0
    next.preference_boost = 0
    if (typeof next.score === 'number') {
      next.adjusted_score = next.score
    } else {
      next.adjusted_score = null
    }
    return next
  }
  const runtimeRank = (appResult) => {
    if (appResult && appResult.ready) {
      return 2
    }
    if (appResult && appResult.running) {
      return 1
    }
    return 0
  }
  const parseTimestamp = (value) => {
    if (typeof value !== 'string' || !value.trim()) {
      return 0
    }
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const decorateSearchResult = (appResult, source, options = {}) => {
    const next = source && !source.local
      ? neutralizeRemoteSearchPreferences(appResult)
      : (appResult && typeof appResult === 'object' ? { ...appResult } : {})
    const resourceId = typeof next.app_id === 'string' && next.app_id.trim()
      ? next.app_id.trim()
      : (typeof next.name === 'string' ? next.name.trim() : '')
    next.app_id = qualifyAppId(resourceId, source.host)
    next.source = source
    if (!source.local) {
      next.ready_url = null
    }
    return attachApiRef(next, source, resourceId, options)
  }
  const decorateStatusResult = (statusResult, source, options = {}) => {
    const next = statusResult && typeof statusResult === 'object' ? { ...statusResult } : {}
    const resourceId = typeof next.app_id === 'string' && next.app_id.trim()
      ? next.app_id.trim()
      : (typeof next.name === 'string' ? next.name.trim() : '')
    next.app_id = qualifyAppId(resourceId, source.host)
    next.source = source
    if (!source.local) {
      next.ready_url = null
    }
    return attachApiRef(next, source, resourceId, options)
  }
  const peerRequestHeaders = (req) => {
    const headers = {
      'x-pinokio-peer': '1'
    }
    if (req && req.$source && typeof req.$source.host === 'string' && req.$source.host.trim()) {
      headers['x-pinokio-source-host'] = req.$source.host.trim()
    }
    if (req && req.$source && typeof req.$source.protocol === 'string' && req.$source.protocol.trim()) {
      headers['x-pinokio-source-proto'] = req.$source.protocol.trim()
    }
    return headers
  }
  const peerPort = () => {
    const rawPort = Number.parseInt(String(registry?.kernel?.peer?.default_port || registry?.kernel?.server_port || DEFAULT_PEER_PORT), 10)
    return Number.isFinite(rawPort) && rawPort > 0 ? rawPort : DEFAULT_PEER_PORT
  }
  const remotePeerHosts = () => {
    const localHost = currentPeerHost()
    const info = registry?.kernel?.peer?.info
    if (!info || typeof info !== 'object') {
      return []
    }
    return Object.keys(info).filter((host) => host && host !== localHost)
  }
  const uniqueUploadPath = async (directory, originalName) => {
    const parsed = path.parse(originalName)
    const baseName = parsed.name || 'upload'
    const ext = parsed.ext || ''
    let counter = 0
    while (true) {
      const candidateName = counter === 0
        ? `${baseName}${ext}`
        : `${baseName}-${counter}${ext}`
      const candidatePath = path.join(directory, candidateName)
      try {
        await fs.promises.access(candidatePath)
        counter += 1
      } catch (_) {
        return {
          name: candidateName,
          path: candidatePath
        }
      }
    }
  }
  const storeAppUploads = async (appPath, files = []) => {
    const token = crypto.randomBytes(16).toString('hex')
    const uploadDir = path.join(appPath, '.pinokio-temp', 'uploads', token)
    await fs.promises.mkdir(uploadDir, { recursive: true })
    const stored = []
    for (const file of files) {
      if (!file || !file.buffer) {
        continue
      }
      const originalName = path.basename(typeof file.originalname === 'string' && file.originalname.trim()
        ? file.originalname.trim()
        : 'upload')
      const safeName = sanitize(originalName) || `upload-${Date.now()}`
      const target = await uniqueUploadPath(uploadDir, safeName)
      await fs.promises.writeFile(target.path, file.buffer)
      stored.push({
        name: originalName,
        path: target.path,
        size: typeof file.size === 'number' ? file.size : file.buffer.length,
        mimeType: typeof file.mimetype === 'string' ? file.mimetype : ''
      })
    }
    return {
      token,
      files: stored
    }
  }
  const decorateUploadResult = (uploadResult, source, appId, options = {}) => {
    const next = uploadResult && typeof uploadResult === 'object' ? { ...uploadResult } : {}
    next.app_id = qualifyAppId(appId || next.app_id || '', source.host)
    next.source = source
    return attachApiRef(next, source, appId || next.app_id || '', options)
  }
  const mergeSearchApps = (localApps, remoteApps, query = '') => {
    const merged = []
    const seen = new Set()
    const push = (items = []) => {
      for (const item of items) {
        if (!item || !item.app_id) {
          continue
        }
        if (seen.has(item.app_id)) {
          continue
        }
        seen.add(item.app_id)
        merged.push(item)
      }
    }
    push(localApps)
    push(remoteApps)
    return merged.sort((a, b) => {
      const aRuntimeRank = runtimeRank(a)
      const bRuntimeRank = runtimeRank(b)
      if (aRuntimeRank !== bRuntimeRank) {
        return bRuntimeRank - aRuntimeRank
      }
      const normalizedQuery = typeof query === 'string' ? query.trim() : ''
      if (!normalizedQuery) {
        const aStarred = a && a.starred ? 1 : 0
        const bStarred = b && b.starred ? 1 : 0
        if (aStarred !== bStarred) {
          return bStarred - aStarred
        }
        const aLaunchCount = Math.max(0, Number.parseInt(String(a && a.launch_count_total || 0), 10) || 0)
        const bLaunchCount = Math.max(0, Number.parseInt(String(b && b.launch_count_total || 0), 10) || 0)
        if (aLaunchCount !== bLaunchCount) {
          return bLaunchCount - aLaunchCount
        }
        const aLastLaunch = parseTimestamp(a && a.last_launch_at)
        const bLastLaunch = parseTimestamp(b && b.last_launch_at)
        if (aLastLaunch !== bLastLaunch) {
          return bLastLaunch - aLastLaunch
        }
        return String(a.app_id || '').localeCompare(String(b.app_id || ''))
      }
      const aAdjusted = typeof a.adjusted_score === 'number' ? a.adjusted_score : -Infinity
      const bAdjusted = typeof b.adjusted_score === 'number' ? b.adjusted_score : -Infinity
      if (aAdjusted !== bAdjusted) {
        return bAdjusted - aAdjusted
      }
      const aScore = typeof a.score === 'number' ? a.score : -Infinity
      const bScore = typeof b.score === 'number' ? b.score : -Infinity
      if (aScore !== bScore) {
        return bScore - aScore
      }
      return String(a.app_id || '').localeCompare(String(b.app_id || ''))
    })
  }
  const fetchPeerSearchResults = async (req, { q, mode, minMatch, limit }) => {
    const hosts = remotePeerHosts()
    if (hosts.length === 0) {
      return []
    }
    const timeout = DEFAULT_PEER_TIMEOUT_MS
    const port = peerPort()
    const headers = peerRequestHeaders(req)
    const requests = hosts.map(async (host) => {
      try {
        const response = await axios.get(`http://${host}:${port}/apps/search`, {
          timeout,
          headers,
          params: {
            q,
            mode,
            min_match: minMatch,
            limit,
            peer_scope: 'local'
          }
        })
        const source = buildSource(host, false)
        const apps = Array.isArray(response?.data?.apps)
          ? response.data.apps.map((appResult) => decorateSearchResult(appResult, source))
          : []
        return apps
      } catch (_) {
        return []
      }
    })
    const results = await Promise.all(requests)
    return results.flat()
  }

  router.get('/apps/preferences', asyncHandler(async (req, res) => {
    const queryAppId = typeof req.query.app_id === 'string' ? registry.normalizeAppId(req.query.app_id) : ''
    if (queryAppId) {
      const preference = await preferences.getPreference(queryAppId)
      res.json({
        app_id: queryAppId,
        preference: preference || null
      })
      return
    }
    const items = await preferences.readPreferences()
    res.json({
      count: Object.keys(items).length,
      items
    })
  }))

  router.get('/apps/preferences/:app_id', asyncHandler(async (req, res) => {
    const appId = registry.normalizeAppId(req.params.app_id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const preference = await preferences.getPreference(appId)
    res.json({
      app_id: appId,
      preference: preference || null
    })
  }))

  router.put('/apps/preferences/:app_id', asyncHandler(async (req, res) => {
    const appId = registry.normalizeAppId(req.params.app_id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const parsedAppId = parseQualifiedAppId(appId)
    if (parsedAppId.qualified && parsedAppId.host !== currentPeerHost()) {
      res.status(400).json({ error: 'Remote app preferences are not supported' })
      return
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const hasStarred = Object.prototype.hasOwnProperty.call(body, 'starred')
    const hasProtectionEnabled = Object.prototype.hasOwnProperty.call(body, 'protection_enabled')
    if (!hasStarred && !hasProtectionEnabled) {
      res.status(400).json({ error: 'Missing required field: starred or protection_enabled' })
      return
    }
    const updates = {}
    if (hasStarred) {
      updates.starred = parseBooleanInput(body.starred, false)
    }
    if (hasProtectionEnabled) {
      updates.protection_enabled = parseBooleanInput(body.protection_enabled, true)
    }
    const next = await preferences.updatePreference(appId, updates)
    res.json({
      app_id: appId,
      preference: next
    })
  }))

  router.get('/info/apps', asyncHandler(async (req, res) => {
    const apps = await registry.listInfoApps()
    res.json({ apps })
  }))

  router.get('/pinokio/resource/status', asyncHandler(async (req, res) => {
    const parsedRef = parsePinokioRef(typeof req.query.ref === 'string' ? req.query.ref : '')
    if (!parsedRef.valid) {
      res.status(400).json({ error: parsedRef.error || 'Invalid ref' })
      return
    }
    if (parsedRef.scope !== 'api') {
      res.status(400).json({ error: `Unsupported ref scope: ${parsedRef.scope}` })
      return
    }
    const canonicalRef = buildPinokioRef(parsedRef)
    if (!isLocalPinokioRef(parsedRef)) {
      try {
        const timeout = Number.parseInt(String(req.query.timeout || ''), 10)
        const params = { ref: canonicalRef }
        if (typeof req.query.probe !== 'undefined') {
          params.probe = req.query.probe
        }
        if (Number.isFinite(timeout)) {
          params.timeout = String(timeout)
        }
        const response = await axios.get(`http://${parsedRef.host}:${parsedRef.port}/pinokio/resource/status`, {
          timeout: DEFAULT_PEER_TIMEOUT_MS,
          headers: peerRequestHeaders(req),
          params
        })
        const payload = decorateStatusResult(response.data, buildSource(parsedRef.host, false), {
          host: parsedRef.host,
          port: parsedRef.port
        })
        payload.app_id = parsedRef.id
        payload.ref = canonicalRef
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer resource status unavailable',
          ref: canonicalRef,
          source: buildSource(parsedRef.host, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(parsedRef.id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id', ref: canonicalRef })
      return
    }
    const probe = registry.parseBooleanQuery(req.query.probe, false)
    const timeout = Number.parseInt(String(req.query.timeout || ''), 10)
    const status = await registry.buildAppStatus(appId, {
      probe,
      timeout: Number.isFinite(timeout) ? timeout : 1500,
      source: req.$source || null
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', ref: canonicalRef })
      return
    }
    status.preference = await preferences.getPreference(appId)
    const payload = decorateStatusResult(status, buildSource(currentPeerHost(), true), {
      host: parsedRef.host,
      port: parsedRef.port
    })
    payload.app_id = appId
    payload.ref = canonicalRef
    res.json(payload)
  }))

  router.get('/pinokio/resource/logs', asyncHandler(async (req, res) => {
    const parsedRef = parsePinokioRef(typeof req.query.ref === 'string' ? req.query.ref : '')
    if (!parsedRef.valid) {
      res.status(400).json({ error: parsedRef.error || 'Invalid ref' })
      return
    }
    if (parsedRef.scope !== 'api') {
      res.status(400).json({ error: `Unsupported ref scope: ${parsedRef.scope}` })
      return
    }
    const canonicalRef = buildPinokioRef(parsedRef)
    if (!isLocalPinokioRef(parsedRef)) {
      try {
        const params = { ref: canonicalRef }
        if (typeof req.query.script === 'string' && req.query.script.trim()) {
          params.script = req.query.script
        }
        const tail = registry.parseTailCount(req.query.tail, 200)
        if (Number.isFinite(tail) && tail > 0) {
          params.tail = String(tail)
        }
        const response = await axios.get(`http://${parsedRef.host}:${parsedRef.port}/pinokio/resource/logs`, {
          timeout: DEFAULT_PEER_TIMEOUT_MS,
          headers: peerRequestHeaders(req),
          params
        })
        const payload = response && response.data && typeof response.data === 'object'
          ? { ...response.data }
          : {}
        payload.app_id = parsedRef.id
        payload.ref = canonicalRef
        payload.source = buildSource(parsedRef.host, false)
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer resource logs unavailable',
          ref: canonicalRef,
          source: buildSource(parsedRef.host, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(parsedRef.id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id', ref: canonicalRef })
      return
    }
    const status = await registry.buildAppStatus(appId, {
      source: req.$source || null
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', ref: canonicalRef })
      return
    }
    const tail = registry.parseTailCount(req.query.tail, 200)
    const scriptQuery = typeof req.query.script === 'string' ? req.query.script : ''
    const resolvedLog = await appLogs.resolveAppLogFile(status.path, scriptQuery, status.running_scripts)
    if (resolvedLog && resolvedLog.error === 'INVALID_SCRIPT') {
      res.status(400).json({ error: 'Invalid script path', ref: canonicalRef })
      return
    }
    if (!resolvedLog || !resolvedLog.file) {
      res.status(404).json({
        error: 'No log file found',
        ref: canonicalRef,
        script: scriptQuery || null
      })
      return
    }
    const logData = await appLogs.readLogTail(resolvedLog.file, tail)
    res.json({
      app_id: appId,
      ref: canonicalRef,
      source: buildSource(currentPeerHost(), true),
      script: resolvedLog.script,
      file: registry.toPosixRelative(status.path, resolvedLog.file),
      ...logData
    })
  }))

  router.post('/pinokio/resource/upload', upload.any(), asyncHandler(async (req, res) => {
    const rawRef = typeof req.query.ref === 'string' && req.query.ref.trim()
      ? req.query.ref
      : (req.body && typeof req.body.ref === 'string' ? req.body.ref : '')
    const parsedRef = parsePinokioRef(rawRef)
    if (!parsedRef.valid) {
      res.status(400).json({ error: parsedRef.error || 'Invalid ref' })
      return
    }
    if (parsedRef.scope !== 'api') {
      res.status(400).json({ error: `Unsupported ref scope: ${parsedRef.scope}` })
      return
    }
    const canonicalRef = buildPinokioRef(parsedRef)
    const files = Array.isArray(req.files) ? req.files : []
    if (files.length === 0) {
      res.status(400).json({ error: 'No files provided', ref: canonicalRef })
      return
    }
    if (!isLocalPinokioRef(parsedRef)) {
      try {
        const form = new FormData()
        for (const file of files) {
          if (!file || !file.buffer) {
            continue
          }
          form.append('files', file.buffer, {
            filename: path.basename(file.originalname || 'upload'),
            contentType: file.mimetype || 'application/octet-stream',
            knownLength: typeof file.size === 'number' ? file.size : file.buffer.length
          })
        }
        const response = await axios.post(`http://${parsedRef.host}:${parsedRef.port}/pinokio/resource/upload`, form, {
          timeout: DEFAULT_PEER_UPLOAD_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            ...peerRequestHeaders(req),
            ...form.getHeaders()
          },
          params: {
            ref: canonicalRef
          }
        })
        const payload = response && response.data && typeof response.data === 'object'
          ? { ...response.data }
          : {}
        payload.app_id = parsedRef.id
        payload.ref = canonicalRef
        payload.source = buildSource(parsedRef.host, false)
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer resource upload unavailable',
          ref: canonicalRef,
          source: buildSource(parsedRef.host, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(parsedRef.id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id', ref: canonicalRef })
      return
    }
    const status = await registry.buildAppStatus(appId, {
      source: req.$source || null
    })
    if (!status || !status.path) {
      res.status(404).json({ error: 'App not found', ref: canonicalRef })
      return
    }
    const payload = await storeAppUploads(status.path, files)
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      res.status(400).json({ error: 'No valid files provided', ref: canonicalRef })
      return
    }
    const decorated = decorateUploadResult(payload, buildSource(currentPeerHost(), true), appId, {
      host: parsedRef.host,
      port: parsedRef.port
    })
    decorated.app_id = appId
    decorated.ref = canonicalRef
    res.json(decorated)
  }))

  router.get('/apps/search', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const mode = typeof req.query.mode === 'string' ? req.query.mode : ''
    const minMatch = typeof req.query.min_match === 'string' ? req.query.min_match : ''
    const limit = typeof req.query.limit === 'string' ? req.query.limit : ''
    const payload = await appSearch.searchApps(q, {
      mode,
      min_match: minMatch,
      limit,
      source: req.$source || null
    })
    const localSource = buildSource(currentPeerHost(), true)
    payload.apps = Array.isArray(payload.apps)
      ? payload.apps.map((appResult) => decorateSearchResult(appResult, localSource))
      : []
    if (includePeersForSearch(req)) {
      const remoteApps = await fetchPeerSearchResults(req, { q, mode, minMatch, limit })
      payload.apps = mergeSearchApps(payload.apps, remoteApps, q)
      payload.count = payload.apps.length
    }
    res.json(payload)
  }))
  router.get('/apps/search/test', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const payload = q
      ? await appSearch.searchApps(q, {
        source: req.$source || null,
        mode: typeof req.query.mode === 'string' ? req.query.mode : '',
        min_match: typeof req.query.min_match === 'string' ? req.query.min_match : '',
        limit: typeof req.query.limit === 'string' ? req.query.limit : ''
      })
      : { q: '', count: 0, apps: [] }
    const localSource = buildSource(currentPeerHost(), true)
    payload.apps = Array.isArray(payload.apps)
      ? payload.apps.map((appResult) => decorateSearchResult(appResult, localSource))
      : []
    if (q && includePeersForSearch(req)) {
      const remoteApps = await fetchPeerSearchResults(req, {
        q,
        mode: typeof req.query.mode === 'string' ? req.query.mode : '',
        minMatch: typeof req.query.min_match === 'string' ? req.query.min_match : '',
        limit: typeof req.query.limit === 'string' ? req.query.limit : ''
      })
      payload.apps = mergeSearchApps(payload.apps, remoteApps, q)
      payload.count = payload.apps.length
    }
    res.render('app_search_test', {
      theme: readTheme(),
      agent: req.agent || '',
      query: q,
      result: payload,
      resultJson: JSON.stringify(payload, null, 2)
    })
  }))

  router.post('/apps/:app_id/upload', upload.any(), asyncHandler(async (req, res) => {
    const parsedAppId = parseQualifiedAppId(req.params.app_id)
    const requestedAppId = parsedAppId.app_id || req.params.app_id
    const remoteHost = parsedAppId.qualified ? parsedAppId.host : null
    const files = Array.isArray(req.files) ? req.files : []
    if (files.length === 0) {
      res.status(400).json({ error: 'No files provided' })
      return
    }
    if (remoteHost && remoteHost !== currentPeerHost()) {
      try {
        const form = new FormData()
        for (const file of files) {
          if (!file || !file.buffer) {
            continue
          }
          form.append('files', file.buffer, {
            filename: path.basename(file.originalname || 'upload'),
            contentType: file.mimetype || 'application/octet-stream',
            knownLength: typeof file.size === 'number' ? file.size : file.buffer.length
          })
        }
        const response = await axios.post(`http://${remoteHost}:${peerPort()}/apps/${encodeURIComponent(requestedAppId)}/upload`, form, {
          timeout: DEFAULT_PEER_UPLOAD_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            ...peerRequestHeaders(req),
            ...form.getHeaders()
          }
        })
        res.json(decorateUploadResult(response.data, buildSource(remoteHost, false), requestedAppId))
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer upload unavailable',
          app_id: qualifyAppId(requestedAppId, remoteHost),
          source: buildSource(remoteHost, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(requestedAppId)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const status = await registry.buildAppStatus(appId, {
      source: req.$source || null
    })
    if (!status || !status.path) {
      res.status(404).json({ error: 'App not found', app_id: appId })
      return
    }
    const payload = await storeAppUploads(status.path, files)
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      res.status(400).json({ error: 'No valid files provided', app_id: appId })
      return
    }
    res.json(decorateUploadResult(payload, buildSource(currentPeerHost(), true), appId))
  }))

  router.get('/apps/status/:app_id', asyncHandler(async (req, res) => {
    const parsedAppId = parseQualifiedAppId(req.params.app_id)
    const requestedAppId = parsedAppId.app_id || req.params.app_id
    const remoteHost = parsedAppId.qualified ? parsedAppId.host : null
    if (remoteHost && remoteHost !== currentPeerHost()) {
      try {
        const timeout = Number.parseInt(String(req.query.timeout || ''), 10)
        const params = {}
        if (typeof req.query.probe !== 'undefined') {
          params.probe = req.query.probe
        }
        if (Number.isFinite(timeout)) {
          params.timeout = String(timeout)
        }
        const response = await axios.get(`http://${remoteHost}:${peerPort()}/apps/status/${encodeURIComponent(requestedAppId)}`, {
          timeout: DEFAULT_PEER_TIMEOUT_MS,
          headers: peerRequestHeaders(req),
          params
        })
        const payload = decorateStatusResult(response.data, buildSource(remoteHost, false))
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer status unavailable',
          app_id: qualifyAppId(requestedAppId, remoteHost),
          source: buildSource(remoteHost, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(requestedAppId)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const probe = registry.parseBooleanQuery(req.query.probe, false)
    const timeout = Number.parseInt(String(req.query.timeout || ''), 10)
    const status = await registry.buildAppStatus(appId, {
      probe,
      timeout: Number.isFinite(timeout) ? timeout : 1500,
      source: req.$source || null
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', app_id: appId })
      return
    }
    status.preference = await preferences.getPreference(appId)
    res.json(decorateStatusResult(status, buildSource(currentPeerHost(), true)))
  }))

  router.get('/apps/logs/:app_id', asyncHandler(async (req, res) => {
    const parsedAppId = parseQualifiedAppId(req.params.app_id)
    const requestedAppId = parsedAppId.app_id || req.params.app_id
    const remoteHost = parsedAppId.qualified ? parsedAppId.host : null
    if (remoteHost && remoteHost !== currentPeerHost()) {
      try {
        const params = {}
        if (typeof req.query.script === 'string' && req.query.script.trim()) {
          params.script = req.query.script
        }
        const tail = registry.parseTailCount(req.query.tail, 200)
        if (Number.isFinite(tail) && tail > 0) {
          params.tail = String(tail)
        }
        const response = await axios.get(`http://${remoteHost}:${peerPort()}/apps/logs/${encodeURIComponent(requestedAppId)}`, {
          timeout: DEFAULT_PEER_TIMEOUT_MS,
          headers: peerRequestHeaders(req),
          params
        })
        const payload = response && response.data && typeof response.data === 'object'
          ? { ...response.data }
          : {}
        payload.app_id = qualifyAppId(requestedAppId, remoteHost)
        payload.source = buildSource(remoteHost, false)
        payload.ref = buildPinokioRef({
          host: remoteHost,
          port: peerPort(),
          scope: 'api',
          id: requestedAppId
        })
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer logs unavailable',
          app_id: qualifyAppId(requestedAppId, remoteHost),
          source: buildSource(remoteHost, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(requestedAppId)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const status = await registry.buildAppStatus(appId, {
      source: req.$source || null
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', app_id: appId })
      return
    }
    const tail = registry.parseTailCount(req.query.tail, 200)
    const scriptQuery = typeof req.query.script === 'string' ? req.query.script : ''
    const resolvedLog = await appLogs.resolveAppLogFile(status.path, scriptQuery, status.running_scripts)
    if (resolvedLog && resolvedLog.error === 'INVALID_SCRIPT') {
      res.status(400).json({ error: 'Invalid script path' })
      return
    }
    if (!resolvedLog || !resolvedLog.file) {
      res.status(404).json({
        error: 'No log file found',
        app_id: appId,
        script: scriptQuery || null
      })
      return
    }
    const logData = await appLogs.readLogTail(resolvedLog.file, tail)
    res.json({
      app_id: appId,
      ref: buildPinokioRef({
        host: currentPeerHost() || '127.0.0.1',
        port: peerPort(),
        scope: 'api',
        id: appId
      }),
      script: resolvedLog.script,
      source: resolvedLog.source,
      file: registry.toPosixRelative(status.path, resolvedLog.file),
      ...logData
    })
  }))

  router.get('/apps/logs/:app_id/report', asyncHandler(async (req, res) => {
    const parsedAppId = parseQualifiedAppId(req.params.app_id)
    const requestedAppId = parsedAppId.app_id || req.params.app_id
    const remoteHost = parsedAppId.qualified ? parsedAppId.host : null
    if (remoteHost && remoteHost !== currentPeerHost()) {
      try {
        const params = {}
        const tail = registry.parseTailCount(req.query.tail, 800)
        if (Number.isFinite(tail) && tail > 0) {
          params.tail = String(tail)
        }
        if (req.query.redaction === 'none') {
          params.redaction = 'none'
        }
        const response = await axios.get(`http://${remoteHost}:${peerPort()}/apps/logs/${encodeURIComponent(requestedAppId)}/report`, {
          timeout: DEFAULT_PEER_TIMEOUT_MS,
          headers: peerRequestHeaders(req),
          params
        })
        const payload = response && response.data && typeof response.data === 'object'
          ? { ...response.data }
          : {}
        payload.app_id = qualifyAppId(requestedAppId, remoteHost)
        payload.source = buildSource(remoteHost, false)
        payload.ref = buildPinokioRef({
          host: remoteHost,
          port: peerPort(),
          scope: 'api',
          id: requestedAppId
        })
        res.json(payload)
        return
      } catch (error) {
        if (error && error.response) {
          res.status(error.response.status).json(error.response.data)
          return
        }
        res.status(502).json({
          error: 'Peer log report unavailable',
          app_id: qualifyAppId(requestedAppId, remoteHost),
          source: buildSource(remoteHost, false)
        })
        return
      }
    }
    const appId = registry.normalizeAppId(requestedAppId)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const status = await registry.buildAppStatus(appId, {
      source: req.$source || null
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', app_id: appId })
      return
    }
    const tail = registry.parseTailCount(req.query.tail, 800)
    const report = await appLogReportService.buildReport({
      appId,
      status,
      tail,
      redact: req.query.redaction !== 'none'
    })
    if (!report) {
      res.status(404).json({ error: 'No log report available', app_id: appId })
      return
    }
    res.json({
      app_id: appId,
      ref: buildPinokioRef({
        host: currentPeerHost() || '127.0.0.1',
        port: peerPort(),
        scope: 'api',
        id: appId
      }),
      source: buildSource(currentPeerHost(), true),
      ...report
    })
  }))

  app.use(router)
}
