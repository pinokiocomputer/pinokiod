const express = require('express')

module.exports = function registerAppRoutes(app, { registry, appSearch, appLogs, getTheme }) {
  if (!app || !registry || !appSearch || !appLogs) {
    throw new Error('App routes require app, registry, appSearch, and appLogs')
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
