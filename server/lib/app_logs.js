const fs = require('fs')
const path = require('path')

class AppLogService {
  constructor({ registry }) {
    if (!registry) {
      throw new Error('AppLogService requires registry')
    }
    this.registry = registry
  }

  async selectPreferredLogFile(logDir) {
    if (!(await this.registry.pathIsDirectory(logDir))) {
      return null
    }
    const latestPath = path.resolve(logDir, 'latest')
    if (await this.registry.pathIsFile(latestPath)) {
      return latestPath
    }
    let dirents = []
    try {
      dirents = await fs.promises.readdir(logDir, { withFileTypes: true })
    } catch (_) {
      return null
    }
    const numericFiles = dirents
      .filter((entry) => entry.isFile() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
    if (numericFiles.length > 0) {
      return path.resolve(logDir, numericFiles[0])
    }
    const eventsPath = path.resolve(logDir, 'events')
    if (await this.registry.pathIsFile(eventsPath)) {
      return eventsPath
    }
    return null
  }

  async resolveAppLogFile(appRoot, scriptQuery = '', runtimeScripts = []) {
    const apiLogsRoot = path.resolve(appRoot, 'logs', 'api')
    const candidates = []
    const addCandidate = (value) => {
      const normalized = this.registry.normalizeRelativeScriptPath(value)
      if (!normalized) {
        return
      }
      if (!candidates.includes(normalized)) {
        candidates.push(normalized)
      }
    }

    const normalizedScript = this.registry.normalizeRelativeScriptPath(scriptQuery)
    if (scriptQuery && !normalizedScript) {
      return { error: 'INVALID_SCRIPT' }
    }
    if (normalizedScript) {
      addCandidate(normalizedScript)
    }
    for (const script of runtimeScripts) {
      addCandidate(script)
    }
    addCandidate('start.json')
    addCandidate('start.js')

    if (await this.registry.pathIsDirectory(apiLogsRoot)) {
      for (const candidate of candidates) {
        const relativeSegments = candidate.split('/')
        const candidateDir = path.resolve(apiLogsRoot, ...relativeSegments)
        if (!this.registry.isPathWithin(apiLogsRoot, candidateDir)) {
          continue
        }
        const selected = await this.selectPreferredLogFile(candidateDir)
        if (selected) {
          return {
            source: 'api',
            script: candidate,
            file: selected
          }
        }
      }
      if (!normalizedScript) {
        let topLevel = []
        try {
          topLevel = await fs.promises.readdir(apiLogsRoot, { withFileTypes: true })
        } catch (_) {
          topLevel = []
        }
        const fallbackDirs = topLevel.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
        for (const dir of fallbackDirs) {
          const candidateDir = path.resolve(apiLogsRoot, dir)
          const selected = await this.selectPreferredLogFile(candidateDir)
          if (selected) {
            return {
              source: 'api',
              script: dir,
              file: selected
            }
          }
        }
      }
    }

    const shellLogsRoot = path.resolve(appRoot, 'logs', 'shell')
    if (await this.registry.pathIsDirectory(shellLogsRoot)) {
      const selected = await this.selectPreferredLogFile(shellLogsRoot)
      if (selected) {
        return {
          source: 'shell',
          script: null,
          file: selected
        }
      }
    }
    return null
  }

  async readLogTail(filePath, tailCount = 200) {
    const targetTail = this.registry.parseTailCount(tailCount, 200)
    const text = await fs.promises.readFile(filePath, 'utf8')
    const lines = text.split(/\r?\n/)
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    const tail = lines.slice(-targetTail)
    const stats = await fs.promises.stat(filePath)
    return {
      line_count: lines.length,
      tail_count: targetTail,
      lines: tail,
      text: tail.join('\n'),
      size: stats.size,
      modified: stats.mtime
    }
  }
}

module.exports = AppLogService
