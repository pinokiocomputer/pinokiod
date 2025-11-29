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
      // Create an initial snapshot per workspace at startup so history.json
      // is populated even before any scripts run.
      const byWorkspace = {}
      for (const repo of repos) {
        if (!repo || !repo.gitParentRelPath) continue
        const segments = repo.gitParentRelPath.split(path.sep).filter(Boolean)
        if (segments.length === 0) continue
        const workspaceName = segments[0]
        if (!byWorkspace[workspaceName]) {
          byWorkspace[workspaceName] = []
        }
        byWorkspace[workspaceName].push(repo)
      }
      const workspaceNames = Object.keys(byWorkspace)
      for (const ws of workspaceNames) {
        await this.appendWorkspaceSnapshot(ws, byWorkspace[ws], "startup")
      }
    } catch (_) {}
  }
  historyPath() {
    // History file is stored at ~/pinokio/history.json
    return path.resolve(this.kernel.homedir, "history.json")
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
    if (!history.schema) {
      history.schema = "pinokio-history/1"
    }
    if (!history.workspaces) {
      history.workspaces = {}
    }
    this.history = history
  }
  async saveHistory() {
    // Persist the current in-memory history to history.json
    const str = JSON.stringify(this.history, null, 2)
    await fs.promises.writeFile(this.historyPath(), str)
  }
  async appendWorkspaceSnapshot(workspaceName, repos, reason) {
    // Append a new snapshot entry for a workspace using the latest HEAD for each repo
    if (!workspaceName || !Array.isArray(repos)) return
    const workspaces = this.history.workspaces
    if (!workspaces[workspaceName]) {
      workspaces[workspaceName] = { snapshots: [] }
    }
    const workspaceRoot = this.kernel.path("api", workspaceName)
    const snapshot = {
      id: new Date().toISOString(),
      reason: reason || "step",
      path: workspaceName,
      repos: []
    }
    for (const repo of repos) {
      if (!repo || !repo.gitParentPath || !repo.url) continue
      const relPath = path.relative(workspaceRoot, repo.gitParentPath) || "."
      let commit = null
      try {
        // Use isomorphic-git to get the current HEAD commit hash
        const head = await this.getHead(repo.gitParentPath)
        commit = head && head.hash ? head.hash : null
      } catch (_) {}
      snapshot.repos.push({
        path: relPath === "" ? "." : relPath,
        remote: repo.url,
        commit,
        main: relPath === "."
      })
    }
    workspaces[workspaceName].snapshots.push(snapshot)
    await this.saveHistory()
  }
  findPinnedCommit(workspaceName, remoteUrl) {
    // Look up the most recent snapshot for this workspace that mentions the remote
    if (!workspaceName || !remoteUrl) return null
    const ws = this.history.workspaces[workspaceName]
    if (!ws || !Array.isArray(ws.snapshots) || ws.snapshots.length === 0) return null
    for (let i = ws.snapshots.length - 1; i >= 0; i--) {
      const snap = ws.snapshots[i]
      const repos = snap.repos || []
      for (let j = 0; j < repos.length; j++) {
        const repo = repos[j]
        if (repo && repo.remote === remoteUrl && repo.commit) {
          return {
            commit: repo.commit,
            path: repo.path
          }
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
