(function() {
  const MAX_VIEWER_CHARS = 2 * 1024 * 1024
  const LOGS_SIDEBAR_STORAGE_KEY = 'pinokio.logs.sidebar-collapsed'
  const LOGS_SIDEBAR_WIDTH_KEY = 'pinokio.logs.sidebar-width'
  const LOGS_SIDEBAR_MIN_WIDTH = 220
  const LOGS_SIDEBAR_MAX_WIDTH = 560

  const safeJsonParse = (value) => {
    try {
      return JSON.parse(value)
    } catch (_) {
      return null
    }
  }

  class LogsZipControls {
    constructor(options) {
      this.button = options.button
      this.downloadLink = options.downloadLink
      this.statusEl = options.status
      this.defaultLabel = this.button ? this.button.innerHTML : ''
      this.endpoint = options.endpoint || '/pinokio/log'
      this.defaultDownloadHref = options.defaultDownloadHref || (this.downloadLink ? this.downloadLink.getAttribute('href') || '/pinokio/logs.zip' : '/pinokio/logs.zip')
      if (this.button) {
        this.button.addEventListener('click', () => this.generate())
      }
    }
    updateDownloadLink(href) {
      const targetHref = typeof href === 'string' && href.length > 0 ? href : this.defaultDownloadHref
      this.defaultDownloadHref = targetHref
      if (this.downloadLink) {
        this.downloadLink.href = targetHref
        this.downloadLink.classList.remove('hidden')
      }
    }
    setStatus(message, isError) {
      if (!this.statusEl) return
      this.statusEl.textContent = message || ''
      this.statusEl.classList.toggle('is-error', Boolean(isError))
    }
    setBusy(isBusy) {
      if (!this.button) return
      if (isBusy) {
        this.button.disabled = true
        this.button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Generating…</span>'
      } else {
        this.button.disabled = false
        this.button.innerHTML = this.defaultLabel
      }
    }
    async generate() {
      this.setBusy(true)
      this.setStatus('Generating archive…')
      try {
        const response = await fetch(this.endpoint, { method: 'POST' })
        if (!response.ok) {
          throw new Error(`Failed (${response.status})`)
        }
        const payload = await response.json().catch(() => ({}))
        const downloadHref = payload && payload.download ? payload.download : this.defaultDownloadHref
        this.updateDownloadLink(downloadHref)
        this.setStatus('Archive ready. Click download.')
      } catch (error) {
        this.setStatus(error.message || 'Failed to generate archive.', true)
      } finally {
        this.setBusy(false)
      }
    }
  }

  class LogsViewer {
    constructor(options) {
      this.outputEl = options.outputEl
      this.statusEl = options.statusEl
      this.pathEl = options.pathEl
      this.clearButton = options.clearButton
      this.autoScrollInput = options.autoScrollInput
      this.rootDisplay = options.rootDisplay || ''
      this.workspace = options.workspace || ''
      this.currentSource = null
      this.currentPath = ''
      if (this.clearButton) {
        this.clearButton.addEventListener('click', () => {
          this.outputEl.textContent = ''
          this.setStatus('Cleared. Waiting for new data…')
        })
      }
      window.addEventListener('beforeunload', () => this.stop())
    }
    buildDisplayPath(relativePath) {
      if (!this.rootDisplay) {
        return relativePath || ''
      }
      if (!relativePath) {
        return this.rootDisplay
      }
      const base = this.rootDisplay.endsWith('/') ? this.rootDisplay.slice(0, -1) : this.rootDisplay
      return `${base}/${relativePath}`
    }
    setStatus(message) {
      if (this.statusEl) {
        this.statusEl.textContent = message || ''
      }
    }
    updatePath(relativePath) {
      if (this.pathEl) {
        this.pathEl.textContent = relativePath ? this.buildDisplayPath(relativePath) : this.rootDisplay || ''
      }
    }
    shouldAutoScroll() {
      if (!this.autoScrollInput || this.autoScrollInput.checked) {
        if (!this.outputEl) return false
        const threshold = 40
        return (this.outputEl.scrollHeight - this.outputEl.clientHeight - this.outputEl.scrollTop) < threshold
      }
      return false
    }
    scrollToBottom() {
      if (this.outputEl) {
        this.outputEl.scrollTop = this.outputEl.scrollHeight
      }
    }
    trimBuffer() {
      if (!this.outputEl) return
      const text = this.outputEl.textContent || ''
      if (text.length > MAX_VIEWER_CHARS) {
        // Preserve the user's scroll position while trimming large buffers
        const distanceFromBottom = Math.max(
          0,
          this.outputEl.scrollHeight - this.outputEl.clientHeight - this.outputEl.scrollTop
        )
        this.outputEl.textContent = text.slice(text.length - MAX_VIEWER_CHARS)
        const nextScrollTop = Math.max(
          0,
          this.outputEl.scrollHeight - this.outputEl.clientHeight - distanceFromBottom
        )
        this.outputEl.scrollTop = nextScrollTop
      }
    }
    appendChunk(chunk) {
      if (!this.outputEl) return
      const stick = this.shouldAutoScroll()
      this.outputEl.append(document.createTextNode(chunk))
      this.trimBuffer()
      if (stick) {
        this.scrollToBottom()
      }
    }
    stop() {
      if (this.currentSource) {
        this.currentSource.close()
        this.currentSource = null
      }
    }
    open(entry) {
      if (!entry || !entry.path) {
        return
      }
      if (entry.path === this.currentPath) {
        return
      }
      this.stop()
      this.currentPath = entry.path
      if (this.outputEl) {
        this.outputEl.textContent = ''
      }
      if (this.clearButton) {
        this.clearButton.disabled = false
      }
      this.updatePath(entry.path)
      this.setStatus('Connecting…')
      if (typeof EventSource === 'undefined') {
        this.setStatus('EventSource is not supported in this browser.')
        return
      }
      const url = new URL('/api/logs/stream', window.location.origin)
      url.searchParams.set('path', entry.path)
      if (this.workspace) {
        url.searchParams.set('workspace', this.workspace)
      }
      const source = new EventSource(url)
      this.currentSource = source

      source.addEventListener('snapshot', (event) => {
        const payload = safeJsonParse(event.data)
        if (payload && payload.truncated) {
          this.setStatus('Showing the latest part of this file…')
        }
      })
      source.addEventListener('ready', () => {
        this.setStatus('Streaming live output.')
      })
      source.addEventListener('chunk', (event) => {
        const payload = safeJsonParse(event.data)
        if (payload && typeof payload.data === 'string') {
          this.appendChunk(payload.data)
        }
      })
      source.addEventListener('reset', () => {
        if (this.outputEl) {
          this.outputEl.textContent = ''
        }
        this.setStatus('File truncated. Restarting stream…')
      })
      source.addEventListener('rotate', (event) => {
        const payload = safeJsonParse(event.data)
        this.setStatus((payload && payload.message) || 'File rotated. Stream closed.')
        this.stop()
      })
      source.addEventListener('server-error', (event) => {
        const payload = safeJsonParse(event.data)
        this.setStatus((payload && payload.message) || 'Streaming error.')
      })
      source.onerror = () => {
        if (!this.currentSource) {
          return
        }
        if (this.currentSource.readyState === EventSource.CLOSED) {
          this.setStatus('Stream closed.')
        } else {
          this.setStatus('Connection lost. Reconnecting…')
        }
      }
    }
  }

  class LogsTree {
    constructor(options) {
      this.container = options.container
      this.rootLabel = options.rootLabel || 'logs'
      this.onFileSelected = options.onFileSelected
      this.fileButtons = new Map()
      this.nodes = new Map()
      this.workspace = options.workspace || ''
      if (this.container) {
        this.renderRoot()
      }
    }
    async renderRoot() {
      if (!this.container) return
      this.container.innerHTML = ''
      const rootNode = this.createBranch({ name: this.rootLabel, path: '' }, 0)
      rootNode.details.setAttribute('open', 'open')
      this.container.appendChild(rootNode.details)
      await this.populateChildren(rootNode)
    }
    async refresh() {
      this.fileButtons.clear()
      this.nodes.clear()
      await this.renderRoot()
    }
    createBranch(entry, depth) {
      const details = document.createElement('details')
      details.className = 'logs-branch'
      if (depth === 0) {
        details.open = true
      }
      const summary = document.createElement('summary')
      summary.className = 'logs-branch-summary'
      summary.innerHTML = `
        <span class="logs-branch-chevron"><i class="fa-solid fa-chevron-right"></i></span>
        <span class="logs-branch-icon"><i class="fa-solid fa-folder"></i></span>
        <span class="logs-branch-label">${entry.name || this.rootLabel}</span>
      `
      details.appendChild(summary)
      const children = document.createElement('div')
      children.className = 'logs-children'
      details.appendChild(children)
      const node = { entry, details, children, loaded: false, depth }
      details.addEventListener('toggle', () => {
        details.classList.toggle('is-open', details.open)
        if (details.open) {
          this.populateChildren(node)
        }
      })
      this.nodes.set(entry.path || '__root__', node)
      return node
    }
    buildMessage(text, variant) {
      const div = document.createElement('div')
      div.className = 'logs-tree-message'
      if (variant === 'error') {
        div.classList.add('is-error')
      }
      div.textContent = text
      return div
    }
    formatSize(bytes) {
      if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
        return ''
      }
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let size = bytes
      let unit = 0
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit += 1
      }
      return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
    }
    createFile(entry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'logs-file'
      button.dataset.path = entry.path || ''
      const sizeLabel = entry.size != null ? `<span class="logs-file-meta">${this.formatSize(entry.size)}</span>` : ''
      button.innerHTML = `
        <span class="logs-file-icon"><i class="fa-regular fa-file-lines"></i></span>
        <span class="logs-file-label">${entry.name}</span>
        ${sizeLabel}
      `
      button.addEventListener('click', () => {
        this.setActiveFile(entry.path || '')
        if (typeof this.onFileSelected === 'function') {
          this.onFileSelected(entry)
        }
      })
      this.fileButtons.set(entry.path || '', button)
      return button
    }
    setActiveFile(path) {
      if (!path) {
        return
      }
      this.fileButtons.forEach((btn, btnPath) => {
        if (btnPath === path) {
          btn.classList.add('is-active')
          btn.scrollIntoView({ block: 'nearest' })
        } else {
          btn.classList.remove('is-active')
        }
      })
    }
    async populateChildren(node) {
      if (node.loaded || node.loading) {
        return
      }
      node.loading = true
      node.children.innerHTML = ''
      node.children.appendChild(this.buildMessage('Loading…'))
      try {
        const payload = await this.fetchChildren(node.entry.path || '')
        node.children.innerHTML = ''
        if (!payload.entries || payload.entries.length === 0) {
          node.children.appendChild(this.buildMessage('Empty folder'))
        } else {
          const directories = payload.entries.filter((entry) => entry.type === 'directory')
          const files = payload.entries.filter((entry) => entry.type !== 'directory')
          directories.forEach((entry) => {
            const child = this.createBranch(entry, (node.depth || 0) + 1)
            node.children.appendChild(child.details)
          })
          files.forEach((entry) => {
            node.children.appendChild(this.createFile(entry))
          })
        }
        node.loaded = true
      } catch (error) {
        node.children.innerHTML = ''
        node.children.appendChild(this.buildMessage(error.message || 'Failed to load folder', 'error'))
      } finally {
        node.loading = false
      }
    }
    async fetchChildren(pathValue) {
      const url = new URL('/api/logs/tree', window.location.origin)
      if (pathValue) {
        url.searchParams.set('path', pathValue)
      }
      if (this.workspace) {
        url.searchParams.set('workspace', this.workspace)
      }
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `HTTP ${response.status}`)
      }
      return response.json()
    }
  }

  class LogsPage {
    constructor(config) {
      this.rootElement = config.rootElement || document.getElementById('logs-root')
      this.rootDisplay = config.rootDisplay || ''
      this.workspace = typeof config.workspace === 'string' ? config.workspace.trim() : ''
      this.workspaceTitle = config.workspaceTitle || ''
      this.boundApplyHeight = null
      this.boundBeforeUnload = null
      this.headerObserver = null
      this.storageListener = null
      this.sidebarCollapsed = false
      this.sidebarElement = this.rootElement ? this.rootElement.querySelector('.logs-sidebar') : null
      this.resizer = document.getElementById('logs-resizer')
      this.sidebarToggle = this.resizer ? this.resizer.querySelector('.logs-resizer-toggle') : null
      this.sidebarWidth = null
      this.isResizing = false
      this.pointerId = null
      this.resizeState = null
      this.sidebarPreferenceKey = this.workspace ? `${LOGS_SIDEBAR_STORAGE_KEY}:${this.workspace}` : LOGS_SIDEBAR_STORAGE_KEY
      this.sidebarWidthKey = this.workspace ? `${LOGS_SIDEBAR_WIDTH_KEY}:${this.workspace}` : LOGS_SIDEBAR_WIDTH_KEY
      const downloadHref = config.downloadUrl || (this.workspace ? `/pinokio/logs.zip?workspace=${encodeURIComponent(this.workspace)}` : '/pinokio/logs.zip')
      const zipEndpoint = this.workspace ? `/pinokio/log?workspace=${encodeURIComponent(this.workspace)}` : '/pinokio/log'
      const zipControls = new LogsZipControls({
        button: document.getElementById('logs-generate-archive'),
        downloadLink: document.getElementById('logs-download-archive'),
        status: document.getElementById('logs-zip-status'),
        endpoint: zipEndpoint,
        defaultDownloadHref: downloadHref
      })
      this.zipControls = zipControls
      this.viewer = new LogsViewer({
        outputEl: document.getElementById('logs-viewer-output'),
        statusEl: document.getElementById('logs-viewer-status'),
        pathEl: document.getElementById('logs-viewer-path'),
        clearButton: document.getElementById('logs-clear-viewer'),
        autoScrollInput: document.getElementById('logs-autoscroll'),
        rootDisplay: this.rootDisplay,
        workspace: this.workspace
      })
      this.tree = new LogsTree({
        container: document.getElementById('logs-tree'),
        rootLabel: this.rootDisplay || 'logs',
        onFileSelected: (entry) => this.viewer.open(entry),
        workspace: this.workspace
      })
      const refreshBtn = document.getElementById('logs-refresh-tree')
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.disabled = true
          refreshBtn.classList.add('is-busy')
          try {
            await this.tree.refresh()
            this.viewer.setStatus('Tree refreshed.')
          } catch (error) {
            this.viewer.setStatus(error.message || 'Failed to refresh tree.')
          } finally {
            refreshBtn.disabled = false
            refreshBtn.classList.remove('is-busy')
          }
        })
      }
      this.initSidebarWidth()
      this.initSidebarToggle()
      this.initSidebarResizer()
      this.setupPaneHeightManagement()
    }

    initSidebarWidth() {
      if (!this.rootElement) {
        return
      }
      const stored = this.readSidebarWidth()
      const baseValue = typeof stored === 'number' ? stored : parseInt(getComputedStyle(this.rootElement).getPropertyValue('--logs-sidebar-width'), 10) || 320
      this.applySidebarWidth(baseValue, false)
    }

    initSidebarToggle() {
      if (!this.rootElement) {
        return
      }
      const stored = this.readSidebarPreference()
      if (typeof stored === 'boolean') {
        this.applySidebarCollapsed(stored)
      } else {
        this.applySidebarCollapsed(false)
      }
      if (this.sidebarToggle) {
        this.sidebarToggle.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const nextState = !this.sidebarCollapsed
          this.applySidebarCollapsed(nextState)
          this.persistSidebarPreference(nextState)
        })
      }
      this.storageListener = (event) => {
        if (event.key === this.sidebarPreferenceKey) {
          const next = event.newValue === '1'
          if (next !== this.sidebarCollapsed) {
            this.applySidebarCollapsed(next)
          }
        }
      }
      window.addEventListener('storage', this.storageListener)
    }

    initSidebarResizer() {
      if (!this.resizer || !this.sidebarElement || !this.rootElement) {
        return
      }
      this.resizer.addEventListener('pointerdown', (event) => {
        if (event.target && event.target.closest('.logs-resizer-toggle')) {
          return
        }
        if (event.button !== 0 && event.pointerType !== 'touch') {
          return
        }
        event.preventDefault()
        this.isResizing = true
        this.pointerId = event.pointerId
        try {
          this.resizer.setPointerCapture(event.pointerId)
        } catch (_) {}
        const sidebarRect = this.sidebarElement.getBoundingClientRect()
        this.resizeState = {
          left: sidebarRect.left,
          offset: event.clientX - (sidebarRect.left + sidebarRect.width)
        }
        this.bindResizeListeners()
      })

      this.resizer.addEventListener('dblclick', (event) => {
        event.preventDefault()
        this.applySidebarWidth(320, true)
      })
    }

    bindResizeListeners() {
      if (!this.handlePointerMove) {
        this.handlePointerMove = (event) => {
          if (!this.isResizing) {
            return
          }
          if (this.pointerId != null && event.pointerId !== this.pointerId) {
            return
          }
          event.preventDefault()
          const state = this.resizeState || {}
          const baseLeft = typeof state.left === 'number' ? state.left : this.rootElement.getBoundingClientRect().left
          const offset = typeof state.offset === 'number' ? state.offset : 0
          const nextWidth = event.clientX - baseLeft - offset
          this.applySidebarWidth(nextWidth, false)
        }
      }
      if (!this.handlePointerUp) {
        this.handlePointerUp = (event) => {
          if (this.pointerId != null && event.pointerId !== this.pointerId) {
            return
          }
          this.finishResizing()
        }
      }
      window.addEventListener('pointermove', this.handlePointerMove)
      window.addEventListener('pointerup', this.handlePointerUp, { once: true })
    }

    finishResizing() {
      if (!this.isResizing) {
        return
      }
      this.isResizing = false
      if (this.pointerId != null && this.resizer) {
        try {
          this.resizer.releasePointerCapture(this.pointerId)
        } catch (_) {}
      }
      this.pointerId = null
      this.resizeState = null
      window.removeEventListener('pointermove', this.handlePointerMove)
      window.removeEventListener('pointerup', this.handlePointerUp)
      if (this.sidebarWidth != null) {
        this.persistSidebarWidth(this.sidebarWidth)
      }
    }

    readSidebarPreference() {
      try {
        const storedValue = window.localStorage.getItem(this.sidebarPreferenceKey)
        if (storedValue === null) {
          return null
        }
        return storedValue === '1'
      } catch (error) {
        return null
      }
    }

    readSidebarWidth() {
      try {
        const storedValue = window.localStorage.getItem(this.sidebarWidthKey)
        if (!storedValue) {
          return null
        }
        const width = parseInt(storedValue, 10)
        if (Number.isNaN(width)) {
          return null
        }
        return width
      } catch (error) {
        return null
      }
    }

    persistSidebarWidth(width) {
      try {
        window.localStorage.setItem(this.sidebarWidthKey, String(width))
      } catch (error) {
        /* ignore */
      }
    }

    persistSidebarPreference(collapsed) {
      try {
        window.localStorage.setItem(this.sidebarPreferenceKey, collapsed ? '1' : '0')
      } catch (error) {
        /* ignore */
      }
    }

    clampSidebarWidth(value) {
      const numeric = typeof value === 'number' ? value : parseInt(value, 10)
      if (Number.isNaN(numeric)) {
        return 320
      }
      return Math.min(Math.max(numeric, LOGS_SIDEBAR_MIN_WIDTH), LOGS_SIDEBAR_MAX_WIDTH)
    }

    applySidebarWidth(value, persist = false) {
      if (!this.rootElement) {
        return
      }
      const width = this.clampSidebarWidth(value)
      this.sidebarWidth = width
      this.rootElement.style.setProperty('--logs-sidebar-width', `${width}px`)
      if (this.resizer) {
        this.resizer.setAttribute('aria-valuenow', String(width))
      }
      if (persist) {
        this.persistSidebarWidth(width)
      }
    }

    applySidebarCollapsed(collapsed) {
      this.sidebarCollapsed = collapsed
      if (this.rootElement) {
        this.rootElement.classList.toggle('logs-sidebar-collapsed', collapsed)
      }
      if (this.sidebarElement) {
        if (collapsed) {
          this.sidebarElement.setAttribute('aria-hidden', 'true')
        } else {
          this.sidebarElement.removeAttribute('aria-hidden')
        }
      }
      if (this.resizer) {
        if (collapsed) {
          this.finishResizing()
        }
        this.resizer.removeAttribute('aria-hidden')
        this.resizer.tabIndex = 0
      }
      if (!this.sidebarToggle) {
        return
      }
      const label = collapsed ? 'Expand log navigation' : 'Collapse log navigation'
      this.sidebarToggle.setAttribute('aria-label', label)
      this.sidebarToggle.setAttribute('aria-expanded', String(!collapsed))
      this.sidebarToggle.title = label
    }

    setupPaneHeightManagement() {
      if (!this.rootElement) {
        return
      }
      const apply = () => this.applyPaneHeight()
      this.boundApplyHeight = apply
      window.addEventListener('resize', apply)
      window.addEventListener('orientationchange', apply)
      if (window.ResizeObserver) {
        const header = document.querySelector('header.navheader')
        if (header) {
          this.headerObserver = new ResizeObserver(apply)
          this.headerObserver.observe(header)
        }
      }
      this.boundBeforeUnload = () => this.dispose()
      window.addEventListener('beforeunload', this.boundBeforeUnload)
      this.applyPaneHeight()
      requestAnimationFrame(apply)
    }

    applyPaneHeight() {
      if (!this.rootElement) {
        return
      }
      const rect = this.rootElement.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
      const padding = 16
      const available = Math.max(0, viewportHeight - rect.top - padding)
      const fallback = Math.max(320, Math.round(viewportHeight * 0.6))
      const target = available > 0 ? available : fallback
      this.rootElement.style.setProperty('--logs-pane-height', `${target}px`)
    }

    dispose() {
      if (this.headerObserver) {
        this.headerObserver.disconnect()
        this.headerObserver = null
      }
      if (this.boundApplyHeight) {
        window.removeEventListener('resize', this.boundApplyHeight)
        window.removeEventListener('orientationchange', this.boundApplyHeight)
        this.boundApplyHeight = null
      }
      if (this.boundBeforeUnload) {
        window.removeEventListener('beforeunload', this.boundBeforeUnload)
        this.boundBeforeUnload = null
      }
      if (this.storageListener) {
        window.removeEventListener('storage', this.storageListener)
        this.storageListener = null
      }
      this.finishResizing()
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('logs-root')
    if (!root) return
    const config = Object.assign({}, window.LOGS_PAGE_DATA || {}, { rootElement: root })
    root.dataset.initialized = 'true'
    new LogsPage(config)
  })
})()
