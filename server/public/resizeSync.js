(function(exports) {
  function createResizeSync(options) {
    const state = {
      term: options.term || null,
      fit: options.fit || null,
      socket: options.socket || null,
      getShellId: options.getShellId || (() => null),
      lastSize: null,
      initialSent: false,
      suppressNext: false,
      allowLocalFit: true
    }

    function sameSize(cols, rows) {
      return state.lastSize && state.lastSize.cols === cols && state.lastSize.rows === rows
    }

    function sendResize(cols, rows, force) {
      if (!state.socket || !state.getShellId || !state.getShellId()) {
        return
      }
      if (!force) {
        if (state.suppressNext) {
          state.suppressNext = false
          state.lastSize = { cols, rows }
          return
        }
        if (sameSize(cols, rows)) {
          return
        }
      } else {
        state.suppressNext = false
      }
      state.lastSize = { cols, rows }
      state.socket.run({
        resize: { cols, rows },
        id: state.getShellId()
      })
    }

    function applyForceResizeHandler() {
      if (typeof window === 'undefined' || !window.PinokioTerminalSettings || typeof window.PinokioTerminalSettings.setForceResizeHandler !== 'function') {
        return
      }
      if (!state.term) {
        window.PinokioTerminalSettings.setForceResizeHandler(null)
        return
      }
      window.PinokioTerminalSettings.setForceResizeHandler(() => {
        if (!state.term) {
          return
        }
        if (state.fit && typeof state.fit.fit === 'function') {
          try {
            state.fit.fit()
          } catch (_) {}
        }
        sendResize(state.term.cols, state.term.rows, true)
      })
    }

    applyForceResizeHandler()

    return {
      updateTerm: function(term, fit, socket) {
        state.term = term
        state.fit = fit
        state.socket = socket
        applyForceResizeHandler()
      },
      sendResize: function(cols, rows, force) {
        sendResize(cols, rows, force)
      },
      sendInitial: function() {
        if (state.initialSent || !state.term) return
        sendResize(state.term.cols, state.term.rows, true)
        state.initialSent = true
      },
      handleResizePacket: function(packet) {
        if (!state.term || !packet || !packet.data) return
        const cols = packet.data.cols
        const rows = packet.data.rows
        if (state.term.cols !== cols || state.term.rows !== rows) {
          state.allowLocalFit = false
          state.term.resize(cols, rows)
          state.allowLocalFit = true
        }
        state.lastSize = { cols, rows }
        state.suppressNext = true
        state.allowLocalFit = false
      },
      attachObserver: function(element) {
        const observer = new ResizeObserver(() => {
          if (!state.term) {
            return
          }
          if (!state.allowLocalFit) {
            state.allowLocalFit = true
            return
          }
          sendResize(state.term.cols, state.term.rows)
        })
        observer.observe(element)
        return observer
      },
      reset: function() {
        state.initialSent = false
        state.lastSize = null
        state.suppressNext = false
      }
    }
  }

  exports.PinokioResizeSync = {
    create: createResizeSync
  }
})(window)
