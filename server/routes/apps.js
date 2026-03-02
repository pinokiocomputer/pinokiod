const express = require('express')

module.exports = function registerAppRoutes(app, { registry, preferences, appSearch, appLogs, getTheme }) {
  if (!app || !registry || !preferences || !appSearch || !appLogs) {
    throw new Error('App routes require app, registry, preferences, appSearch, and appLogs')
  }

  const router = express.Router()

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
      limit
    })
    res.json(payload)
  }))
  router.get('/apps/search/test', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const payload = q
      ? await appSearch.searchApps(q)
      : { q: '', count: 0, apps: [] }
    res.render('app_search_test', {
      theme: readTheme(),
      agent: req.agent || '',
      query: q,
      result: payload,
      resultJson: JSON.stringify(payload, null, 2)
    })
  }))

  router.get('/apps/status/:app_id', asyncHandler(async (req, res) => {
    const appId = registry.normalizeAppId(req.params.app_id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const probe = registry.parseBooleanQuery(req.query.probe, false)
    const timeout = Number.parseInt(String(req.query.timeout || ''), 10)
    const status = await registry.buildAppStatus(appId, {
      probe,
      timeout: Number.isFinite(timeout) ? timeout : 1500
    })
    if (!status) {
      res.status(404).json({ error: 'App not found', app_id: appId })
      return
    }
    status.preference = await preferences.getPreference(appId)
    res.json(status)
  }))

  router.get('/apps/logs/:app_id', asyncHandler(async (req, res) => {
    const appId = registry.normalizeAppId(req.params.app_id)
    if (!appId) {
      res.status(400).json({ error: 'Invalid app_id' })
      return
    }
    const status = await registry.buildAppStatus(appId)
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
