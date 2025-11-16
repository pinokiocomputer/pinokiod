(function(exports) {
  function createResizeSync(options) {
    const state = {
      term: options.term || null,
      fit: options.fit || null,
      socket: options.socket || null,
      getShellId: options.getShellId || (() => null),
      lastSize: null,
      initialSent: false
    }

    function sameSize(cols, rows) {
      return state.lastSize && state.lastSize.cols === cols && state.lastSize.rows === rows
    }

    function sendResize(cols, rows, force) {
      if (!state.socket || !state.getShellId || !state.getShellId()) {
        return
      }
      if (!force && sameSize(cols, rows)) {
        return
      }
      state.lastSize = { cols, rows }
      state.socket.run({
        resize: { cols, rows },
        id: state.getShellId()
      })
    }

    return {
      updateTerm: function(term, fit, socket) {
        state.term = term
        state.fit = fit
        state.socket = socket
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
          state.term.resize(cols, rows)
          if (state.fit && typeof state.fit.fit === 'function') {
            state.fit.fit()
          }
        }
        state.lastSize = { cols, rows }
      },
      attachObserver: function(element) {
        const observer = new ResizeObserver(() => {
          if (!state.term) {
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
      }
    }
  }

  exports.PinokioResizeSync = {
    create: createResizeSync
  }
})(window)
