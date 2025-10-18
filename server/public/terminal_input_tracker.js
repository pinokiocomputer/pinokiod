(function (global) {
  const DEFAULT_LIMIT = 200

  class TerminalInputTracker {
    constructor(options) {
      this.limit = (options && Number.isFinite(options.limit)) ? options.limit : DEFAULT_LIMIT
      this.getFrameName = options && typeof options.getFrameName === "function"
        ? options.getFrameName
        : () => (global.name || null)
      this.getWindow = options && typeof options.getWindow === "function"
        ? options.getWindow
        : () => global
      this.buffer = ""
    }

    reset() {
      this.buffer = ""
    }

    handleBackspace() {
      if (this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1)
      }
    }

    capture(text) {
      if (typeof text !== "string" || text.length === 0) {
        return
      }
      const normalized = text.replace(/\r/g, "\n")
      const segments = normalized.split("\n")
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const isLast = (i === segments.length - 1)
        if (!isLast) {
          const line = this.buffer + segment
          this.buffer = ""
          this.submit(line, { hadLineBreak: true })
        } else {
          this.buffer += segment
        }
      }
    }

    submit(line, meta = {}) {
      const win = this.getWindow()
      if (!win) {
        return
      }
      const safeLine = (line || "").replace(/[\x00-\x1F\x7F]/g, "")
      const preview = safeLine.trim()
      const truncated = preview.length > this.limit ? `${preview.slice(0, this.limit)}...` : preview
      const hadLineBreak = Boolean(meta && meta.hadLineBreak)
      const meaningful = truncated.length > 0 || hadLineBreak
      const payload = {
        type: "terminal-input",
        frame: this.getFrameName(),
        line: truncated,
        hasContent: meaningful
      }

      let dispatched = false
      if (typeof global.PinokioBroadcastMessage === "function") {
        try {
          dispatched = global.PinokioBroadcastMessage(payload, "*", win)
        } catch (_) {
          dispatched = false
        }
      }
      if (dispatched) {
        return
      }
      try {
        if (win.parent && win.parent !== win && typeof win.parent.postMessage === "function") {
          win.parent.postMessage(payload, "*")
        }
      } catch (_) {}
    }
  }

  global.TerminalInputTracker = TerminalInputTracker
})(typeof window !== "undefined" ? window : this)
