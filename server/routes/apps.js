const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const axios = require('axios')
const multer = require('multer')
const FormData = require('form-data')
const sanitize = require('sanitize-filename')

const DEFAULT_PEER_PORT = 42000
const DEFAULT_PEER_TIMEOUT_MS = 2500
const DEFAULT_PEER_UPLOAD_TIMEOUT_MS = 30000
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/

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

module.exports = function registerAppRoutes(app, { registry, preferences, appSearch, appLogs, getTheme }) {
  if (!app || !registry || !preferences || !appSearch || !appLogs) {
    throw new Error('App routes require app, registry, preferences, appSearch, and appLogs')
  }

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
  const decorateSearchResult = (appResult, source) => {
    const next = source && !source.local
      ? neutralizeRemoteSearchPreferences(appResult)
      : (appResult && typeof appResult === 'object' ? { ...appResult } : {})
    next.app_id = qualifyAppId(next.app_id || next.name || '', source.host)
    next.source = source
    if (!source.local) {
      next.ready_url = null
    }
    return next
  }
  const decorateStatusResult = (statusResult, source) => {
    const next = statusResult && typeof statusResult === 'object' ? { ...statusResult } : {}
    next.app_id = qualifyAppId(next.app_id || next.name || '', source.host)
    next.source = source
    if (!source.local) {
      next.ready_url = null
    }
    return next
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
  const decorateUploadResult = (uploadResult, source, appId) => {
    const next = uploadResult && typeof uploadResult === 'object' ? { ...uploadResult } : {}
    next.app_id = qualifyAppId(appId || next.app_id || '', source.host)
    next.source = source
    return next
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
    if (!hasStarred) {
      res.status(400).json({ error: 'Missing required field: starred' })
      return
    }
    const starred = parseBooleanInput(body.starred, false)
    const next = await preferences.setStar(appId, starred)
    res.json({
      app_id: appId,
      preference: next
    })
  }))

  router.get('/info/apps', asyncHandler(async (req, res) => {
    const apps = await registry.listInfoApps()
    res.json({ apps })
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
    const appId = registry.normalizeAppId(req.params.app_id)
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
      script: resolvedLog.script,
      source: resolvedLog.source,
      file: registry.toPosixRelative(status.path, resolvedLog.file),
      ...logData
    })
  }))

  app.use(router)
}
