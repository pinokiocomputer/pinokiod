const git = require('isomorphic-git')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { glob, sync, hasMagic } = require('glob-gitignore')
const http = require('isomorphic-git/http/node')
const ini = require('ini')
const Util = require('./util')
class Git {
  constructor(kernel) {
    this.kernel = kernel
    this.dirs = new Set()
    this.mapping = {}
    // In-memory manifest of checkpoints keyed by normalized remote, persisted under ~/pinokio/checkpoints/
    this.history = {
      version: "1",
      apps: {},
      commits: {}
    }
    // Active snapshot restore flags keyed by workspace name
    this.activeSnapshot = {}
  }
  normalizeRemote(remote) {
    if (!remote || typeof remote !== "string") return null
    let str = remote.trim()
    // Remove protocol prefixes
    str = str.replace(/^(https?:\/\/|ssh:\/\/)/i, '')
    // Convert scp-like git@host:path to host/path
    const atIdx = str.indexOf('@')
    if (atIdx !== -1) {
      str = str.slice(atIdx + 1)
    }
    const firstSlashIdx = str.indexOf('/')
    const colonIdx = str.indexOf(':')
    if (colonIdx !== -1 && (firstSlashIdx === -1 || colonIdx < firstSlashIdx)) {
      const host = str.slice(0, colonIdx)
      const pathPart = str.slice(colonIdx + 1)
      str = `${host}/${pathPart}`
    }
    // Lowercase host portion
    const firstSlash = str.indexOf('/')
    if (firstSlash !== -1) {
      const host = str.slice(0, firstSlash).toLowerCase()
      const rest = str.slice(firstSlash + 1)
      str = rest ? `${host}/${rest}` : host
    } else {
      str = str.toLowerCase()
    }
    // Drop trailing .git
    if (str.endsWith('.git')) {
      str = str.slice(0, -4)
    }
    return str
  }
  normalizeGitPerson(person) {
    if (!person || typeof person !== "object") return null
    const name = typeof person.name === "string" ? person.name : null
    const email = typeof person.email === "string" ? person.email : null
    const timestamp = Number.isFinite(person.timestamp) ? person.timestamp : null
    const timezoneOffset = Number.isFinite(person.timezoneOffset) ? person.timezoneOffset : null
    if (!name && !email && !timestamp && !timezoneOffset) return null
    return { name, email, timestamp, timezoneOffset }
  }
  isCommitSha(value) {
    return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim())
  }
  formatGitIsoTimestamp(timestampSeconds, timezoneOffsetMinutes) {
    if (!Number.isFinite(timestampSeconds)) return null
    const offsetMinutes = Number.isFinite(timezoneOffsetMinutes) ? timezoneOffsetMinutes : 0
    const epochMs = Math.trunc(timestampSeconds) * 1000
    const localMs = epochMs + offsetMinutes * 60 * 1000
    const d = new Date(localMs)
    if (!Number.isFinite(d.getTime())) return null
    const pad2 = (n) => String(n).padStart(2, "0")
    const y = d.getUTCFullYear()
    const m = pad2(d.getUTCMonth() + 1)
    const day = pad2(d.getUTCDate())
    const hh = pad2(d.getUTCHours())
    const mm = pad2(d.getUTCMinutes())
    const ss = pad2(d.getUTCSeconds())
    const sign = offsetMinutes >= 0 ? "+" : "-"
    const abs = Math.abs(offsetMinutes)
    const offH = pad2(Math.floor(abs / 60))
    const offM = pad2(abs % 60)
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`
  }
  normalizeRepoPath(rawPath) {
    if (typeof rawPath !== "string") return "."
    let value = rawPath.trim()
    if (!value) return "."
    value = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/")
    if (value === "." || value === "./") return "."
    if (value.startsWith("./")) {
      value = value.slice(2)
    }
    return value || "."
  }
  upsertCommitMeta(repoUrlNorm, sha, meta) {
    if (!repoUrlNorm || typeof repoUrlNorm !== "string") return false
    if (!this.isCommitSha(sha)) return false
    const entry = meta && typeof meta === "object" ? meta : {}
    const subject = typeof entry.subject === "string" && entry.subject.trim() ? entry.subject.trim() : null
    const authorName = typeof entry.authorName === "string" && entry.authorName.trim() ? entry.authorName.trim() : null
    const committedAt = typeof entry.committedAt === "string" && entry.committedAt.trim() ? entry.committedAt.trim() : null
    if (!subject && !authorName && !committedAt) return false

    const commits = this.commits()
    if (!commits[repoUrlNorm] || typeof commits[repoUrlNorm] !== "object") {
      commits[repoUrlNorm] = {}
    }
    const repoCommits = commits[repoUrlNorm]
    const existing = repoCommits[sha] && typeof repoCommits[sha] === "object" ? repoCommits[sha] : null
    if (!existing) {
      repoCommits[sha] = { subject, authorName, committedAt }
      return true
    }
    let changed = false
    if (subject && (!existing.subject || existing.subject !== subject)) {
      existing.subject = subject
      changed = true
    }
    if (authorName && (!existing.authorName || existing.authorName !== authorName)) {
      existing.authorName = authorName
      changed = true
    }
    if (committedAt && (!existing.committedAt || existing.committedAt !== committedAt)) {
      existing.committedAt = committedAt
      changed = true
    }
    return changed
  }
  async init() {
    const ensureDir = (target) => fs.promises.mkdir(target, { recursive: true }).catch(() => { })
    await Promise.all([
      ensureDir(this.kernel.path("config/gh")),
      ensureDir(this.kernel.path("scripts/git"))
    ])

    const gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
    const gitconfigTemplate = path.resolve(__dirname, "gitconfig_template")
    if (!(await this.kernel.api.exists(gitconfig_path))) {
      await fs.promises.copyFile(gitconfigTemplate, gitconfig_path)
    }

    const scripts = [
      "fork",
      "push",
      "create",
      "commit",
      "commit_files",
      "checkout",
      "reset_commit",
      "reset_file",
      "reset_files"
    ]
    await Promise.all(scripts.map((name) => {
      const src = path.resolve(__dirname, `scripts/git/${name}`)
      const dest = path.resolve(this.kernel.homedir, `scripts/git/${name}.json`)
      return fs.promises.copyFile(src, dest)
    }))

    // best-effort: clear any stale index.lock files across all known repos at startup
    try {
      const apiRoot = this.kernel.path("api")
      const repos = await this.repos(apiRoot)
      for (const repo of repos) {
        if (repo && repo.dir) {
          await this.clearStaleLock(repo.dir)
        }
      }
    } catch (_) {}
  }
  checkpointsDir() {
    return path.resolve(this.kernel.homedir, "checkpoints")
  }
  manifestPath() {
    return path.resolve(this.checkpointsDir(), "manifest.json")
  }
  checkpointsPath() {
    // Backward alias to manifest path for any callers using the old name internally
    return this.manifestPath()
  }
  parseSha256Digest(digest) {
    if (!digest || typeof digest !== "string") return null
    const m = digest.match(/^sha256:([0-9a-f]{64})$/i)
    if (!m) return null
    return m[1].toLowerCase()
  }
  checkpointFilePath(hashDigest) {
    const hex = this.parseSha256Digest(hashDigest)
    if (!hex) return null
    return path.resolve(this.checkpointsDir(), `sha256-${hex}.json`)
  }
  stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(",")}]`
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.stableStringify(value[k])}`).join(",")}}`
  }
  canonicalRepoUrl(remoteUrl) {
    const remoteKey = this.normalizeRemote(remoteUrl)
    if (!remoteKey) return null
    return `https://${remoteKey}`.replace(/\/$/, "").toLowerCase()
  }
  canonicalizeCheckpoint({ root, repos, system }) {
    const rootUrl = this.canonicalRepoUrl(root)
    const canonicalRepos = Array.isArray(repos)
      ? repos.map((r) => {
          const pathVal = typeof r.path === "string" && r.path.length > 0 ? r.path : "."
          const repo = r && (r.repo || r.remote) ? this.canonicalRepoUrl(r.repo || r.remote) : null
          const commit = typeof r.commit === "string" && r.commit.length > 0 ? r.commit : null
          return { path: pathVal, repo, commit }
        })
      : []
    canonicalRepos.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1
      const ra = a.repo || ""
      const rb = b.repo || ""
      if (ra !== rb) return ra < rb ? -1 : 1
      const ca = a.commit || ""
      const cb = b.commit || ""
      if (ca !== cb) return ca < cb ? -1 : 1
      return 0
    })
    return {
      version: 1,
      root: rootUrl,
      repos: canonicalRepos,
    }
  }
  hashCheckpoint(checkpoint) {
    const canonical = this.canonicalizeCheckpoint(checkpoint || {})
    const data = this.stableStringify(canonical)
    const hex = crypto.createHash("sha256").update(data).digest("hex")
    return { canonical, digest: `sha256:${hex}` }
  }
  normalizeReposArray(rawRepos, options = {}) {
    const includeMeta = !!options.includeMeta
    if (!Array.isArray(rawRepos)) {
      return []
    }
    const repos = []
    for (const repo of rawRepos) {
      if (!repo) continue
      const pathVal = this.normalizeRepoPath(repo.path)
      let remote = typeof repo.remote === "string" && repo.remote.length > 0 ? repo.remote : null
      if (!remote) remote = typeof repo.repo === "string" && repo.repo.length > 0 ? repo.repo : null
      const commit = typeof repo.commit === "string" && repo.commit.length > 0 ? repo.commit : null
      const entry = {
        path: pathVal,
        remote,
        commit,
      }
      if (includeMeta) {
        if (repo.message && typeof repo.message === "string") {
          entry.message = repo.message
        }
        if (repo.author) {
          const author = this.normalizeGitPerson(repo.author)
          if (author) entry.author = author
        }
        if (repo.committer) {
          const committer = this.normalizeGitPerson(repo.committer)
          if (committer) entry.committer = committer
        }

        // Best-effort: enrich with persisted commit metadata (from local snapshots or registry imports).
        if ((entry.message == null || entry.author == null) && remote && commit && this.isCommitSha(commit)) {
          const repoUrlNorm = this.canonicalRepoUrl(remote)
          const commits = repoUrlNorm ? this.commits() : null
          const meta = commits && commits[repoUrlNorm] && typeof commits[repoUrlNorm] === "object"
            ? commits[repoUrlNorm][commit]
            : null
          if (meta && typeof meta === "object") {
            if (entry.message == null && meta.subject && typeof meta.subject === "string") {
              entry.message = meta.subject
            }
            if (entry.author == null && meta.authorName && typeof meta.authorName === "string") {
              let timestamp = null
              if (meta.committedAt && typeof meta.committedAt === "string") {
                const ms = Date.parse(meta.committedAt)
                if (Number.isFinite(ms)) timestamp = Math.floor(ms / 1000)
              }
              entry.author = { name: meta.authorName, email: null, timestamp, timezoneOffset: null }
            }
          }
        }
      }
      repos.push(entry)
    }
    repos.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1
      const ra = a.remote || ""
      const rb = b.remote || ""
      if (ra !== rb) return ra < rb ? -1 : 1
      const ca = a.commit || ""
      const cb = b.commit || ""
      if (ca !== cb) return ca < cb ? -1 : 1
      return 0
    })
    return repos
  }
  apps() {
    if (!this.history.apps || typeof this.history.apps !== "object") {
      this.history.apps = {}
    }
    return this.history.apps
  }
  commits() {
    if (!this.history.commits || typeof this.history.commits !== "object") {
      this.history.commits = {}
    }
    return this.history.commits
  }
  remotes() {
    // Alias for legacy callers; returns the apps map
    return this.apps()
  }
  ensureApp(remoteUrl) {
    const remoteKey = this.normalizeRemote(remoteUrl)
    if (!remoteKey) return null
    const apps = this.apps()
    if (!apps[remoteKey]) {
      apps[remoteKey] = { remote: remoteUrl, checkpoints: [] }
    }
    const entry = apps[remoteKey]
    if (!Array.isArray(entry.checkpoints)) {
      entry.checkpoints = []
    }
    if (!entry.remote && remoteUrl) {
      entry.remote = remoteUrl
    }
    return { remoteKey, entry }
  }
  async writeCheckpointPayload(remoteKey, remoteUrl, { checkpoint, id, visibility, system } = {}) {
    await fs.promises.mkdir(this.checkpointsDir(), { recursive: true }).catch(() => {})
    const checkpointId = String(id || Date.now())
    const vis = typeof visibility === "string" && visibility.trim() ? visibility.trim() : "public"
    const hashed = this.hashCheckpoint(checkpoint)
    const sys = system && typeof system === "object" ? system : null
    const filePath = this.checkpointFilePath(hashed.digest)
    if (!filePath) throw new Error("Invalid checkpoint hash")
    try {
      await fs.promises.access(filePath, fs.constants.F_OK)
    } catch (_) {
      await fs.promises.writeFile(filePath, JSON.stringify(hashed.canonical, null, 2))
    }
    const apps = this.apps()
    if (!apps[remoteKey]) {
      apps[remoteKey] = { remote: remoteUrl, checkpoints: [] }
    }
    const entry = apps[remoteKey]
    const existingIdx = Array.isArray(entry.checkpoints)
      ? entry.checkpoints.findIndex((c) => c && String(c.id) === checkpointId)
      : -1
    if (!Array.isArray(entry.checkpoints)) entry.checkpoints = []
    if (existingIdx >= 0) {
      const prev = entry.checkpoints[existingIdx] || {}
      entry.checkpoints[existingIdx] = {
        id: checkpointId,
        hash: hashed.digest,
        visibility: vis,
        system: sys,
        sync: prev.sync,
        decision: prev.decision
      }
    } else {
      entry.checkpoints.push({
        id: checkpointId,
        hash: hashed.digest,
        visibility: vis,
        system: sys,
        sync: { status: "local" },
        decision: null
      })
    }
    // Keep checkpoints sorted newest-first if ids are time-based; fallback to string compare
    entry.checkpoints.sort((a, b) => {
      try {
        const ai = BigInt(a.id)
        const bi = BigInt(b.id)
        return bi > ai ? 1 : bi < ai ? -1 : 0
      } catch (_) {
        return String(b.id).localeCompare(String(a.id))
      }
    })
    await this.saveManifest()
    return { id: checkpointId, hash: hashed.digest }
  }
  async readCheckpointPayload(id) {
    const idStr = String(id)
    const apps = this.apps()
    let record = null
    let remoteKey = null
    for (const [k, entry] of Object.entries(apps)) {
      if (!entry || !Array.isArray(entry.checkpoints)) continue
      const hit = entry.checkpoints.find((c) => c && String(c.id) === idStr)
      if (hit && hit.hash) {
        record = hit
        remoteKey = k
        break
      }
    }
    if (!record || !record.hash) return null
    const filePath = this.checkpointFilePath(record.hash)
    if (!filePath) return null
    try {
      const data = await fs.promises.readFile(filePath, "utf8")
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === "object") {
        const sys = record.system && typeof record.system === "object" ? record.system : {}
        return parsed
          ? {
              id: idStr,
              hash: record.hash,
              visibility: record.visibility || "public",
              sync: record.sync || null,
              decision: record.decision || null,
              app: remoteKey,
              root: parsed.root || null,
              repos: Array.isArray(parsed.repos) ? parsed.repos : [],
              system: sys,
              platform: typeof sys.platform === "string" ? sys.platform : null,
              arch: typeof sys.arch === "string" ? sys.arch : null,
              gpu: typeof sys.gpu === "string" ? sys.gpu : null,
              ram: typeof sys.ram === "number" ? sys.ram : null,
              vram: typeof sys.vram === "number" ? sys.vram : null
            }
          : null
      }
    } catch (_) {}
    return null
  }
  async getSnapshot(remoteKey, snapshotId) {
    if (!remoteKey || snapshotId == null) return null
    const idStr = String(snapshotId)
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return null
    const found = entry.checkpoints.find((c) => c && String(c.id) === idStr)
    if (!found) return null
    const payload = await this.readCheckpointPayload(idStr)
    if (!payload) return null
    return {
      remoteKey,
      remote: entry.remote || null,
      snapshot: {
        ...payload,
        repos: this.normalizeReposArray(payload.repos || [], { includeMeta: true })
      }
    }
  }
  async findSnapshotById(snapshotId) {
    const idStr = String(snapshotId)
    const apps = this.apps()
    for (const [remoteKey, entry] of Object.entries(apps)) {
      if (!entry || !Array.isArray(entry.checkpoints)) continue
      const hit = entry.checkpoints.find((c) => c && String(c.id) === idStr)
      if (hit) {
        const found = await this.getSnapshot(remoteKey, idStr)
        if (found) return found
      }
    }
    return null
  }
  async listSnapshotsForRemote(remoteKey) {
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return []
    const snapshots = []
    for (const cp of entry.checkpoints) {
      if (!cp || cp.id == null) continue
      const payload = await this.readCheckpointPayload(cp.id)
      if (!payload) continue
      snapshots.push({
        ...payload,
        repos: this.normalizeReposArray(payload.repos || [], { includeMeta: true })
      })
    }
    snapshots.sort((a, b) => {
      try {
        const ai = BigInt(a.id)
        const bi = BigInt(b.id)
        return bi > ai ? 1 : bi < ai ? -1 : 0
      } catch (_) {
        return String(b.id).localeCompare(String(a.id))
      }
    })
    return snapshots
  }
  ensureRemote(remoteUrl) {
    return this.ensureApp(remoteUrl)
  }
  async loadCheckpoints() {
    let history = this.history
    let needsPersist = false
    try {
      await fs.promises.mkdir(this.checkpointsDir(), { recursive: true })
    } catch (_) {}
    try {
      const str = await fs.promises.readFile(this.manifestPath(), "utf8")
      const parsed = JSON.parse(str)
      if (parsed && typeof parsed === "object") {
        history = parsed
      } else {
        needsPersist = true
      }
    } catch (_) {
      needsPersist = true
    }
    if (!history || typeof history !== "object") {
      history = { version: "1", apps: {} }
      needsPersist = true
    }
    if (!history.apps || typeof history.apps !== "object") {
      history.apps = {}
      needsPersist = true
    }
    if (!history.commits || typeof history.commits !== "object") {
      history.commits = {}
    }
    history.version = history.version || "1"
    this.history = history
    if (needsPersist) {
      try {
        await this.saveManifest()
      } catch (_) {}
    }
  }
  async saveManifest() {
    const str = JSON.stringify(this.history, null, 2)
    await fs.promises.writeFile(this.manifestPath(), str)
  }
  async setCheckpointSync(remoteKey, checkpointId, sync) {
    if (!remoteKey || checkpointId == null) return false
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return false
    const idStr = String(checkpointId)
    const idx = entry.checkpoints.findIndex((c) => c && String(c.id) === idStr)
    if (idx < 0) return false
    entry.checkpoints[idx].sync = sync
    await this.saveManifest()
    return true
  }
  getCheckpointDecision(remoteKey, checkpointId) {
    if (!remoteKey || checkpointId == null) return null
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return null
    const idStr = String(checkpointId)
    const hit = entry.checkpoints.find((c) => c && String(c.id) === idStr)
    if (!hit) return null
    return hit.decision || null
  }
  async setCheckpointDecision(remoteKey, checkpointId, decision) {
    if (!remoteKey || checkpointId == null) return false
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return false
    const idStr = String(checkpointId)
    const idx = entry.checkpoints.findIndex((c) => c && String(c.id) === idStr)
    if (idx < 0) return false
    const next = decision && String(decision).trim() ? String(decision).trim() : null
    if (next) {
      entry.checkpoints[idx].decision = next
    } else {
      delete entry.checkpoints[idx].decision
    }
    await this.saveManifest()
    return true
  }
  async deleteCheckpoint(remoteKey, checkpointId) {
    if (!remoteKey || checkpointId == null) return { ok: false, error: "invalid" }
    const apps = this.apps()
    const entry = apps[remoteKey]
    if (!entry || !Array.isArray(entry.checkpoints)) return { ok: false, error: "not_found" }
    const idStr = String(checkpointId)
    const idx = entry.checkpoints.findIndex((c) => c && String(c.id) === idStr)
    if (idx < 0) return { ok: false, error: "not_found" }
    const record = entry.checkpoints[idx]
    entry.checkpoints.splice(idx, 1)
    if (entry.checkpoints.length === 0) {
      delete apps[remoteKey]
    }
    await this.saveManifest()
    const hash = record && record.hash ? String(record.hash) : null
    let fileDeleted = false
    if (hash) {
      let stillUsed = false
      for (const entry of Object.values(apps)) {
        if (!entry || !Array.isArray(entry.checkpoints)) continue
        if (entry.checkpoints.some((c) => c && String(c.hash) === hash)) {
          stillUsed = true
          break
        }
      }
      if (!stillUsed) {
        const filePath = this.checkpointFilePath(hash)
        if (filePath) {
          try {
            await fs.promises.rm(filePath, { force: true })
            fileDeleted = true
          } catch (_) {}
        }
      }
    }
    return { ok: true, hash, fileDeleted }
  }
  async logCheckpointRestore(event) {
    const logEntry = {
      ts: Date.now(),
      ...event,
    }
    try {
      console.log("[checkpoints.restore]", logEntry)
    } catch (_) {}
  }
  async appendWorkspaceSnapshot(workspaceName, repos) {
    if (!workspaceName || !Array.isArray(repos)) return
    const workspaceRoot = this.kernel.path("api", workspaceName)
    const currentRepos = []
    for (const repo of repos) {
      if (!repo || !repo.gitParentPath || !repo.url) continue
      const relPath = path.relative(workspaceRoot, repo.gitParentPath) || "."
      let commit = null
      let message = null
      let author = null
      let committer = null
      try {
        const head = await this.getHead(repo.gitParentPath)
        commit = head && head.hash ? head.hash : null
        message = head && head.message ? head.message : null
        author = head && head.author ? this.normalizeGitPerson(head.author) : null
        committer = head && head.committer ? this.normalizeGitPerson(head.committer) : null
      } catch (_) {}
      currentRepos.push({
        path: relPath === "" ? "." : relPath,
        remote: repo.url,
        commit,
        message,
        author,
        committer,
      })
    }
    const normalizedCurrent = this.normalizeReposArray(currentRepos, { includeMeta: true })

    // Record commit metadata for UI display (subject + authorName + committedAt) keyed by repo+sha.
    let commitsDirty = false
    for (const repo of normalizedCurrent) {
      if (!repo || !repo.remote || !repo.commit) continue
      const repoUrlNorm = this.canonicalRepoUrl(repo.remote)
      if (!repoUrlNorm) continue
      const sha = String(repo.commit).trim()
      if (!this.isCommitSha(sha)) continue
      const subject = typeof repo.message === "string" && repo.message.trim()
        ? repo.message.split('\n')[0].trim()
        : null
      const authorName = repo.author && typeof repo.author.name === "string" ? repo.author.name : null
      const committedAt = repo.committer
        ? this.formatGitIsoTimestamp(repo.committer.timestamp, repo.committer.timezoneOffset)
        : null
      if (this.upsertCommitMeta(repoUrlNorm, sha, { subject, authorName, committedAt })) {
        commitsDirty = true
      }
    }

    const mainRepo = normalizedCurrent.find((repo) => repo && repo.path === "." && repo.remote)
    if (!mainRepo) return
    const remoteEntry = this.ensureApp(mainRepo.remote)
    if (!remoteEntry) return
    const { remoteKey, entry } = remoteEntry
    const checkpoints = Array.isArray(entry.checkpoints) ? entry.checkpoints : []
    const checkpoint = this.canonicalizeCheckpoint({
      root: mainRepo.remote,
      repos: normalizedCurrent.map((r) => ({ path: r.path, remote: r.remote, commit: r.commit })),
    })
    const hashed = this.hashCheckpoint(checkpoint)
    if (checkpoints.length > 0) {
      const last = checkpoints[0] // newest-first
      if (last && last.hash && String(last.hash) === String(hashed.digest)) {
        // No change; return the existing snapshot for this workspace version.
        if (commitsDirty) {
          try {
            await this.saveManifest()
          } catch (_) {}
        }
        return { id: String(last.id), hash: String(last.hash), remoteKey, deduped: true }
      }
    }
    const id = String(Date.now())
    const system = {
      platform: this.kernel.platform || null,
      arch: this.kernel.arch || null,
      gpu: this.kernel.gpu_model || this.kernel.gpu || null,
      ram: typeof this.kernel.ram === "number" ? this.kernel.ram : null,
      vram: typeof this.kernel.vram === "number" ? this.kernel.vram : null,
    }
    const saved = await this.writeCheckpointPayload(remoteKey, mainRepo.remote, { checkpoint, id, visibility: "public", system })
    return saved ? { ...saved, remoteKey } : saved
  }
  async downloadMainFromSnapshot(workspaceName, snapshotId, remoteOverride) {
    if (!workspaceName || snapshotId == null) return false
    const idStr = String(snapshotId)

    // Prefer an explicit remote (used when installing into a new folder),
    // otherwise try to infer via workspace .git, otherwise scan by id.
    let found = null
    if (remoteOverride) {
      found = await this.findSnapshotByRemote(remoteOverride, idStr)
    }
    if (!found || !found.snapshot) {
      try {
        const workspaceRoot = this.kernel.path("api", workspaceName)
        const mainRemote = await git.getConfig({
          fs,
          http,
          dir: workspaceRoot,
          path: 'remote.origin.url'
        })
        if (mainRemote) {
          found = await this.findSnapshotByRemote(mainRemote, idStr)
        }
      } catch (_) {}
    }
    if (!found || !found.snapshot) {
      found = await this.findSnapshotById(idStr)
    }
    if (!found || !found.snapshot) return false
    const snap = found.snapshot
    const repos = this.normalizeReposArray(snap.repos || [])
    const mainRepo = repos.find((repo) => repo && repo.path === ".")
    if (!mainRepo || !mainRepo.remote) return false
      await this.logCheckpointRestore({
        step: "main",
        workspace: workspaceName,
        snapshotId: idStr,
        remote: mainRepo.remote,
        commit: mainRepo.commit || null
      })
    const apiRoot = this.kernel.path("api")
    const workspaceRoot = this.kernel.path("api", workspaceName)
    const mainRoot = path.resolve(workspaceRoot, mainRepo.path || ".")
    const mainGit = path.resolve(mainRoot, ".git")
    try {
      await fs.promises.mkdir(apiRoot, { recursive: true })
    } catch (_) {}
    let exists = false
    try {
      await fs.promises.access(mainGit, fs.constants.F_OK)
      exists = true
    } catch (_) {}
    if (!exists) {
      const remote = mainRepo.remote
      const commit = mainRepo.commit
      try {
        await this.kernel.exec({
          message: [`git clone ${remote} "${workspaceName}"`],
          path: apiRoot
        }, () => {})
          await this.logCheckpointRestore({
            step: "main-clone",
            workspace: workspaceName,
            snapshotId: idStr,
            remote,
            commit: commit || null,
            status: "ok"
          })
        } catch (err) {
          await this.logCheckpointRestore({
            step: "main-clone",
            workspace: workspaceName,
            snapshotId: idStr,
            remote,
            commit: commit || null,
            status: "error",
            error: err && err.message ? err.message : String(err)
          })
        }
      if (commit) {
        try {
          await this.kernel.exec({
            message: [
              "git fetch --all --tags",
              `git checkout --detach ${commit}`
            ],
            path: workspaceRoot
          }, () => {})
          await this.logCheckpointRestore({
            step: "main-checkout",
            workspace: workspaceName,
            snapshotId: idStr,
            remote,
            commit,
            status: "ok"
          })
        } catch (err) {
          await this.logCheckpointRestore({
            step: "main-checkout",
            workspace: workspaceName,
            snapshotId: idStr,
            remote,
            commit,
            status: "error",
            error: err && err.message ? err.message : String(err)
          })
        }
      }
      try {
        await fs.promises.access(mainGit, fs.constants.F_OK)
        exists = true
      } catch (_) {
        exists = false
      }
    }
    if (exists) {
      try {
        await this.applyPinnedCommitsForSnapshot({
          workspaceName,
          workspaceRoot,
          remoteKey: found.remoteKey,
          snapshotId: idStr,
          repos,
          skipMain: true,
        })
      } catch (err) {
        await this.logCheckpointRestore({
          step: "sub-checkout",
          workspace: workspaceName,
          snapshotId: idStr,
          status: "error",
          error: err && err.message ? err.message : String(err)
        })
      }
    }
    return exists
  }
  async applyPinnedCommitsForSnapshot({ workspaceName, workspaceRoot, remoteKey, snapshotId, repos, skipMain = false }) {
    if (!Array.isArray(repos)) return
    if (!workspaceName || !workspaceRoot || !remoteKey || snapshotId == null) return
    const found = await this.getSnapshot(remoteKey, snapshotId)
    const snapRepos = found && found.snapshot && Array.isArray(found.snapshot.repos) ? found.snapshot.repos : null
    if (!snapRepos) return
    for (const repo of repos) {
      if (!repo || !repo.remote) continue
      if (skipMain && repo.path === ".") continue
      const repoPath = path.resolve(workspaceRoot, repo.path || ".")
      const gitPath = path.resolve(repoPath, ".git")
      let repoExists = false
      try {
        await fs.promises.access(gitPath, fs.constants.F_OK)
        repoExists = true
      } catch (_) {}
      if (!repoExists) {
        await this.logCheckpointRestore({
          step: "sub-checkout",
          workspace: workspaceName,
          snapshotId,
          remote: repo.remote,
          path: repoPath,
          status: "skip",
          reason: "repo missing"
        })
        continue
      }
      const pin = snapRepos.find((r) => r && r.remote === repo.remote && r.commit)
      if (!pin || !pin.commit) {
        await this.logCheckpointRestore({
          step: "sub-checkout",
          workspace: workspaceName,
          snapshotId,
          remote: repo.remote,
          path: repoPath,
          status: "skip",
          reason: "no pinned commit for repo in snapshot"
        })
        continue
      }
      await this.logCheckpointRestore({
        step: "sub-checkout",
        workspace: workspaceName,
        snapshotId,
        remote: repo.remote,
        commit: pin.commit,
        path: repoPath,
        status: "begin"
      })
      try {
        await this.kernel.exec({
          message: [
            "git fetch --all --tags",
            `git checkout --detach ${pin.commit}`
          ],
          path: repoPath
        }, () => {})
        await this.logCheckpointRestore({
          step: "sub-checkout",
          workspace: workspaceName,
          snapshotId,
          remote: repo.remote,
          commit: pin.commit,
          path: repoPath,
          status: "ok"
        })
      } catch (err) {
        await this.logCheckpointRestore({
          step: "sub-checkout",
          workspace: workspaceName,
          snapshotId,
          remote: repo.remote,
          commit: pin.commit,
          path: repoPath,
          status: "error",
          error: err && err.message ? err.message : String(err)
        })
      }
    }
  }
  async restoreNewReposForActiveSnapshot(workspaceName, workspaceRoot, beforeDirs) {
    if (!workspaceName || !workspaceRoot || !beforeDirs) return
    const active = this.activeSnapshot && this.activeSnapshot[workspaceName]
    const snapshotId = typeof active === "object" && active !== null ? active.id : active
    const remoteKeyHint = typeof active === "object" && active !== null ? active.remoteKey : null
    if (!snapshotId) {
      await this.logCheckpointRestore({
        step: "sub-checkout",
        workspace: workspaceName,
        status: "skip",
        reason: "no active snapshot id"
      })
      return
    }
    let found = null
    if (remoteKeyHint) {
      found = await this.findSnapshotByRemote(remoteKeyHint, snapshotId)
    }
    if (!found || !found.snapshot) {
      found = await this.findSnapshotForFolder(workspaceName, snapshotId)
    }
    if (!found || !found.snapshot) {
      await this.logCheckpointRestore({
        step: "sub-checkout",
        workspace: workspaceName,
        snapshotId,
        status: "skip",
        reason: "snapshot not found for workspace"
      })
      return
    }
    const snap = found.snapshot
    const snapRepos = Array.isArray(snap.repos) ? snap.repos : []
    const reposAfter = await this.repos(workspaceRoot)
    const newRepos = reposAfter.filter((repo) => {
      return repo && repo.gitParentPath && !beforeDirs.has(repo.gitParentPath)
    })
    await this.logCheckpointRestore({
      step: "sub-checkout",
      workspace: workspaceName,
      snapshotId,
      status: "scan",
      newRepoCount: newRepos.length
    })
    for (const repo of newRepos) {
      if (!repo || !repo.url) continue
      const repoKey = this.normalizeRemote(repo.url)
      const pin = repoKey ? snapRepos.find((r) => r && this.normalizeRemote(r.remote) === repoKey && r.commit) : null
      if (pin && pin.commit) {
        await this.logCheckpointRestore({
          workspace: workspaceName,
          snapshotId,
          remote: repo.url,
          commit: pin.commit,
          path: repo.gitParentPath,
          step: "sub-checkout",
          status: "begin"
        })
        try {
          await this.kernel.exec({
            message: [
              "git fetch --all --tags",
              `git checkout --detach ${pin.commit}`
            ],
            path: repo.gitParentPath
          }, () => {})
          await this.logCheckpointRestore({
            workspace: workspaceName,
            snapshotId,
            remote: repo.url,
            commit: pin.commit,
            path: repo.gitParentPath,
            step: "sub-checkout",
            status: "ok"
          })
        } catch (err) {
          await this.logCheckpointRestore({
            workspace: workspaceName,
            snapshotId,
            remote: repo.url,
            commit: pin.commit,
            path: repo.gitParentPath,
            step: "sub-checkout",
            status: "error",
            error: err && err.message ? err.message : String(err)
          })
        }
      } else {
        await this.logCheckpointRestore({
          workspace: workspaceName,
          snapshotId,
          remote: repo.url,
          path: repo.gitParentPath,
          step: "sub-checkout",
          status: "skip",
          reason: "no pinned commit for repo in snapshot"
        })
      }
    }
  }
  async findPinnedCommitForSnapshot(remoteKey, snapshotId, remoteUrl) {
    // Look up a commit for a specific snapshot id and remote
    if (!remoteKey || !remoteUrl) return null
    const found = await this.getSnapshot(remoteKey, snapshotId)
    if (!found || !found.snapshot || !Array.isArray(found.snapshot.repos)) return null
    const targetKey = this.normalizeRemote(remoteUrl)
    if (!targetKey) return null
    for (const repo of found.snapshot.repos) {
      if (repo && this.normalizeRemote(repo.remote) === targetKey && repo.commit) {
        return { commit: repo.commit, path: repo.path }
      }
    }
    return null
  }
  async findSnapshotByRemote(remoteUrl, snapshotId) {
    if (!remoteUrl || snapshotId == null) return null
    const apps = this.apps()
    const targetKey = this.normalizeRemote(remoteUrl)
    if (!targetKey) return null
    if (!apps[targetKey]) return null
    return this.getSnapshot(targetKey, snapshotId)
  }
  async findSnapshotForFolder(folderName, snapshotId) {
    if (!folderName || snapshotId == null) return null
    const idStr = String(snapshotId)
    // Try the workspace's git remote first
    try {
      const workspaceRoot = this.kernel.path("api", folderName)
      const mainRemote = await git.getConfig({
        fs,
        http,
        dir: workspaceRoot,
        path: 'remote.origin.url'
      })
      if (mainRemote) {
        const found = await this.findSnapshotByRemote(mainRemote, idStr)
        if (found) return found
      }
    } catch (_) {}
    // Fallback: any snapshot matching the id
    return this.findSnapshotById(idStr)
  }
  async ensureDefaults(homeOverride) {
    const home = homeOverride || this.kernel.homedir
    if (!home) return

    const gitconfigPath = path.resolve(home, "gitconfig")
    const templatePath = path.resolve(__dirname, "gitconfig_template")
    const templateConfig = ini.parse(await fs.promises.readFile(templatePath, "utf8"))
    const required = [
      { section: "init", key: "defaultBranch", value: "main" },
      { section: "push", key: "autoSetupRemote", value: true },
    ]

    try {
      await fs.promises.access(gitconfigPath, fs.constants.F_OK)
    } catch (_) {
      await fs.promises.copyFile(templatePath, gitconfigPath)
      return
    }

    let config
    let dirty = false
    try {
      const content = await fs.promises.readFile(gitconfigPath, "utf8")
      config = ini.parse(content)
    } catch (_) {
      config = {}
      dirty = true
    }

    for (const [section, tplSection] of Object.entries(templateConfig)) {
      if (typeof tplSection !== "object" || tplSection === null) continue
      if (!config[section]) {
        config[section] = { ...tplSection }
        dirty = true
        continue
      }
      for (const [key, value] of Object.entries(tplSection)) {
        if (!Object.prototype.hasOwnProperty.call(config[section], key)) {
          config[section][key] = value
          dirty = true
        }
      }
    }

    for (const { section, key, value } of required) {
      if (!config[section]) {
        config[section] = {}
      }
      const current = config[section][key]
      if (String(current) !== String(value)) {
        config[section][key] = value
        dirty = true
      }
    }

    if (config['credential "helperselector"']) {
      delete config['credential "helperselector"']
      dirty = true
    }

    if (dirty) {
      await fs.promises.writeFile(gitconfigPath, ini.stringify(config))
    }
  }
  async clearStaleLock(repoPath) {
    if (!repoPath) return
    const lockPath = path.resolve(repoPath, ".git", "index.lock")
    try {
      await fs.promises.access(lockPath, fs.constants.F_OK)
    } catch (_) {
      return
    }
    // best-effort: if no other git op is active, remove the stale lock
    try {
      await fs.promises.unlink(lockPath)
    } catch (_) {
      // ignore
    }
  }
  async findGitDirs(dir, results = []) {
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "EACCES")) {
        return results
      }
      throw err
    }
    for (const entry of entries) {
      let type
      try {
        type = await Util.file_type(dir, entry)
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "EACCES")) {
          continue
        }
        throw err
      }
      if (type.directory) {
        if (entry.name === '.git') {
          results.push(path.join(dir, entry.name));
          continue; // don't go deeper in this repo
        }
        if (entry.name === 'node_modules' || entry.name === 'venv' || entry.name.startsWith(".")) {
          continue; // skip these heavy folders
        }
        try {
          await this.findGitDirs(path.join(dir, entry.name), results);
        } catch (err) {
          if (err && (err.code === "ENOENT" || err.code === "EACCES")) {
            continue
          }
          throw err
        }
      }
    }
    return results;
  }
  async index(kernel) {
    await this.repos(kernel.path("api"))
  }
  find(git_url) {
    let found = this.mapping[git_url]
    if (!found) {
      found = this.mapping[git_url + ".git"]
    }
    return found
  }

  async repos (root) {
    let _repos = await this.findGitDirs(root)
//    let _repos = await glob('**/.git/', {
//      cwd: root,
//      onlyDirectories: true,
//      dot: true,
//      ignore: ['**/node_modules/**', "**/venv/**"], // optional
//    });

    let name = path.basename(root)

    let repos = []
    for(let r of _repos) {
      const gitPath = path.resolve(root, r)
      const gitRelPath = path.relative(root, gitPath)
      const gitRelPathSansGit = path.dirname(gitRelPath)
      const gitParentPath = path.dirname(gitPath)
      const gitParentRelPath = path.relative(this.kernel.path("api"), gitParentPath)
      let dir = path.dirname(gitPath)
      let display_name
      let main
      if (gitRelPathSansGit === ".") {
        display_name = name
        main = true
      } else {
        display_name = `${name}/${gitRelPathSansGit}`
        main = false
      }
      let gitRemote = null
      try {
        gitRemote = await git.getConfig({
          fs,
          http,
          dir,
          path: 'remote.origin.url'
        })
      } catch (_) {}

      const repoEntry = {
        main,
        name: display_name,
        gitPath,
        gitRelPath,
        gitParentPath,
        gitParentRelPath,
        dir,
      }
      if (gitRemote) {
        repoEntry.url = gitRemote
      }
      repos.push(repoEntry)

      if (gitRemote && !this.mapping[gitRemote]) {
        try {
          let head = await this.getHead(gitParentPath)
          this.mapping[gitRemote] = {
            main,
            path: gitParentPath,
            head 
          }
        } catch (_) {}
      }
      this.dirs.add(dir)
    }
    return repos
  }
  async config (dir) {
    try {
      const gitConfigPath = path.resolve(dir, ".git/config")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      return gitconfig
    } catch (e) {
      return null
    }
  }
  async getHead(repoPath) {
    const commits = await git.log({
      fs,
      dir: repoPath,
      depth: 1,   // only get the latest commit
    });

    if (commits.length === 0) {
      throw new Error("No commits found in repository");
    }

    const { oid, commit } = commits[0];
    return {
      hash: oid,
      message: commit.message,
      author: commit.author ? {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.author.timestamp,
        timezoneOffset: commit.author.timezoneOffset
      } : null,
      committer: commit.committer ? {
        name: commit.committer.name,
        email: commit.committer.email,
        timestamp: commit.committer.timestamp,
        timezoneOffset: commit.committer.timezoneOffset
      } : null,
    };
  }

  async resolveCommitOid(dir, ref) {
    const oid = await git.resolveRef({ fs, dir, ref });
    const { type } = await git.readObject({ fs, dir, oid });
    if (type === "tag") {
      const { object } = await git.readTag({ fs, dir, oid });
      return object;
    }
    if (type !== "commit") {
      throw new Error(`Ref ${ref} points to a ${type}, not a commit.`);
    }
    return oid;
  }

  async getParentCommit(dir, commitOid) {
    const { commit } = await git.readCommit({ fs, dir, oid: commitOid });
    return commit.parent[0] || commitOid; // For initial commit
  }
}
module.exports = Git
