const createTerminalGitResetHandler = ({
  kernel,
  git,
  fs,
  path,
  execFile,
  resolveRepoPath,
  isPathWithin,
  getTerminalWorkspacesRoot,
  maxPaths = 6000,
  chunkSize = 200
}) => {
  let gitBinaryCache = ""

  const fallbackIsPathWithin = (candidate, parent) => {
    const normalizedCandidate = typeof candidate === "string" && candidate.trim()
      ? path.resolve(candidate.trim())
      : ""
    const normalizedParent = typeof parent === "string" && parent.trim()
      ? path.resolve(parent.trim())
      : ""
    if (!normalizedCandidate || !normalizedParent) {
      return false
    }
    if (normalizedCandidate === normalizedParent) {
      return true
    }
    const withSep = normalizedParent.endsWith(path.sep) ? normalizedParent : `${normalizedParent}${path.sep}`
    return normalizedCandidate.startsWith(withSep)
  }

  const resolveRepoPathWithDefaults = (inputPath) => {
    if (typeof resolveRepoPath === "function") {
      return resolveRepoPath(inputPath)
    }
    if (typeof inputPath !== "string") {
      return null
    }
    const trimmed = inputPath.trim()
    if (!trimmed) {
      return null
    }
    const resolved = path.resolve(trimmed)
    const matcher = typeof isPathWithin === "function" ? isPathWithin : fallbackIsPathWithin
    const allowedRoots = []
    if (kernel && typeof kernel.path === "function") {
      allowedRoots.push(path.resolve(kernel.path("api")))
    }
    if (typeof getTerminalWorkspacesRoot === "function") {
      allowedRoots.push(path.resolve(getTerminalWorkspacesRoot()))
    }
    for (let i = 0; i < allowedRoots.length; i += 1) {
      if (matcher(resolved, allowedRoots[i])) {
        return resolved
      }
    }
    return null
  }

  const normalizePathList = (value) => {
    if (Array.isArray(value)) {
      return value
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return [value.trim()]
    }
    return []
  }

  const resolveRelativeRepoPath = (repoPath, rawPath) => {
    if (typeof rawPath !== "string") {
      return ""
    }
    const trimmed = rawPath.trim()
    if (!trimmed) {
      return ""
    }
    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(repoPath, trimmed)
    let relativePath = path.relative(repoPath, resolved)
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return ""
    }
    if (path.sep === "\\") {
      relativePath = relativePath.replace(/\\/g, "/")
    }
    return relativePath
  }

  const chunkPaths = (paths) => {
    if (!Array.isArray(paths) || paths.length === 0) {
      return []
    }
    const chunks = []
    for (let i = 0; i < paths.length; i += chunkSize) {
      chunks.push(paths.slice(i, i + chunkSize))
    }
    return chunks
  }

  const getExecEnv = () => {
    if (kernel && kernel.envs) {
      return kernel.envs
    }
    if (kernel && kernel.bin && typeof kernel.bin.envs === "function") {
      return kernel.bin.envs({})
    }
    return null
  }

  const normalizeBinaryCandidate = (value) => {
    if (typeof value !== "string") {
      return ""
    }
    const firstLine = value.split(/\r?\n/)[0]
    return firstLine ? firstLine.trim() : ""
  }

  const getGitBinaryCandidates = () => {
    const candidates = []
    const add = (value) => {
      const normalized = normalizeBinaryCandidate(value)
      if (!normalized) {
        return
      }
      if (!candidates.includes(normalized)) {
        candidates.push(normalized)
      }
    }

    add(gitBinaryCache)
    if (kernel && typeof kernel.which === "function") {
      try {
        add(kernel.which("git"))
      } catch (_) {
      }
    }
    add("git")
    return candidates
  }

  const execGit = async (repoPath, args) => {
    const env = getExecEnv()
    if (!env) {
      const error = new Error("Pinokio environment is not ready yet. Please try again.")
      error.code = "EUNAVAILABLE"
      throw error
    }
    const candidates = getGitBinaryCandidates()
    if (candidates.length === 0) {
      const error = new Error("Git executable not found in Pinokio environment.")
      error.code = "ENOENT"
      throw error
    }
    let lastError = null
    for (let i = 0; i < candidates.length; i += 1) {
      const binary = candidates[i]
      try {
        const result = await new Promise((resolve, reject) => {
          execFile(
            binary,
            args,
            {
              cwd: repoPath,
              env,
              maxBuffer: 10 * 1024 * 1024
            },
            (error, stdout, stderr) => {
              if (error) {
                error.stdout = stdout || ""
                error.stderr = stderr || ""
                reject(error)
                return
              }
              resolve({
                stdout: stdout || "",
                stderr: stderr || ""
              })
            }
          )
        })
        gitBinaryCache = binary
        return result
      } catch (error) {
        lastError = error
        if (error && error.code === "ENOENT") {
          continue
        }
        throw error
      }
    }
    const fallbackError = lastError || new Error("Git executable not found in Pinokio environment.")
    if (!fallbackError.code) {
      fallbackError.code = "ENOENT"
    }
    throw fallbackError
  }

  const isPathspecMissingError = (error) => {
    const message = `${error && error.message ? error.message : ""}\n${error && error.stderr ? error.stderr : ""}`
    return /did not match any file|did not match any files|pathspec/i.test(message)
  }

  const runChunkedCommand = async (repoPath, paths, buildArgs, options = {}) => {
    const chunks = chunkPaths(paths)
    let processedCount = 0
    let skippedMissingCount = 0
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      if (!Array.isArray(chunk) || chunk.length === 0) {
        continue
      }
      try {
        await execGit(repoPath, buildArgs(chunk))
        processedCount += chunk.length
      } catch (error) {
        if (options.ignoreMissingPathspec === true && isPathspecMissingError(error)) {
          skippedMissingCount += chunk.length
          continue
        }
        if (options.allowFallbackPerPath !== true || chunk.length <= 1) {
          throw error
        }
        for (let j = 0; j < chunk.length; j += 1) {
          const singlePath = chunk[j]
          try {
            await execGit(repoPath, buildArgs([singlePath]))
            processedCount += 1
          } catch (singleError) {
            if (options.ignoreMissingPathspec === true && isPathspecMissingError(singleError)) {
              skippedMissingCount += 1
              continue
            }
            throw singleError
          }
        }
      }
    }
    return {
      processedCount,
      skippedMissingCount
    }
  }

  return async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {}
    const requestedRepoPath = typeof body.cwd === "string"
      ? body.cwd
      : (typeof body.repo === "string"
          ? body.repo
          : (typeof body.repoPath === "string" ? body.repoPath : ""))
    const repoPath = resolveRepoPathWithDefaults(requestedRepoPath)
    if (!repoPath) {
      res.status(400).json({
        ok: false,
        error: "Valid repository path is required."
      })
      return
    }
    const stats = await fs.promises.stat(repoPath).catch(() => null)
    if (!stats || !stats.isDirectory()) {
      res.status(404).json({
        ok: false,
        error: "Repository not found."
      })
      return
    }

    const trackedInput = normalizePathList(body.tracked_paths || body.trackedPaths)
    const untrackedInput = normalizePathList(body.untracked_paths || body.untrackedPaths)
    if (trackedInput.length === 0 && untrackedInput.length === 0) {
      res.status(400).json({
        ok: false,
        error: "No files selected."
      })
      return
    }
    if ((trackedInput.length + untrackedInput.length) > maxPaths) {
      res.status(413).json({
        ok: false,
        error: `Too many files selected. Max ${maxPaths} files per request.`
      })
      return
    }

    const trackedSet = new Set()
    const untrackedSet = new Set()
    for (let i = 0; i < trackedInput.length; i += 1) {
      const relativePath = resolveRelativeRepoPath(repoPath, trackedInput[i])
      if (relativePath) {
        trackedSet.add(relativePath)
      }
    }
    for (let i = 0; i < untrackedInput.length; i += 1) {
      const relativePath = resolveRelativeRepoPath(repoPath, untrackedInput[i])
      if (relativePath && !trackedSet.has(relativePath)) {
        untrackedSet.add(relativePath)
      }
    }
    const trackedPaths = Array.from(trackedSet)
    const untrackedPaths = Array.from(untrackedSet)
    if (trackedPaths.length === 0 && untrackedPaths.length === 0) {
      res.status(400).json({
        ok: false,
        error: "No valid file paths were provided."
      })
      return
    }

    let hasHead = false
    try {
      await git.resolveRef({ fs, dir: repoPath, ref: "HEAD" })
      hasHead = true
    } catch (_) {
      hasHead = false
    }

    const startedAt = Date.now()
    let trackedResult = { processedCount: 0, skippedMissingCount: 0 }
    let untrackedResult = { processedCount: 0, skippedMissingCount: 0 }
    try {
      if (untrackedPaths.length > 0) {
        untrackedResult = await runChunkedCommand(
          repoPath,
          untrackedPaths,
          (chunk) => ["clean", "-f", "--", ...chunk],
          { allowFallbackPerPath: true, ignoreMissingPathspec: true }
        )
      }
      if (trackedPaths.length > 0) {
        if (hasHead) {
          trackedResult = await runChunkedCommand(
            repoPath,
            trackedPaths,
            (chunk) => ["restore", "--staged", "--worktree", "--", ...chunk],
            { allowFallbackPerPath: true, ignoreMissingPathspec: true }
          )
        } else {
          trackedResult = await runChunkedCommand(
            repoPath,
            trackedPaths,
            (chunk) => ["rm", "--cached", "--ignore-unmatch", "--", ...chunk],
            { allowFallbackPerPath: true, ignoreMissingPathspec: true }
          )
        }
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        res.status(503).json({
          ok: false,
          error: "Git executable is unavailable in the current Pinokio environment. Install Git from Tools and retry."
        })
        return
      }
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : ""
      const stdout = typeof error.stdout === "string" ? error.stdout.trim() : ""
      const message = stderr || stdout || (error && error.message ? error.message : "Failed to reset files.")
      res.status(500).json({
        ok: false,
        error: message
      })
      return
    }

    res.json({
      ok: true,
      cwd: repoPath,
      hasHead,
      requested: {
        tracked: trackedInput.length,
        untracked: untrackedInput.length
      },
      resolved: {
        tracked: trackedPaths.length,
        untracked: untrackedPaths.length
      },
      processed: {
        tracked: trackedResult.processedCount,
        untracked: untrackedResult.processedCount
      },
      skippedMissing: {
        tracked: trackedResult.skippedMissingCount,
        untracked: untrackedResult.skippedMissingCount
      },
      durationMs: Date.now() - startedAt
    })
  }
}

module.exports = {
  createTerminalGitResetHandler
}
