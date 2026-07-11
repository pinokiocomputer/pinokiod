(function () {
  const createElement = (tag, className) => {
    const el = document.createElement(tag)
    if (className) {
      el.className = className
    }
    return el
  }

  const ensureStyle = () => {
    if (document.getElementById('htmlmodal-style')) {
      return
    }
    const style = document.createElement('style')
    style.id = 'htmlmodal-style'
    style.textContent = `
      .htmlmodal-overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.72); backdrop-filter: blur(6px); z-index: 1000000000005; padding: 32px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.18s ease, visibility 0.18s ease; }
      .htmlmodal-overlay.minimal { background: rgba(9, 11, 15, 0.34); backdrop-filter: none; padding: 24px; }
      body.dark .htmlmodal-overlay.minimal { background: rgba(0, 0, 0, 0.58); }
      .htmlmodal-overlay.visible { opacity: 1; visibility: visible; pointer-events: auto; }
      .htmlmodal-window { width: min(560px, 100%); max-height: calc(100vh - 64px); background: #0f172a; color: #f8fafc; border-radius: 18px; box-shadow: 0 30px 60px rgba(0,0,0,0.45); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(148,163,184,0.2); }
      .htmlmodal-window.minimal { width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 48px); background: #ffffff; color: #18181b; border-radius: 8px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.16); border-color: rgba(24, 24, 27, 0.12); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body.dark .htmlmodal-window.minimal { background: #1b1c1d; color: rgba(250, 250, 250, 0.94); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 24px 72px rgba(0, 0, 0, 0.42); }
      .htmlmodal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; }
      .htmlmodal-window.minimal .htmlmodal-header { gap: 16px; padding: 20px 20px 12px; }
      .htmlmodal-title { font-size: 1.15rem; font-weight: 600; }
      .htmlmodal-window.minimal .htmlmodal-title { font-size: 16px; line-height: 1.25; letter-spacing: 0; }
      .htmlmodal-close { background: none; border: none; color: #cbd5f5; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .htmlmodal-close:hover { background: rgba(255,255,255,0.08); }
      .htmlmodal-window.minimal .htmlmodal-close { width: 28px; height: 28px; margin: -6px -6px 0 0; background: transparent; border: 1px solid transparent; color: #71717a; font: inherit; font-size: 18px; line-height: 1; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
      .htmlmodal-window.minimal .htmlmodal-close:hover, .htmlmodal-window.minimal .htmlmodal-close:focus-visible { background: rgba(24, 24, 27, 0.06); color: #18181b; outline: none; }
      body.dark .htmlmodal-window.minimal .htmlmodal-close { color: rgba(229, 231, 235, 0.58); }
      body.dark .htmlmodal-window.minimal .htmlmodal-close:hover, body.dark .htmlmodal-window.minimal .htmlmodal-close:focus-visible { background: rgba(255, 255, 255, 0.07); color: rgba(250, 250, 250, 0.94); }
      .htmlmodal-body { padding: 0 24px 16px; overflow-y: auto; font-size: 0.95rem; line-height: 1.5; }
      .htmlmodal-window.minimal .htmlmodal-body { padding: 0 20px; color: #71717a; font-size: 13px; line-height: 1.45; }
      body.dark .htmlmodal-window.minimal .htmlmodal-body { color: rgba(229, 231, 235, 0.62); }
      .htmlmodal-body p { margin: 0 0 0.85rem; }
      .htmlmodal-window.minimal .htmlmodal-body p { margin: 0 0 10px; }
      .htmlmodal-status { padding: 0 24px 18px; font-size: 0.9rem; color: #cbd5f5; display: flex; align-items: center; gap: 10px; }
      .htmlmodal-window.minimal .htmlmodal-status { padding: 12px 20px 0; font-size: 13px; line-height: 1.4; color: #71717a; gap: 8px; }
      body.dark .htmlmodal-window.minimal .htmlmodal-status { color: rgba(229, 231, 235, 0.62); }
      .htmlmodal-status.hidden { display: none; }
      .htmlmodal-status.error { color: #fecaca; }
      .htmlmodal-status.success { color: #bbf7d0; }
      .htmlmodal-window.minimal .htmlmodal-status.error { color: #b91c1c; }
      .htmlmodal-window.minimal .htmlmodal-status.success { color: #15803d; }
      body.dark .htmlmodal-window.minimal .htmlmodal-status.error { color: #fca5a5; }
      body.dark .htmlmodal-window.minimal .htmlmodal-status.success { color: #86efac; }
      .htmlmodal-status .spinner { width: 18px; height: 18px; border: 2px solid rgba(248, 250, 252, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: htmlmodal-spin 0.9s linear infinite; }
      .htmlmodal-window.minimal .htmlmodal-status .spinner { width: 14px; height: 14px; border-color: rgba(24, 24, 27, 0.14); border-top-color: #18181b; }
      body.dark .htmlmodal-window.minimal .htmlmodal-status .spinner { border-color: rgba(255, 255, 255, 0.16); border-top-color: rgba(250, 250, 250, 0.94); }
      @keyframes htmlmodal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .htmlmodal-actions { padding: 0 24px 24px; display: flex; flex-wrap: wrap; gap: 10px; }
      .htmlmodal-window.minimal .htmlmodal-actions { padding: 16px 20px 20px; gap: 8px; justify-content: flex-end; }
      .htmlmodal-actions .btn { border-radius: 999px; border: 1px solid transparent; padding: 10px 18px; font-size: 0.9rem; cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; transition: transform 0.15s ease, background 0.2s ease, color 0.2s ease; }
      .htmlmodal-actions .btn.primary { background: #38bdf8; color: #0f172a; }
      .htmlmodal-actions .btn.primary:hover { background: #0ea5e9; transform: translateY(-1px); }
      .htmlmodal-actions .btn.secondary { background: rgba(148,163,184,0.18); color: #f8fafc; border-color: rgba(148,163,184,0.35); }
      .htmlmodal-actions .btn.secondary:hover { background: rgba(148,163,184,0.3); }
      .htmlmodal-actions .btn.link { background: rgba(56,189,248,0.12); border-color: rgba(56,189,248,0.55); color: #38bdf8; padding: 10px 18px; }
      .htmlmodal-actions .btn.link:hover { background: rgba(56,189,248,0.2); color: #7dd3fc; transform: translateY(-1px); }
      .htmlmodal-window.minimal .htmlmodal-actions .btn { min-height: 32px; border-radius: 6px; border: 1px solid rgba(24, 24, 27, 0.12); padding: 0 12px; background: transparent; color: #52525b; font: inherit; font-size: 13px; font-weight: 600; justify-content: center; box-shadow: none; transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease; }
      .htmlmodal-window.minimal .htmlmodal-actions .btn.primary { background: #18181b; border-color: #18181b; color: #ffffff; }
      .htmlmodal-window.minimal .htmlmodal-actions .btn.primary:hover, .htmlmodal-window.minimal .htmlmodal-actions .btn.primary:focus-visible { background: #27272a; border-color: #27272a; outline: none; transform: none; }
      .htmlmodal-window.minimal .htmlmodal-actions .btn.secondary:hover, .htmlmodal-window.minimal .htmlmodal-actions .btn.secondary:focus-visible, .htmlmodal-window.minimal .htmlmodal-actions .btn.link:hover, .htmlmodal-window.minimal .htmlmodal-actions .btn.link:focus-visible { background: rgba(24, 24, 27, 0.06); color: #18181b; outline: none; transform: none; }
      .htmlmodal-window.minimal .htmlmodal-actions .btn.link { color: #52525b; }
      body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn { border-color: rgba(255, 255, 255, 0.1); color: rgba(229, 231, 235, 0.7); }
      body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.primary { background: rgba(250, 250, 250, 0.94); border-color: rgba(250, 250, 250, 0.94); color: #1b1c1d; }
      body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.primary:hover, body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.primary:focus-visible { background: #ffffff; border-color: #ffffff; color: #18181b; }
      body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.secondary:hover, body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.secondary:focus-visible, body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.link:hover, body.dark .htmlmodal-window.minimal .htmlmodal-actions .btn.link:focus-visible { background: rgba(255, 255, 255, 0.07); color: rgba(250, 250, 250, 0.94); }
      .htmlmodal-actions .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .hf-login-modal { display: flex; flex-direction: column; gap: 10px; }
      .hf-login-modal p { margin: 0; }
      .hf-login-modal-copy { font-size: 12px; color: #71717a; }
      .hf-login-modal-copy.warning { color: #b45309; }
      body.dark .hf-login-modal-copy { color: rgba(229, 231, 235, 0.62); }
      body.dark .hf-login-modal-copy.warning { color: #fbbf24; }
      .hf-login-modal-code { display: block; width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; background: rgba(24, 24, 27, 0.03); border: 1px solid rgba(24, 24, 27, 0.12); color: #18181b; font: 600 20px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; letter-spacing: 0; text-align: center; user-select: all; }
      body.dark .hf-login-modal-code { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.1); color: rgba(250, 250, 250, 0.94); }
      .hf-login-modal-note { font-size: 12px; color: inherit !important; }
      @media only screen and (max-width: 480px) {
        .htmlmodal-overlay.minimal { padding: 16px; }
        .htmlmodal-window.minimal { width: calc(100vw - 32px); }
        .htmlmodal-window.minimal .htmlmodal-actions { flex-direction: column-reverse; align-items: stretch; }
        .htmlmodal-window.minimal .htmlmodal-actions .btn { width: 100%; }
      }
    `
    document.head.appendChild(style)
  }

  class HtmlModalManager {
    constructor() {
      ensureStyle()
      this.overlay = createElement('div', 'htmlmodal-overlay')
      this.window = createElement('div', 'htmlmodal-window')
      this.header = createElement('div', 'htmlmodal-header')
      this.titleEl = createElement('div', 'htmlmodal-title')
      this.closeBtn = createElement('button', 'htmlmodal-close')
      this.closeBtn.setAttribute('aria-label', 'Close dialog')
      this.closeBtn.innerHTML = '&times;'
      this.body = createElement('div', 'htmlmodal-body')
      this.status = createElement('div', 'htmlmodal-status')
      this.actions = createElement('div', 'htmlmodal-actions')

      this.header.appendChild(this.titleEl)
      this.header.appendChild(this.closeBtn)
      this.window.appendChild(this.header)
      this.window.appendChild(this.body)
      this.window.appendChild(this.status)
      this.window.appendChild(this.actions)
      this.overlay.appendChild(this.window)
      document.body.appendChild(this.overlay)

      this.closeBtn.addEventListener('click', () => {
        this.emitResponse({ action: 'dismissed' })
        this.hide()
      })

      this.current = {
        id: null,
        title: '',
        awaiting: null,
        actions: [],
        socket: null,
        dismissible: true,
        variant: null
      }
    }

    handle(packet, socket) {
      const payload = packet.data || {}
      const action = payload.action || 'update'
      this.current.socket = socket
      if (!payload.id) {
        payload.id = this.current.id || 'htmlmodal'
      }
      if (action === 'close') {
        this.hide()
        this.current.awaiting = null
        return
      }
      if (action === 'open') {
        this.current.id = payload.id
        this.current.dismissible = true
        this.closeBtn.style.display = 'inline-flex'
        this.setVariant(payload.variant)
        this.show()
        this.render(payload)
      } else if (action === 'update') {
        if (!this.current.id) {
          this.current.id = payload.id
          this.setVariant(payload.variant)
          this.show()
        }
        this.render(payload)
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'await')) {
        const awaitTarget = payload.awaitKey || packet.id
        if (payload.await) {
          this.current.awaiting = awaitTarget
        } else if (this.current.awaiting === awaitTarget) {
          this.current.awaiting = null
        }
      }
    }

    show() {
      this.overlay.classList.add('visible')
    }

    hide() {
      this.overlay.classList.remove('visible')
      this.current.id = null
      this.current.actions = []
      this.current.dismissible = true
      this.closeBtn.style.display = 'inline-flex'
      this.setVariant(null)
    }

    setVariant(variant) {
      const name = variant === 'minimal' ? 'minimal' : null
      this.current.variant = name
      this.overlay.classList.toggle('minimal', name === 'minimal')
      this.window.classList.toggle('minimal', name === 'minimal')
    }

    setTitle(title) {
      if (typeof title === 'string') {
        this.titleEl.textContent = title
      }
    }

    setBody(html) {
      if (typeof html === 'string') {
        this.body.innerHTML = html
      }
    }

    setStatus(payload) {
      if (typeof payload === 'undefined') {
        this.status.classList.add('hidden')
        this.status.innerHTML = ''
        return
      }
      this.status.innerHTML = ''
      this.status.className = 'htmlmodal-status'
      if (!payload) {
        this.status.classList.add('hidden')
        return
      }
      this.status.classList.remove('hidden')
      if (payload.variant) {
        this.status.classList.add(payload.variant)
      }
      if (payload.waiting) {
        const spinner = createElement('span', 'spinner')
        this.status.appendChild(spinner)
      }
      const text = payload.text || ''
      if (text) {
        const span = createElement('span')
        span.innerHTML = text
        this.status.appendChild(span)
      }
    }

    renderActions(list) {
      if (!Array.isArray(list)) {
        return
      }
      this.current.actions = list
      this.actions.innerHTML = ''
      list.forEach((action) => {
        const btn = this.createActionButton(action)
        if (btn) {
          this.actions.appendChild(btn)
        }
      })
    }

    createActionButton(action) {
      if (!action) {
        return null
      }
      if (action.type === 'link' && action.href) {
        const link = createElement('a', this.buildButtonClass(action, 'link'))
        link.href = action.href
        link.target = action.target || '_blank'
        link.rel = action.rel || 'noopener noreferrer'
        link.textContent = action.label || action.id || 'Open'
        if (action.icon) {
          link.innerHTML = `<i class="${action.icon}"></i> ${link.textContent}`
        }
        link.addEventListener('click', (event) => {
          if (action.features) {
            event.preventDefault()
            this.handleAction(action)
          }
        })
        return link
      }
      const button = createElement('button', this.buildButtonClass(action))
      button.type = 'button'
      button.textContent = action.label || action.id || 'Action'
      if (action.icon) {
        button.innerHTML = `<i class="${action.icon}"></i> ${button.textContent}`
      }
      if (action.disabled) {
        button.disabled = true
      }
      button.addEventListener('click', () => {
        this.handleAction(action)
      })
      return button
    }

    buildButtonClass(action, fallback = 'secondary') {
      const classes = ['btn']
      if (action && action.primary) {
        classes.push('primary')
      } else if (action && action.variant) {
        classes.push(action.variant)
      } else {
        classes.push(fallback)
      }
      return classes.join(' ')
    }

    async copyActionText(action) {
      if (!action || typeof action.copyText !== 'string') {
        return
      }
      const feedback = action.copyFeedbackSelector
        ? this.body.querySelector(action.copyFeedbackSelector)
        : null
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(action.copyText)
        } else {
          const input = createElement('textarea')
          try {
            input.value = action.copyText
            input.setAttribute('readonly', '')
            input.style.position = 'fixed'
            input.style.opacity = '0'
            document.body.appendChild(input)
            input.select()
            if (!document.execCommand('copy')) {
              throw new Error('Clipboard copy was rejected')
            }
          } finally {
            input.remove()
          }
        }
        if (feedback) {
          feedback.textContent = 'The code has been copied to your clipboard.'
          feedback.classList.remove('warning')
          feedback.classList.add('success')
        }
      } catch (_) {
        if (feedback) {
          feedback.textContent = 'Clipboard copy failed. Copy the displayed code manually.'
          feedback.classList.remove('success')
          feedback.classList.add('warning')
        }
      }
    }

    handleAction(action) {
      if (!action) {
        return
      }
      if (typeof action.copyText === 'string') {
        this.copyActionText(action)
      }
      if (action.type === 'link' && action.href) {
        this.openActionUrl(action)
        return
      }
      if (action.type === 'submit' && action.href) {
        this.openActionUrl(action)
      }
      if (action.type === 'submit' && this.current.awaiting && this.current.socket) {
        this.emitResponse({ action: action.id || 'submit', payload: action.payload || null })
        if (action.close !== false) {
          this.hide()
        }
      } else if (action.type === 'button' && this.current.socket && this.current.awaiting) {
        this.emitResponse({ action: action.id || 'button', payload: action.payload || null })
      } else if (action.type === 'button' && action.href) {
        this.openActionUrl(action)
      }
    }

    openActionUrl(action) {
      if (action.features && action.features.includes('browser')) {
        const agent = document.body.getAttribute('data-agent')
        if (agent === 'electron') {
          window.open(action.href, action.target || '_blank', 'browser')
        } else {
          window.open(action.href, action.target || '_blank')
        }
        return
      }
      window.open(action.href, action.target || '_blank', action.features || 'noopener')
    }

    emitResponse(data) {
      if (!this.current.socket || !this.current.awaiting) {
        return
      }
      this.current.socket.respond({
        response: data,
        uri: this.current.awaiting
      })
      this.current.awaiting = null
    }

    render(payload) {
      if (payload.title) {
        this.current.title = payload.title
        this.setTitle(payload.title)
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'html')) {
        this.setBody(payload.html || '')
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'status') || Object.prototype.hasOwnProperty.call(payload, 'statusText')) {
        const statusPayload = Object.prototype.hasOwnProperty.call(payload, 'status')
          ? payload.status
          : { text: payload.statusText, waiting: payload.waiting, variant: payload.statusVariant }
        this.setStatus(statusPayload)
      }
      if (Array.isArray(payload.actions)) {
        this.renderActions(payload.actions)
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'actionsAlign')) {
        const align = payload.actionsAlign
        if (align === 'end') {
          this.actions.style.justifyContent = 'flex-end'
        } else if (align === 'center') {
          this.actions.style.justifyContent = 'center'
        } else {
          this.actions.style.justifyContent = 'flex-start'
        }
      } else {
        this.actions.style.justifyContent = ''
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'variant')) {
        this.setVariant(payload.variant)
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'dismissible')) {
        this.current.dismissible = Boolean(payload.dismissible)
        this.closeBtn.style.display = this.current.dismissible ? 'inline-flex' : 'none'
      }
    }
  }

  const bootHtmlModal = () => {
    if (!window.HtmlModal) {
      window.HtmlModal = new HtmlModalManager()
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootHtmlModal, { once: true })
  } else {
    bootHtmlModal()
  }
})()
