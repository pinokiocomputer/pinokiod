;(function() {
  if (typeof window === 'undefined') {
    return
  }
  if (window.PinokioTouch) {
    return
  }

  const TOUCH_FOCUS_KEY = '__pinokioTouchFocusHandler'
  const TOUCH_OPTIONS = (() => {
    let passiveSupported = false
    try {
      const opts = Object.defineProperty({}, 'passive', {
        get() {
          passiveSupported = true
          return true
        }
      })
      window.addEventListener('test-passive', null, opts)
      window.removeEventListener('test-passive', null, opts)
    } catch (_) {}
    return passiveSupported ? { passive: true } : false
  })()

  const isTouchLikeEvent = (event) => {
    if (!event || typeof event !== 'object') {
      return false
    }
    const pointerType = typeof event.pointerType === 'string' ? event.pointerType.toLowerCase() : ''
    if (pointerType) {
      return pointerType === 'touch' || pointerType === 'pen'
    }
    const touches = event.touches || event.changedTouches
    return Boolean(touches && touches.length > 0)
  }

  const bindPointer = (target, handler, options = {}) => {
    if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') {
      return () => {}
    }
    const pointerOpts = Object.prototype.hasOwnProperty.call(options, 'pointer') ? options.pointer : undefined
    const touchOpts = Object.prototype.hasOwnProperty.call(options, 'touch') ? options.touch : TOUCH_OPTIONS
    target.addEventListener('pointerdown', handler, pointerOpts)
    target.addEventListener('touchstart', handler, touchOpts)
    return () => {
      target.removeEventListener('pointerdown', handler, pointerOpts)
      target.removeEventListener('touchstart', handler, touchOpts)
    }
  }

  const bindTerminalFocus = (term, container) => {
    if (!term || typeof term.focus !== 'function' || !container) {
      return () => {}
    }

    const existing = container[TOUCH_FOCUS_KEY]
    if (typeof existing === 'function') {
      existing()
    }

    const handler = (event) => {
      if (!isTouchLikeEvent(event)) {
        return
      }
      term.focus()
    }

    const unbind = bindPointer(container, handler)
    container[TOUCH_FOCUS_KEY] = unbind

    return () => {
      if (typeof unbind === 'function') {
        unbind()
      }
      if (container[TOUCH_FOCUS_KEY] === unbind) {
        delete container[TOUCH_FOCUS_KEY]
      }
    }
  }

  window.PinokioTouch = {
    bindPointer,
    bindTerminalFocus,
    isTouchLikeEvent
  }
})()
