(function (global) {
  const DEFAULT_LIMIT = 512
  const NAVIGATION_KEYS = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Insert'
  ])

  class TabCaptionHelper {
    constructor(term, options = {}) {
      this.term = term
      this.tracker = options.tracker || null
      this.limit = Number.isFinite(options.maxBuffer) && options.maxBuffer > 0 ? options.maxBuffer : DEFAULT_LIMIT
      this.buffer = ''
      this.pendingLine = null
      this.keyListener = null
      this.restoreSubmit = null
      this.install()
    }

    install() {
      this.attachKeyListener()
      this.patchTracker()
    }

    attachKeyListener() {
      if (!this.term || typeof this.term.onKey !== 'function') {
        return
      }
      const disposable = this.term.onKey((event) => {
        this.handleKeyEvent(event)
      })
      if (disposable && typeof disposable.dispose === 'function') {
        this.keyListener = () => {
          disposable.dispose()
        }
      }
    }

    patchTracker() {
      if (!this.tracker || typeof this.tracker.submit !== 'function') {
        return
      }
      const originalSubmit = this.tracker.submit
      const helper = this
      this.tracker.submit = function helperSubmit(line, meta) {
        const override = helper.consumePendingLine()
        if (typeof override === 'string') {
          return originalSubmit.call(this, override, meta)
        }
        return originalSubmit.call(this, line, meta)
      }
      this.restoreSubmit = () => {
        this.tracker.submit = originalSubmit
      }
    }

    consumePendingLine() {
      if (this.pendingLine !== null) {
        const next = this.pendingLine
        this.pendingLine = null
        return next
      }
      return null
    }

    handleKeyEvent(event) {
      if (!event || !event.domEvent) {
        return
      }
      const domEvent = event.domEvent
      const key = domEvent.key
      if (!key) {
        return
      }
      if (domEvent.isComposing) {
        return
      }
      if (key === 'Enter') {
        this.commitBuffer()
        return
      }
      if (key === 'Backspace') {
        this.applyBackspace()
        return
      }
      if (key === 'Escape') {
        this.resetBuffer()
        return
      }
      if (domEvent.ctrlKey || domEvent.metaKey) {
        this.handleModifierCombo(key)
        return
      }
      if (NAVIGATION_KEYS.has(key) || key === 'Tab') {
        this.resetBuffer()
        return
      }
      if (this.isPrintable(domEvent)) {
        this.appendCharacter(domEvent.key)
      }
    }

    handleModifierCombo(key) {
      const lower = typeof key === 'string' ? key.toLowerCase() : ''
      if (!lower) {
        return
      }
      if (lower === 'c' || lower === 'd' || lower === 'l') {
        this.resetBuffer()
        return
      }
      if (lower === 'u' || lower === 'w' || lower === 'k') {
        this.resetBuffer()
      }
    }

    isPrintable(domEvent) {
      if (!domEvent || typeof domEvent.key !== 'string') {
        return false
      }
      if (domEvent.ctrlKey || domEvent.metaKey) {
        return false
      }
      if (domEvent.altKey && domEvent.key.length !== 1) {
        return false
      }
      return domEvent.key.length === 1
    }

    appendCharacter(char) {
      if (typeof char !== 'string' || char.length === 0) {
        return
      }
      if (this.buffer.length >= this.limit) {
        return
      }
      this.buffer += char
    }

    applyBackspace() {
      if (!this.buffer) {
        return
      }
      this.buffer = this.buffer.slice(0, -1)
    }

    commitBuffer() {
      this.pendingLine = this.buffer
      this.buffer = ''
    }

    resetBuffer() {
      this.buffer = ''
      this.pendingLine = null
    }

    dispose() {
      if (this.keyListener) {
        this.keyListener()
        this.keyListener = null
      }
      if (this.restoreSubmit) {
        this.restoreSubmit()
        this.restoreSubmit = null
      }
    }
  }

  function attach(term, options) {
    if (!term) {
      return null
    }
    return new TabCaptionHelper(term, options || {})
  }

  global.PinokioTabCaptionHelper = {
    attach,
    Helper: TabCaptionHelper
  }
})(typeof window !== 'undefined' ? window : this)
