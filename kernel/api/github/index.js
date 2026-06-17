const path = require('path')
const { execFile, spawn } = require('child_process')
const fetch = require('cross-fetch')

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "never"
}

class Github {
  static parseCredentialOutput(stdout) {
    const credential = {}
    for (const line of String(stdout || "").split(/\r?\n/)) {
      const index = line.indexOf("=")
      if (index <= 0) continue
      credential[line.slice(0, index)] = line.slice(index + 1)
    }
    return credential
  }

  static parseGithubRemote(remoteUrl) {
    const raw = typeof remoteUrl === "string" ? remoteUrl.trim() : ""
    if (!raw) return null

    const fromPath = (value) => {
      const segments = String(value || "")
        .replace(/^\/+/, "")
        .replace(/\.git$/i, "")
        .split("/")
        .filter(Boolean)
      if (segments.length < 2) return null
      return {
        owner: segments[0],
        repo: segments[1],
        fullName: `${segments[0]}/${segments[1]}`
      }
    }

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw)
        if (parsed.hostname.toLowerCase() !== "github.com") return null
        return fromPath(parsed.pathname)
      } catch (_) {
        return null
      }
    }

    let match = raw.match(/^git@github\.com:(.+)$/i)
    if (match) return fromPath(match[1])

    match = raw.match(/^ssh:\/\/git@github\.com\/(.+)$/i)
    if (match) return fromPath(match[1])

    return null
  }

  static validateOwner(owner) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
      throw new Error(`Invalid GitHub owner: ${owner}`)
    }
  }

  static validateRepoName(name) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
      throw new Error(`Invalid GitHub repository name: ${name}`)
    }
  }

  static cleanParam(value) {
    const raw = String(value == null ? "" : value).trim()
    if (!raw || raw === "undefined" || raw === "null" || /^{{.+}}$/.test(raw)) {
      return ""
    }
    return raw
  }

  static parseRepoName(name, cwd) {
    const fallback = cwd ? path.basename(path.resolve(cwd)) : ""
    const raw = Github.cleanParam(name) || fallback
    const normalized = raw
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "")

    if (!normalized) {
      throw new Error("Repository name is required.")
    }

    const parts = normalized.split("/").filter(Boolean)
    if (parts.length > 2) {
      throw new Error(`Invalid GitHub repository name: ${raw}`)
    }

    const repo = parts.length === 2 ? parts[1] : parts[0]
    const owner = parts.length === 2 ? parts[0] : null

    if (owner) Github.validateOwner(owner)
    Github.validateRepoName(repo)

    return { owner, repo }
  }

  static normalizeVisibility(visibility) {
    const value = (Github.cleanParam(visibility) || "public").toLowerCase()
    if (!["public", "private", "internal"].includes(value)) {
      throw new Error(`Invalid GitHub repository visibility: ${visibility}`)
    }
    return value
  }

  static buildCreateRepoRequest({ owner, repo, authenticatedUser, visibility }) {
    const login = authenticatedUser && authenticatedUser.login ? String(authenticatedUser.login) : ""
    const body = { name: repo }

    if (visibility === "internal") {
      if (!owner || owner.toLowerCase() === login.toLowerCase()) {
        throw new Error("Internal repositories require an organization owner, for example org/repo.")
      }
      body.visibility = "internal"
    } else {
      body.private = visibility === "private"
    }

    if (owner && owner.toLowerCase() !== login.toLowerCase()) {
      return {
        path: `/orgs/${encodeURIComponent(owner)}/repos`,
        body
      }
    }

    return {
      path: "/user/repos",
      body
    }
  }

  static repoEquals(a, b) {
    return Boolean(
      a && b
      && String(a.owner).toLowerCase() === String(b.owner).toLowerCase()
      && String(a.repo).toLowerCase() === String(b.repo).toLowerCase()
    )
  }

  static repoFromApi(repo) {
    if (!repo || typeof repo !== "object") return null
    const owner = repo.owner && repo.owner.login ? String(repo.owner.login) : ""
    const name = repo.name ? String(repo.name) : ""
    if (owner && name) {
      return { owner, repo: name, fullName: `${owner}/${name}` }
    }
    if (repo.full_name) {
      const parts = String(repo.full_name).split("/")
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1], fullName: `${parts[0]}/${parts[1]}` }
      }
    }
    return Github.parseGithubRemote(repo.clone_url || repo.html_url || "")
  }

  params(req) {
    return req && req.params ? req.params : {}
  }

  cwd(req, kernel) {
    const params = this.params(req)
    return path.resolve(params.cwd || params.path || req.cwd || (kernel && kernel.homedir) || process.cwd())
  }

  gitEnv(kernel, { nonInteractive = true } = {}) {
    const env = kernel && kernel.envs ? { ...kernel.envs } : { ...process.env }
    if (kernel && kernel.homedir && !env.GIT_CONFIG_GLOBAL) {
      env.GIT_CONFIG_GLOBAL = path.resolve(kernel.homedir, "gitconfig")
    }
    return nonInteractive ? { ...env, ...NON_INTERACTIVE_GIT_ENV } : env
  }

  execGit(args, { cwd, kernel, input, timeout = 30000, allowFailure = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        {
          cwd,
          env: this.gitEnv(kernel),
          timeout,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error && !allowFailure) {
            error.stderr = stderr
            reject(error)
            return
          }
          resolve({ stdout: stdout || "", stderr: stderr || "", error })
        }
      )
      if (typeof input === "string") {
        child.stdin.end(input)
      }
    })
  }

  runGit(args, { cwd, kernel, ondata }) {
    return new Promise((resolve, reject) => {
      if (ondata) ondata({ raw: `git ${args.join(" ")}\r\n` })

      const child = spawn("git", args, {
        cwd,
        env: this.gitEnv(kernel),
        windowsHide: true
      })
      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (chunk) => {
        const raw = chunk.toString()
        stdout += raw
        if (ondata) ondata({ raw })
      })
      child.stderr.on("data", (chunk) => {
        const raw = chunk.toString()
        stderr += raw
        if (ondata) ondata({ raw })
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const error = new Error(`git ${args[0]} failed with exit code ${code}`)
          error.stdout = stdout
          error.stderr = stderr
          reject(error)
        }
      })
    })
  }

  async getCredential(req, kernel) {
    if (kernel && kernel.git && typeof kernel.git.ensureDefaults === "function") {
      await kernel.git.ensureDefaults()
    }

    const result = await this.execGit(["credential", "fill"], {
      cwd: (kernel && kernel.homedir) || this.cwd(req, kernel),
      kernel,
      input: "protocol=https\nhost=github.com\n\n",
      timeout: 30000
    })

    const credential = Github.parseCredentialOutput(result.stdout)
    if (!credential.password) {
      throw new Error("GitHub is not connected. Open /github and connect GitHub first.")
    }
    return credential
  }

  async githubRequest(token, method, apiPath, body) {
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "Pinokio",
      "X-GitHub-Api-Version": "2022-11-28"
    }
    const options = { method, headers }
    if (body) {
      headers["Content-Type"] = "application/json"
      options.body = JSON.stringify(body)
    }

    const response = await fetch(`https://api.github.com${apiPath}`, options)
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (_) {
        data = { message: text }
      }
    }

    if (!response.ok) {
      const message = data && data.message ? data.message : response.statusText
      const details = data && Array.isArray(data.errors) && data.errors.length > 0
        ? ` ${data.errors.map((error) => error.message || error.code || "").filter(Boolean).join(" ")}`
        : ""
      throw new Error(`GitHub request failed (${response.status}): ${message}${details}`)
    }

    return data
  }

  async getAuthenticatedUser(token) {
    return this.githubRequest(token, "GET", "/user")
  }

  async remoteUrl(cwd, name, kernel) {
    const result = await this.execGit(["remote", "get-url", name], {
      cwd,
      kernel,
      allowFailure: true,
      timeout: 10000
    })
    if (result.error) return ""
    return result.stdout.trim()
  }

  async githubRemote(cwd, kernel) {
    for (const name of ["upstream", "origin"]) {
      const url = await this.remoteUrl(cwd, name, kernel)
      const parsed = Github.parseGithubRemote(url)
      if (parsed) return { ...parsed, remote: name, url }
    }
    throw new Error("No GitHub remote found. Add an origin or upstream remote first.")
  }

  async remoteExists(cwd, name, kernel) {
    return Boolean(await this.remoteUrl(cwd, name, kernel))
  }

  async configureForkRemote({ cwd, kernel, ondata, source, forkRepo }) {
    const forkRemote = Github.repoFromApi(forkRepo)
    if (!forkRemote) {
      throw new Error("GitHub fork response did not include a repository owner and name.")
    }
    const originUrl = await this.remoteUrl(cwd, "origin", kernel)
    const origin = Github.parseGithubRemote(originUrl)
    const cloneUrl = forkRepo.clone_url

    if (!originUrl) {
      if (ondata) ondata({ raw: `Adding origin remote for ${forkRepo.full_name}\r\n` })
      await this.runGit(["remote", "add", "origin", cloneUrl], { cwd, kernel, ondata })
      return
    }

    if (Github.repoEquals(origin, forkRemote)) {
      if (ondata) ondata({ raw: `origin already points at ${forkRepo.full_name}\r\n` })
      return
    }

    const remoteName = forkRemote.owner || "fork"
    const existingRemoteUrl = await this.remoteUrl(cwd, remoteName, kernel)
    if (existingRemoteUrl) {
      const existingRemote = Github.parseGithubRemote(existingRemoteUrl)
      if (Github.repoEquals(existingRemote, forkRemote)) {
        if (ondata) ondata({ raw: `${remoteName} already points at ${forkRepo.full_name}\r\n` })
        return
      }
      if (remoteName !== "fork" && !(await this.remoteExists(cwd, "fork", kernel))) {
        if (ondata) ondata({ raw: `Adding fork remote for ${forkRepo.full_name}\r\n` })
        await this.runGit(["remote", "add", "fork", cloneUrl], { cwd, kernel, ondata })
        return
      }
      if (ondata) ondata({ raw: `${remoteName} remote already exists; leaving it unchanged\r\n` })
      return
    }

    if (ondata) ondata({ raw: `Adding ${remoteName} remote for ${forkRepo.full_name}\r\n` })
    await this.runGit(["remote", "add", remoteName, cloneUrl], { cwd, kernel, ondata })
  }

  async create(req, ondata, kernel) {
    const params = this.params(req)
    const cwd = this.cwd(req, kernel)
    const credential = await this.getCredential(req, kernel)
    const user = await this.getAuthenticatedUser(credential.password)
    const visibility = Github.normalizeVisibility(params.visibility)
    const repoName = Github.parseRepoName(params.name, cwd)
    const targetRepo = {
      owner: repoName.owner || String(user.login || ""),
      repo: repoName.repo,
      fullName: `${repoName.owner || String(user.login || "")}/${repoName.repo}`
    }
    const originUrl = await this.remoteUrl(cwd, "origin", kernel)
    if (originUrl) {
      const origin = Github.parseGithubRemote(originUrl)
      if (!Github.repoEquals(origin, targetRepo)) {
        throw new Error(`origin already points at ${originUrl}; refusing to push ${targetRepo.fullName}. Remove or update origin first.`)
      }
    }
    const request = Github.buildCreateRepoRequest({
      owner: repoName.owner,
      repo: repoName.repo,
      authenticatedUser: user,
      visibility
    })

    if (ondata) ondata({ raw: `Creating GitHub repository ${repoName.owner ? `${repoName.owner}/` : ""}${repoName.repo}\r\n` })
    const repo = await this.githubRequest(credential.password, "POST", request.path, request.body)

    if (!originUrl) {
      if (ondata) ondata({ raw: `Adding origin remote ${repo.clone_url}\r\n` })
      await this.runGit(["remote", "add", "origin", repo.clone_url], { cwd, kernel, ondata })
    } else if (ondata) {
      ondata({ raw: `origin already exists: ${originUrl}\r\n` })
    }

    if (ondata) ondata({ raw: "Pushing current branch to origin\r\n" })
    await this.runGit(["push", "-u", "origin", "HEAD"], { cwd, kernel, ondata })
    if (ondata) ondata({ raw: `Created ${repo.html_url}\r\n` })

    return repo
  }

  async fork(req, ondata, kernel) {
    const params = this.params(req)
    const cwd = this.cwd(req, kernel)
    const credential = await this.getCredential(req, kernel)
    const source = await this.githubRemote(cwd, kernel)
    const body = {}

    const requestedName = Github.cleanParam(params.name)
    if (requestedName) {
      const name = requestedName
      Github.validateRepoName(name)
      body.name = name
    }
    const requestedOrg = Github.cleanParam(params.org)
    if (requestedOrg) {
      const org = requestedOrg
      Github.validateOwner(org)
      body.organization = org
    }

    if (ondata) ondata({ raw: `Forking ${source.fullName}\r\n` })
    const forkRepo = await this.githubRequest(
      credential.password,
      "POST",
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/forks`,
      body
    )

    await this.configureForkRemote({ cwd, kernel, ondata, source, forkRepo })
    if (ondata) ondata({ raw: `Forked ${forkRepo.html_url}\r\n` })
    return forkRepo
  }
}

module.exports = Github
