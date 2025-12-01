const git = require('isomorphic-git')
const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const http = require('isomorphic-git/http/node')
const ini = require('ini')
const Util = require('./util')
class Git {
  constructor(kernel) {
    this.kernel = kernel
    this.dirs = new Set()
    this.mapping = {}
    // In-memory history of workspace snapshots, persisted to ~/pinokio/history.json
    this.history = {
      schema: "pinokio-history/1",
      workspaces: {}
    }
    // Active snapshot restore flags keyed by workspace name
    this.activeSnapshot = {}
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
  historyPath() {
    // History file is stored at ~/pinokio/history.json
    return path.resolve(this.kernel.homedir, "history.json")
  }
  normalizeReposArray(rawRepos) {
    if (!Array.isArray(rawRepos)) {
      return []
    }
    const repos = []
    for (const repo of rawRepos) {
      if (!repo) continue
      const pathVal = typeof repo.path === "string" && repo.path.length > 0 ? repo.path : "."
      const remote = typeof repo.remote === "string" && repo.remote.length > 0 ? repo.remote : null
      const commit = typeof repo.commit === "string" && repo.commit.length > 0 ? repo.commit : null
      repos.push({
        path: pathVal,
        remote,
        commit,
      })
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
  async loadHistory() {
    // Load history.json if it exists; otherwise keep the default empty structure
    let history = this.history
    try {
      const str = await fs.promises.readFile(this.historyPath(), "utf8")
      const parsed = JSON.parse(str)
      if (parsed && typeof parsed === "object") {
        history = parsed
      }
    } catch (_) {}
    // Always normalize to the current schema version; older schemas are
    // upgraded in memory and then written back in the new format.
    history.schema = "pinokio-history/1"
    if (!history.workspaces) {
      history.workspaces = {}
    }
    // Deduplicate and normalize snapshots so that each workspace only keeps
    // unique git states. Older schemas are tolerated; we only care about
    // { path, remote, commit } for comparison and storage.
    const workspaces = history.workspaces
    let dirty = false
    for (const name of Object.keys(workspaces)) {
      const ws = workspaces[name] || {}
      const snaps = Array.isArray(ws.snapshots) ? ws.snapshots : []
      const seen = new Set()
      const deduped = []
      for (const snap of snaps) {
        if (!snap) continue
        const repos = this.normalizeReposArray(snap.repos || [])
        const key = JSON.stringify(repos)
        if (seen.has(key)) {
          dirty = true
          continue
        }
        seen.add(key)
        const id = typeof snap.id === "number" && Number.isFinite(snap.id) ? snap.id : Date.now()
        const platform = snap.platform || null
        const arch = snap.arch || null
        const gpu = snap.gpu || null
        const gpus = Array.isArray(snap.gpus) ? snap.gpus : null
        deduped.push({ id, repos, platform, arch, gpu, gpus })
      }
      workspaces[name] = { snapshots: deduped }
    }
    this.history = history
    // If we dropped duplicates or upgraded schema, persist the normalized
    // history so future runs see the compact form on disk as well.
    if (dirty) {
      await this.saveHistory()
    }
  }
  async saveHistory() {
    // Persist the current in-memory history to history.json
    const str = JSON.stringify(this.history, null, 2)
    await fs.promises.writeFile(this.historyPath(), str)
  }
  async appendWorkspaceSnapshot(workspaceName, repos) {
    // Append a new snapshot entry for a workspace using the latest HEAD for each repo.
    // Snapshots are only added when the git state actually changes compared to
    // the last recorded snapshot for that workspace.
    if (!workspaceName || !Array.isArray(repos)) return
    const workspaces = this.history.workspaces
    if (!workspaces[workspaceName]) {
      workspaces[workspaceName] = { snapshots: [] }
    }
    const workspaceRoot = this.kernel.path("api", workspaceName)
    const currentRepos = []
    for (const repo of repos) {
      if (!repo || !repo.gitParentPath || !repo.url) continue
      const relPath = path.relative(workspaceRoot, repo.gitParentPath) || "."
      let commit = null
      try {
        // Use isomorphic-git to get the current HEAD commit hash
        const head = await this.getHead(repo.gitParentPath)
        commit = head && head.hash ? head.hash : null
      } catch (_) {}
      currentRepos.push({
        path: relPath === "" ? "." : relPath,
        remote: repo.url,
        commit
      })
    }
    const normalizedCurrent = this.normalizeReposArray(currentRepos)
    const ws = workspaces[workspaceName]
    const snapshots = Array.isArray(ws.snapshots) ? ws.snapshots : []
    if (snapshots.length > 0) {
      const last = snapshots[snapshots.length - 1]
      const lastRepos = this.normalizeReposArray(last.repos || [])
      if (JSON.stringify(lastRepos) === JSON.stringify(normalizedCurrent)) {
        // No change in git state; skip creating a new snapshot.
        return
      }
    }
    const snapshot = {
      id: Date.now(),
      repos: normalizedCurrent,
      platform: this.kernel.platform || null,
      arch: this.kernel.arch || null,
      gpu: this.kernel.gpu_model || this.kernel.gpu || null,
      gpus: Array.isArray(this.kernel.gpus)
        ? this.kernel.gpus.map((g) => {
            if (!g) return null
            if (typeof g === "string") return g
            const name = g.name || ""
            const model = g.model || ""
            const combined = `${name} ${model}`.trim()
            return combined || null
          }).filter((x) => x)
        : null
    }
    ws.snapshots = snapshots.concat(snapshot)
    await this.saveHistory()
  }
  async workspaceSnapshotStatus(workspaceName, snapshot) {
    const repos = this.normalizeReposArray(snapshot && snapshot.repos ? snapshot.repos : [])
    const hasGitRepos = repos.length > 0
    const workspaceRoot = this.kernel.path("api", workspaceName)
    let downloaded = false
    let installed = false
    if (hasGitRepos) {
      const mainRepo = repos.find((repo) => repo && repo.path === ".")
      if (mainRepo) {
        const mainRoot = path.resolve(workspaceRoot, mainRepo.path || ".")
        const mainGit = path.resolve(mainRoot, ".git")
        try {
          await fs.promises.access(mainGit, fs.constants.F_OK)
          downloaded = true
        } catch (_) {}
      }
      if (downloaded) {
        let allPresent = true
        for (let i = 0; i < repos.length; i++) {
          const repo = repos[i]
          if (!repo || repo.path == null) {
            allPresent = false
            break
          }
          const repoRoot = path.resolve(workspaceRoot, repo.path || ".")
          const repoGit = path.resolve(repoRoot, ".git")
          try {
            await fs.promises.access(repoGit, fs.constants.F_OK)
          } catch (_) {
            allPresent = false
            break
          }
        }
        installed = allPresent
      }
    }
    return { hasGitRepos, downloaded, installed }
  }
  async downloadMainFromSnapshot(workspaceName, snapshotId) {
    const history = this.history
    if (!workspaceName || !Number.isFinite(snapshotId) || !history || !history.workspaces || !history.workspaces[workspaceName]) {
      return false
    }
    const ws = history.workspaces[workspaceName]
    const snaps = Array.isArray(ws.snapshots) ? ws.snapshots : []
    let snap = null
    for (let i = 0; i < snaps.length; i++) {
      const candidate = snaps[i]
      if (candidate && candidate.id === snapshotId) {
        snap = candidate
        break
      }
    }
    if (!snap || !Array.isArray(snap.repos)) {
      return false
    }
    const repos = this.normalizeReposArray(snap.repos || [])
    const mainRepo = repos.find((repo) => repo && repo.path === ".")
    if (!mainRepo || !mainRepo.remote) {
      return false
    }
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
      } catch (err) {
        console.log("[backups.restore] git clone failed", err)
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
        } catch (err) {
          console.log("[backups.restore] git checkout failed", err)
        }
      }
      try {
        await fs.promises.access(mainGit, fs.constants.F_OK)
        exists = true
      } catch (_) {
        exists = false
      }
    }
    return exists
  }
  async restoreNewReposForActiveSnapshot(workspaceName, workspaceRoot, beforeDirs) {
    if (!workspaceName || !workspaceRoot || !beforeDirs) return
    const snapshotId = this.activeSnapshot && this.activeSnapshot[workspaceName]
    if (!snapshotId) return
    const history = this.history
    const ws = history && history.workspaces ? history.workspaces[workspaceName] : null
    const snaps = ws && Array.isArray(ws.snapshots) ? ws.snapshots : []
    let snap = null
    for (let i = 0; i < snaps.length; i++) {
      const candidate = snaps[i]
      if (candidate && candidate.id === snapshotId) {
        snap = candidate
        break
      }
    }
    if (!snap || !Array.isArray(snap.repos)) {
      return
    }
    const reposAfter = await this.repos(workspaceRoot)
    const newRepos = reposAfter.filter((repo) => {
      return repo && repo.gitParentPath && !beforeDirs.has(repo.gitParentPath)
    })
    for (const repo of newRepos) {
      if (!repo || !repo.url) continue
      const pin = this.findPinnedCommitForSnapshot(workspaceName, snapshotId, repo.url)
      if (pin && pin.commit) {
        console.log("[snapshot.restore]", {
          workspace: workspaceName,
          snapshotId,
          remote: repo.url,
          commit: pin.commit
        })
        try {
          await this.kernel.exec({
            message: [
              "git fetch --all --tags",
              `git checkout --detach ${pin.commit}`
            ],
            path: repo.gitParentPath
          }, () => {})
        } catch (err) {
          console.log("[snapshot.restore] git checkout failed", err)
        }
      }
    }
  }
  findPinnedCommitForSnapshot(workspaceName, snapshotId, remoteUrl) {
    // Look up a commit for a specific snapshot id and remote
    if (!workspaceName || !remoteUrl) return null
    const ws = this.history.workspaces[workspaceName]
    if (!ws || !Array.isArray(ws.snapshots) || ws.snapshots.length === 0) return null
    const targetId = Number(snapshotId)
    if (!Number.isFinite(targetId)) return null
    let snap = null
    for (let i = 0; i < ws.snapshots.length; i++) {
      const candidate = ws.snapshots[i]
      if (candidate && candidate.id === targetId) {
        snap = candidate
        break
      }
    }
    if (!snap || !Array.isArray(snap.repos)) return null
    for (let j = 0; j < snap.repos.length; j++) {
      const repo = snap.repos[j]
      if (repo && repo.remote === remoteUrl && repo.commit) {
        return {
          commit: repo.commit,
          path: repo.path
        }
      }
    }
    return null
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
