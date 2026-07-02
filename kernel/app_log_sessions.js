const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { AsyncLocalStorage } = require('async_hooks')
const Environment = require('./environment')

class AppLogSessions {
  constructor({ kernel, now = () => new Date().toISOString(), randomHex = () => crypto.randomBytes(3).toString('hex') }) {
    this.kernel = kernel
    this.now = now
    this.randomHex = randomHex
    this.context = new AsyncLocalStorage()
    this.reservations = new Map()
    this.routineSessions = new Map()
    this.sessions = new Map()
    this.activeRunsByKey = new Map()
    this.indexQueues = new Map()
  }

  apiRoot() {
    if (this.kernel && typeof this.kernel.path === 'function') {
      return path.resolve(this.kernel.path('api'))
    }
    return path.resolve(this.kernel.homedir || '', 'api')
  }

  toPosix(value) {
    return String(value || '').split(path.sep).filter(Boolean).join('/')
  }

  isPathWithin(parentPath, childPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  sessionDir(appRoot) {
    return path.resolve(appRoot, 'logs', 'sessions')
  }

  indexPath(appRoot) {
    return path.resolve(this.sessionDir(appRoot), 'index.json')
  }

  manifestPath(appRoot, sessionId) {
    if (!this.validSessionId(sessionId)) {
      return null
    }
    return path.resolve(this.sessionDir(appRoot), `${sessionId}.json`)
  }

  sessionKey(appRoot, sessionId) {
    return `${path.resolve(appRoot)}\u0000${sessionId}`
  }

  reservationKey(target) {
    return `${path.resolve(target.appRoot)}\u0000${path.resolve(target.scriptPath)}`
  }

  validSessionId(sessionId) {
    return typeof sessionId === 'string' && /^[A-Za-z0-9._-]+$/.test(sessionId)
  }

  async resolveAppRoot(appRoot) {
    if (this.kernel && typeof this.kernel.exists === 'function') {
      try {
        const root = await Environment.get_root({ path: appRoot }, this.kernel)
        if (root && root.root) {
          return path.resolve(root.root)
        }
      } catch (_) {}
    }
    return appRoot
  }

  async resolveScript(scriptPath) {
    if (typeof scriptPath !== 'string' || !scriptPath.trim()) {
      return null
    }
    const absolute = path.resolve(scriptPath.split('?')[0])
    const apiRoot = this.apiRoot()
    if (!this.isPathWithin(apiRoot, absolute)) {
      return null
    }
    const relative = path.relative(apiRoot, absolute)
    const parts = relative.split(path.sep).filter(Boolean)
    if (parts.length < 2 || !parts[0]) {
      return null
    }
    const appRoot = await this.resolveAppRoot(path.resolve(apiRoot, parts[0]))
    return {
      appRoot,
      scriptPath: absolute,
      script: this.toPosix(parts.slice(1).join(path.sep))
    }
  }

  requestKeys(requestOrRun) {
    const keys = []
    if (!requestOrRun || typeof requestOrRun !== 'object') {
      return keys
    }
    for (const key of [requestOrRun.id, requestOrRun.path]) {
      if (typeof key === 'string' && key.trim() && !keys.includes(key)) {
        keys.push(key)
      }
    }
    return keys
  }

  createSessionId(timestamp) {
    const safeTime = String(timestamp || this.now()).replace(/[^A-Za-z0-9._-]/g, '-')
    return `${safeTime}-${this.randomHex()}`
  }

  async readJson(filePath) {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
    } catch (_) {
      return null
    }
  }

  async writeJson(filePath, value) {
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2))
    } catch (_) {}
  }

  async loadIndex(appRoot) {
    const parsed = await this.readJson(this.indexPath(appRoot))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
      return { version: 1, latest_session: null, sessions: [] }
    }
    return {
      version: 1,
      latest_session: this.validSessionId(parsed.latest_session) ? parsed.latest_session : null,
      sessions: parsed.sessions
        .filter((session) => session && typeof session === 'object' && this.validSessionId(session.id))
        .map((session) => ({
          id: session.id,
          created_at: typeof session.created_at === 'string' ? session.created_at : null,
          updated_at: typeof session.updated_at === 'string' ? session.updated_at : null,
          runs: Array.isArray(session.runs) ? session.runs.filter((run) => typeof run === 'string') : []
        }))
    }
  }

  async loadSession(appRoot, sessionId) {
    if (!this.validSessionId(sessionId)) {
      return null
    }
    const cacheKey = this.sessionKey(appRoot, sessionId)
    if (this.sessions.has(cacheKey)) {
      return this.sessions.get(cacheKey)
    }
    const manifestPath = this.manifestPath(appRoot, sessionId)
    const parsed = manifestPath ? await this.readJson(manifestPath) : null
    if (!parsed || typeof parsed !== 'object' || parsed.id !== sessionId || !Array.isArray(parsed.runs)) {
      return null
    }
    parsed.appRoot = appRoot
    this.sessions.set(cacheKey, parsed)
    return parsed
  }

  async updateIndex(appRoot, updater) {
    const previous = this.indexQueues.get(appRoot) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const index = await this.loadIndex(appRoot)
      const updated = updater(index) || index
      await this.writeJson(this.indexPath(appRoot), updated)
    })
    this.indexQueues.set(appRoot, next.catch(() => {}))
    return next
  }

  async persistSession(session, options = {}) {
    if (!session || !session.appRoot || !this.validSessionId(session.id)) {
      return
    }
    const manifest = {
      version: 1,
      id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      runs: session.runs.map((run) => ({
        script: run.script,
        started_at: run.started_at || null,
        ended_at: run.ended_at || null,
        logs: Array.isArray(run.logs) ? run.logs : []
      }))
    }
    await this.writeJson(this.manifestPath(session.appRoot, session.id), manifest)

    const summary = {
      id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      runs: session.runs.map((run) => run.script).filter(Boolean)
    }
    await this.updateIndex(session.appRoot, (index) => {
      const promote = !!options.promote || !index.latest_session
      if (promote) {
        const remaining = index.sessions.filter((entry) => entry.id !== session.id)
        index.latest_session = session.id
        index.sessions = [summary, ...remaining]
        return index
      }
      let replaced = false
      index.sessions = index.sessions.map((entry) => {
        if (entry.id === session.id) {
          replaced = true
          return summary
        }
        return entry
      })
      if (!replaced) {
        index.sessions.push(summary)
      }
      return index
    })
  }

  async createSession(target, timestamp) {
    const session = {
      version: 1,
      id: this.createSessionId(timestamp),
      appRoot: target.appRoot,
      created_at: timestamp,
      updated_at: timestamp,
      runs: []
    }
    this.sessions.set(this.sessionKey(session.appRoot, session.id), session)
    return session
  }

  clearReservations(appRoot, sessionId = '') {
    for (const [key, reservation] of this.reservations.entries()) {
      if (reservation.appRoot !== appRoot) {
        continue
      }
      if (sessionId && reservation.session_id !== sessionId) {
        continue
      }
      this.reservations.delete(key)
    }
    if (!sessionId) {
      this.routineSessions.delete(appRoot)
      return
    }
    if (this.routineSessions.get(appRoot) === sessionId) {
      this.routineSessions.delete(appRoot)
    }
  }

  async reserveLaunch(scriptPathOrRequest, options = {}) {
    const scriptPath = typeof scriptPathOrRequest === 'object' && scriptPathOrRequest
      ? scriptPathOrRequest.path || scriptPathOrRequest.uri
      : scriptPathOrRequest
    const target = await this.resolveScript(scriptPath)
    if (!target) {
      return null
    }

    let session = null
    const routineSessionId = this.routineSessions.get(target.appRoot)
    if (this.validSessionId(routineSessionId)) {
      session = await this.loadSession(target.appRoot, routineSessionId)
    }
    if (!session && options.existingRoutineOnly) {
      return null
    }
    const reservation = {
      session_id: session ? session.id : '',
      appRoot: target.appRoot,
      scriptPath: target.scriptPath,
      script: target.script
    }
    this.reservations.set(this.reservationKey(target), reservation)
    return reservation
  }

  async startRun(request) {
    const target = await this.resolveScript(request && request.path)
    if (!target) {
      return null
    }
    const context = this.context.getStore()
    const reservationKey = this.reservationKey(target)
    const reservation = this.reservations.get(reservationKey)
    let session = null
    let promote = false
    let routine = false

    if (context && context.appRoot === target.appRoot && this.validSessionId(context.session_id)) {
      session = await this.loadSession(target.appRoot, context.session_id)
    }

    if (!session && reservation) {
      this.reservations.delete(reservationKey)
      if (this.validSessionId(reservation.session_id)) {
        session = await this.loadSession(target.appRoot, reservation.session_id)
      }
      if (!session) {
        const timestamp = this.now()
        session = await this.createSession(target, timestamp)
        promote = true
      }
      routine = true
    }

    if (!session) {
      this.clearReservations(target.appRoot)
      const timestamp = this.now()
      session = await this.createSession(target, timestamp)
      promote = true
    }
    if (routine) {
      this.routineSessions.set(target.appRoot, session.id)
    }

    const startedAt = session.runs.length === 0 ? session.created_at : this.now()
    const run = {
      id: `${session.id}:${session.runs.length}`,
      session_id: session.id,
      appRoot: target.appRoot,
      scriptPath: target.scriptPath,
      script: target.script,
      started_at: startedAt,
      ended_at: null,
      logs: []
    }
    session.updated_at = startedAt
    session.runs.push(run)
    for (const key of this.requestKeys({ ...request, path: target.scriptPath })) {
      this.activeRunsByKey.set(key, run)
    }
    await this.persistSession(session, { promote })
    return run
  }

  activeRun(requestOrRun) {
    if (requestOrRun && requestOrRun.session_id && requestOrRun.scriptPath) {
      return requestOrRun
    }
    for (const key of this.requestKeys(requestOrRun)) {
      const run = this.activeRunsByKey.get(key)
      if (run) {
        return run
      }
    }
    return null
  }

  withRunContext(requestOrRun, fn) {
    const run = this.activeRun(requestOrRun)
    if (!run || typeof fn !== 'function') {
      return typeof fn === 'function' ? fn() : undefined
    }
    return this.context.run({
      session_id: run.session_id,
      appRoot: run.appRoot
    }, fn)
  }

  async finishRun(requestOrRun, options = {}) {
    const run = this.activeRun(requestOrRun)
    if (!run || run.ended_at) {
      return
    }
    const session = await this.loadSession(run.appRoot, run.session_id)
    if (!session) {
      return
    }
    const endedAt = this.now()
    run.ended_at = endedAt
    session.updated_at = endedAt
    for (const key of this.requestKeys({ ...requestOrRun, path: run.scriptPath })) {
      this.activeRunsByKey.delete(key)
    }
    await this.persistSession(session)

    if (!options || !options.internal_completion) {
      this.clearReservations(run.appRoot, session.id)
    }
  }

  async recordLogFile({ scriptPath, logFile, run: capturedRun = null }) {
    const target = await this.resolveScript(scriptPath)
    if (!target || typeof logFile !== 'string' || !logFile.trim()) {
      return
    }
    const run = capturedRun
      && capturedRun.session_id
      && capturedRun.appRoot === target.appRoot
      && capturedRun.scriptPath === target.scriptPath
      ? capturedRun
      : this.activeRunsByKey.get(target.scriptPath)
    if (!run) {
      return
    }
    const logsRoot = path.resolve(target.appRoot, 'logs')
    const sessionsRoot = this.sessionDir(target.appRoot)
    const absoluteLog = path.resolve(logFile)
    if (!this.isPathWithin(logsRoot, absoluteLog) || this.isPathWithin(sessionsRoot, absoluteLog)) {
      return
    }
    if (path.basename(absoluteLog) === 'latest') {
      return
    }
    const relativeLog = this.toPosix(path.relative(target.appRoot, absoluteLog))
    if (!run.logs.some((entry) => entry.path === relativeLog)) {
      run.logs.push({ path: relativeLog })
      const session = await this.loadSession(run.appRoot, run.session_id)
      if (session) {
        session.updated_at = this.now()
        await this.persistSession(session)
      }
    }
  }
}

module.exports = AppLogSessions
