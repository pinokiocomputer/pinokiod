class ShellStateSync {
  constructor(shell, options = {}) {
    this.shell = shell
    this.tailMax = Number.isFinite(options.tailMax) ? options.tailMax : 4096
    this.reset()
  }
  reset() {
    this.stateInterval = null
    this.lastStateSyncAt = 0
    this.cachedBuf = ""
    this.cachedCleaned = ""
    this.tail = ""
  }
  configure(value) {
    this.stateInterval = this.normalizeInterval(value)
  }
  normalizeInterval(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null
    }
    return Math.max(1, Math.floor(parsed))
  }
  invalidate(options = {}) {
    this.lastStateSyncAt = 0
    this.cachedBuf = ""
    this.cachedCleaned = ""
    if (options.clearTail) {
      this.tail = ""
    }
  }
  noteInput() {
    this.tail = ""
  }
  noteOutput(msg = "") {
    if (typeof msg !== "string" || msg.length === 0) {
      return
    }
    const normalized = this.shell.stripAnsi(msg)
      .replaceAll(/\r\n/g, "\n")
      .replaceAll(/\r/g, "\n")
    if (!normalized) {
      return
    }
    this.tail = (this.tail + normalized).slice(-this.tailMax)
  }
  shouldForceRefresh() {
    if (!this.stateInterval) {
      return true
    }
    if (!this.shell.ready) {
      return true
    }
    if (!this.shell.prompt_pattern || !this.tail) {
      return false
    }
    const terminationPromptRe = new RegExp(this.shell.prompt_pattern + "[ \r\n]*$", "g")
    const line = this.tail.replaceAll(/[\r\n]/g, "")
    return terminationPromptRe.test(line)
  }
  refresh(force = false) {
    const now = Date.now()
    const shouldRefresh = force ||
      !this.stateInterval ||
      !this.cachedBuf ||
      (now - this.lastStateSyncAt >= this.stateInterval)
    if (shouldRefresh) {
      this.cachedBuf = this.shell.vts.serialize()
      this.cachedCleaned = this.shell.stripAnsi(this.cachedBuf)
      this.shell.state = this.cachedCleaned
      this.lastStateSyncAt = now
    }
    return {
      buf: this.cachedBuf,
      cleaned: this.cachedCleaned
    }
  }
}

module.exports = ShellStateSync
