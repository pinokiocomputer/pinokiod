const { execFile, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const fetch = require('cross-fetch')
const Environment = require('../../../environment')
const { managedPythonEnv } = require('../../../python_env')

const stripAnsi = (value) => String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")

class Huggingface {
  constructor(kernel, config) {
    this.kernel = kernel
    this.config = config
    this.loginSession = null
  }
  async readme() {
    return ""
  }
  defaultTokenPath() {
    return this.kernel.path("cache", "HF_AUTH", "token")
  }
  requestCwd(context = {}) {
    if (context.cwd) {
      return path.resolve(context.cwd)
    }
    if (context.parentPath) {
      return path.dirname(path.resolve(context.parentPath))
    }
    return this.kernel.homedir
  }
  async repairTokenPath(tokenPath) {
    try {
      const stat = await fs.promises.lstat(tokenPath)
      if (stat.isDirectory()) {
        await fs.promises.rmdir(tokenPath)
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        error.tokenPath = tokenPath
        throw error
      }
    }
    await fs.promises.mkdir(path.dirname(tokenPath), { recursive: true })
  }
  async authEnv(context = {}) {
    let env
    if (context.parentPath) {
      env = await Environment.get2(context.parentPath, this.kernel)
      if (env.HF_TOKEN_PATH === this.kernel.path("cache", "HF_AUTH", "anonymous")) env.HF_TOKEN_PATH = this.defaultTokenPath()
    } else {
      let systemEnv = {}
      try {
        systemEnv = await Environment.get(this.kernel.homedir, this.kernel)
      } catch (_) {
        systemEnv = {}
      }
      env = Object.assign({}, process.env, systemEnv)
    }
    if (context.env && typeof context.env === "object") {
      env = Object.assign(env, context.env)
    }
    env = managedPythonEnv(env)
    if (!env.HF_TOKEN_PATH) {
      env.HF_TOKEN_PATH = this.defaultTokenPath()
    } else if (!path.isAbsolute(env.HF_TOKEN_PATH)) {
      env.HF_TOKEN_PATH = path.resolve(this.requestCwd(context), env.HF_TOKEN_PATH)
    }
    if (!env.HF_HUB_DISABLE_UPDATE_CHECK) {
      env.HF_HUB_DISABLE_UPDATE_CHECK = "1"
    }
    delete env.HF_TOKEN
    delete env.HUGGING_FACE_HUB_TOKEN
    await this.repairTokenPath(env.HF_TOKEN_PATH)
    return env
  }
  hfPath() {
    const candidates = this.kernel.platform === "win32" ? [
      this.kernel.path("bin", "miniforge", "Scripts", "hf.exe"),
      this.kernel.path("bin", "miniforge", "Scripts", "hf"),
      this.kernel.path("bin", "miniforge", "bin", "hf"),
    ] : [
      this.kernel.path("bin", "miniforge", "bin", "hf"),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return candidates[0]
  }
  async runHf(args, options = {}, context = {}) {
    const env = await this.authEnv(context)
    return new Promise((resolve, reject) => {
      execFile(this.hfPath(), args, {
        cwd: this.requestCwd(context),
        env,
        timeout: Number.isFinite(options.timeout) ? options.timeout : undefined,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          error.tokenPath = env.HF_TOKEN_PATH
          error.stdout = stdout
          error.stderr = stderr
          reject(error)
        } else {
          resolve({ stdout, stderr, env })
        }
      })
    })
  }
  serializeLoginSession(session) {
    if (!session) {
      return null
    }
    return {
      status: session.status,
      login: session.login,
      error: session.error,
      token_path: session.tokenPath,
    }
  }
  parseDeviceLogin(output) {
    const clean = stripAnsi(output).replace(/\s+/g, " ")
    for (const line of stripAnsi(output).split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }
      let event
      try {
        event = JSON.parse(line)
      } catch (_) {
        continue
      }
      if (event && event.event === "device_code" && event.user_code) {
        return {
          verification_uri_complete: event.verification_uri_complete || event.verification_uri,
          user_code: event.user_code,
          expires_in: event.expires_in || null,
          interval: event.interval || null,
        }
      }
    }
    const urlMatch = clean.match(/open\s+(https?:\/\/\S+)/i)
    const codeMatch = clean.match(/enter the code\s+([A-Z0-9-]+)/i)
    const expiresMatch = clean.match(/expires in\s+(\d+)\s+seconds/i)
    if (!urlMatch || !codeMatch) {
      return null
    }
    return {
      verification_uri_complete: urlMatch[1].replace(/[).,]+$/, ""),
      user_code: codeMatch[1],
      expires_in: expiresMatch ? Number(expiresMatch[1]) : null,
    }
  }
  async login(_params = {}, context = {}) {
    const env = await this.authEnv(context)
    if (this.loginSession && this.loginSession.status === "pending") {
      if (this.loginSession.tokenPath !== env.HF_TOKEN_PATH) {
        return {
          status: "error",
          error: `A Hugging Face login is already pending for ${this.loginSession.tokenPath}`,
          token_path: env.HF_TOKEN_PATH,
        }
      }
      return this.serializeLoginSession(this.loginSession)
    }
    const session = {
      status: "pending",
      login: null,
      error: null,
      output: "",
      tokenPath: env.HF_TOKEN_PATH,
      child: null,
      readyResolved: false,
    }
    this.loginSession = session
    let resolveReady
    const ready = new Promise((resolve) => {
      resolveReady = resolve
    })
    const markReady = () => {
      if (!session.readyResolved) {
        session.readyResolved = true
        resolveReady()
      }
    }
    const appendOutput = (chunk) => {
      session.output += stripAnsi(chunk)
      const parsed = this.parseDeviceLogin(session.output)
      if (parsed && !session.login) {
        session.login = parsed
        markReady()
      }
    }
    const child = spawn(this.hfPath(), ["auth", "login", "--format", "agent", "--force"], {
      cwd: this.requestCwd(context),
      env,
      windowsHide: false,
    })
    session.child = child
    child.stdout.on("data", appendOutput)
    child.stderr.on("data", appendOutput)
    child.on("error", (error) => {
      session.status = "error"
      session.error = error.message
      markReady()
    })
    const readyTimer = setTimeout(() => {
      if (session.status === "pending" && !session.login) {
        session.status = "error"
        session.error = "Timed out waiting for Hugging Face login code."
        child.kill()
        markReady()
      }
    }, 15000)
    child.on("close", (code) => {
      clearTimeout(readyTimer)
      if (code === 0) {
        session.status = "success"
      } else {
        session.status = "error"
        session.error = session.error || stripAnsi(session.output).trim() || `hf auth login exited with code ${code}`
      }
      markReady()
    })
    await ready
    if (session.status === "error") {
      return this.serializeLoginSession(session)
    }
    return this.serializeLoginSession(session)
  }
  async keys(context = {}) {
    if (this.loginSession && this.loginSession.status === "pending") {
      const env = await this.authEnv(context)
      if (this.loginSession.tokenPath === env.HF_TOKEN_PATH) {
        return this.serializeLoginSession(this.loginSession)
      }
    }
    try {
      const { stdout, env } = await this.runHf(["auth", "token", "--format", "quiet"], {}, context)
      const access_token = stripAnsi(stdout).trim().split(/\r?\n/).find(Boolean)
      if (!access_token) {
        return null
      }
      return { access_token, token_path: env.HF_TOKEN_PATH }
    } catch (error) {
      return null
    }
  }
  async connected(options = {}, context = {}) {
    try {
      const result = await this.runHf(["auth", "whoami", "--format", "quiet"], options, context)
      if (this.kernel.envs && result.env.HF_TOKEN_PATH === this.defaultTokenPath()) {
        this.kernel.envs.HF_TOKEN_PATH = result.env.HF_TOKEN_PATH
      }
      return true
    } catch (error) {
      if (this.kernel.envs && error.tokenPath === this.defaultTokenPath()) {
        this.kernel.envs.HF_TOKEN_PATH = this.kernel.path("cache", "HF_AUTH", "anonymous")
      }
      return false
    }
  }
  async profile() {
    const keys = await this.keys()
    if (!keys || !keys.access_token) {
      return null
    }
    const response = await fetch(this.config.profile.url, {
      headers: {
        'Authorization': 'Bearer ' + keys.access_token
      }
    }).then((res) => {
      if (!res.ok) {
        throw new Error(`Hugging Face profile request failed with ${res.status}`)
      }
      return res.json()
    })
    const connectPath = this.kernel.path("connect", "huggingface")
    await fs.promises.mkdir(connectPath, { recursive: true }).catch(() => {})
    await this.config.profile.cache(response, connectPath).catch(() => {})
    return this.config.profile.render(response)
  }
  async destroy(context = {}) {
    if (this.loginSession && this.loginSession.child && this.loginSession.status === "pending") {
      this.loginSession.child.kill()
    }
    this.loginSession = null
    await this.runHf(["auth", "logout"], {}, context).catch(() => {})
    await fs.promises.rm(this.kernel.path("connect", "huggingface"), { recursive: true, force: true }).catch(() => {})
  }
  async cancelLogin() {
    const session = this.loginSession
    if (!session || session.status !== "pending") {
      return
    }
    session.status = "canceled"
    session.error = "Hugging Face login canceled."
    if (session.child) {
      session.child.kill()
    }
    if (this.loginSession === session) {
      this.loginSession = null
    }
  }
  async logout(_params = {}, context = {}) {
    await this.destroy(context)
  }
}

module.exports = Huggingface
