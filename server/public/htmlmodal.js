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
      .htmlmodal-overlay.visible { opacity: 1; visibility: visible; pointer-events: auto; }
      .htmlmodal-window { width: min(560px, 100%); max-height: calc(100vh - 64px); background: #0f172a; color: #f8fafc; border-radius: 18px; box-shadow: 0 30px 60px rgba(0,0,0,0.45); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(148,163,184,0.2); }
      .htmlmodal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; }
      .htmlmodal-title { font-size: 1.15rem; font-weight: 600; }
      .htmlmodal-close { background: none; border: none; color: #cbd5f5; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .htmlmodal-close:hover { background: rgba(255,255,255,0.08); }
      .htmlmodal-body { padding: 0 24px 16px; overflow-y: auto; font-size: 0.95rem; line-height: 1.5; }
      .htmlmodal-body p { margin: 0 0 0.85rem; }
      .htmlmodal-status { padding: 0 24px 18px; font-size: 0.9rem; color: #cbd5f5; display: flex; align-items: center; gap: 10px; }
      .htmlmodal-status.hidden { display: none; }
      .htmlmodal-status.error { color: #fecaca; }
      .htmlmodal-status.success { color: #bbf7d0; }
      .htmlmodal-status .spinner { width: 18px; height: 18px; border: 2px solid rgba(248, 250, 252, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: htmlmodal-spin 0.9s linear infinite; }
      @keyframes htmlmodal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .htmlmodal-actions { padding: 0 24px 24px; display: flex; flex-wrap: wrap; gap: 10px; }
      .htmlmodal-actions .btn { border-radius: 999px; border: 1px solid transparent; padding: 10px 18px; font-size: 0.9rem; cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; transition: transform 0.15s ease, background 0.2s ease, color 0.2s ease; }
      .htmlmodal-actions .btn.primary { background: #38bdf8; color: #0f172a; }
      .htmlmodal-actions .btn.primary:hover { background: #0ea5e9; transform: translateY(-1px); }
      .htmlmodal-actions .btn.secondary { background: rgba(148,163,184,0.18); color: #f8fafc; border-color: rgba(148,163,184,0.35); }
      .htmlmodal-actions .btn.secondary:hover { background: rgba(148,163,184,0.3); }
      .htmlmodal-actions .btn.link { background: rgba(56,189,248,0.12); border-color: rgba(56,189,248,0.55); color: #38bdf8; padding: 10px 18px; }
      .htmlmodal-actions .btn.link:hover { background: rgba(56,189,248,0.2); color: #7dd3fc; transform: translateY(-1px); }
      .htmlmodal-actions .btn:disabled { opacity: 0.6; cursor: not-allowed; }
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
        dismissible: true
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
        this.show()
        this.render(payload)
      } else if (action === 'update') {
        if (!this.current.id) {
          this.current.id = payload.id
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
        link.addEventListener('click', () => {
          // keep modal open, just open link
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
      if (action && action.variant) {
        classes.push(action.variant)
      } else {
        classes.push(fallback)
      }
      if (action && action.primary) {
        classes.push('primary')
      }
      return classes.join(' ')
    }

    handleAction(action) {
      if (!action) {
        return
      }
      if (action.type === 'link' && action.href) {
        const target = action.target || '_blank'
        window.open(action.href, target, action.features || 'noopener')
        return
      }
      if (action.type === 'submit' && this.current.awaiting && this.current.socket) {
        this.emitResponse({ action: action.id || 'submit', payload: action.payload || null })
        if (action.close !== false) {
          this.hide()
        }
      } else if (action.type === 'button' && this.current.socket && this.current.awaiting) {
        this.emitResponse({ action: action.id || 'button', payload: action.payload || null })
      } else if (action.type === 'button' && action.href) {
        window.open(action.href, action.target || '_blank')
      }
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
        this.actions.style.justifyContent = 'flex-start'
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
