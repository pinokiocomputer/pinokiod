(function (global) {
  function processTerminalInputData(data, handlers) {
    if (!data || typeof data !== 'string' || !handlers) {
      return
    }
    const capture = typeof handlers.capture === 'function' ? handlers.capture : function () {}
    const handleBackspace = typeof handlers.backspace === 'function' ? handlers.backspace : function () {}
    const resetBuffer = typeof handlers.reset === 'function' ? handlers.reset : function () {}

    let printable = ''
    let lastWasCR = false
    const flush = () => {
      if (printable) {
        capture(printable)
        printable = ''
      }
    }

    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (ch === '\u0008' || ch === '\u007f') { // backspace / DEL
        flush()
        handleBackspace()
        lastWasCR = false
        continue
      }
      if (ch === '\r') {
        flush()
        capture('\n')
        lastWasCR = true
        continue
      }
      if (ch === '\n') {
        if (lastWasCR) {
          lastWasCR = false
          continue
        }
        flush()
        capture('\n')
        lastWasCR = false
        continue
      }
      if (ch === '\t') {
        flush()
        capture('\t')
        lastWasCR = false
        continue
      }
      if (ch === '\u001b') { // ESC
        flush()
        if (data.length === 1) {
          resetBuffer()
        }
        lastWasCR = false
        continue
      }
      if (ch === '\u0015' || ch === '\u0017' || ch === '\u000b' || ch === '\u0003') {
        flush()
        resetBuffer()
        lastWasCR = false
        continue
      }
      if (ch >= ' ') {
        printable += ch
      }
      lastWasCR = false
    }
    flush()
  }

  global.processTerminalInputData = processTerminalInputData
})(typeof window !== 'undefined' ? window : this)
