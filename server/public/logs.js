(function() {
  const MAX_VIEWER_CHARS = 2 * 1024 * 1024
  const LOGS_SIDEBAR_STORAGE_KEY = 'pinokio.logs.sidebar-collapsed'
  const LOGS_SIDEBAR_WIDTH_KEY = 'pinokio.logs.sidebar-width'
  const LOGS_SIDEBAR_MIN_WIDTH = 220
  const LOGS_SIDEBAR_MAX_WIDTH = 560
  const DRAFT_BODY_TARGET_BYTES = 750 * 1024
  const DRAFT_IMPORT_FIELD_LIMIT_BYTES = 1024 * 1024
  const DRAFT_TITLE_MAX_LENGTH = 120
  const DRAFT_TITLE_DISPLAY_LENGTH = 96
  const DRAFT_TITLE_RECENT_WINDOW_MS = 48 * 60 * 60 * 1000
  const DRAFT_SECTION_MODES = [
    { value: 'full', label: 'Full section' },
    { value: 'last-2000', label: 'Last 2000 lines', lines: 2000 },
    { value: 'last-1000', label: 'Last 1000 lines', lines: 1000 },
    { value: 'last-500', label: 'Last 500 lines', lines: 500 },
    { value: 'exclude', label: 'Exclude' }
  ]
  const DRAFT_TITLE_FAILURE_PATTERN = /\b(?:error|exception|failed|failure|fatal|cannot|can't|can not|not found|denied|timeout|timed out|refused|unavailable|invalid|missing|abort|aborted|panic|overflow|crash|crashed)\b/i
  const DRAFT_TITLE_STRONG_PATTERN = /\b(?:[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)|ERROR|FATAL|ERR!|exit code\s+\d+)\b/i
  const DRAFT_TITLE_STACK_PATTERN = /^\s*(?:File\s+"[^"]+",\s+line\s+\d+|at\s+\S+|from\s+\S+\s+import\s+|return\s+|await\s+|sys\.exit\b)/i
  const DRAFT_TITLE_NOISE_PATTERN = /^\s*(?:<<PINOKIO_SHELL>>|={6,}|-{6,}|\[api\s+local\.set\]|The default interactive shell is now|To update your account|For more details, please visit)/i
  const ASK_AI_DEFAULT_PROMPT = 'Investigate what went wrong. Inspect the app logs and explain the likely root cause and next fix.'
  const TOOL_PREFERENCE_KEY = 'pinokio.universalLauncher.tool'
  const ASK_AI_TOOL_CATEGORY_ORDER = ['Terminal', 'Desktop']
  const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null

  const safeJsonParse = (value) => {
    try {
      return JSON.parse(value)
    } catch (_) {
      return null
    }
  }

  const humanBytes = (value) => {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = Number(value) || 0
    let index = 0
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024
      index += 1
    }
    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }

  const textByteLength = (value) => {
    const text = String(value || '')
    if (textEncoder) {
      return textEncoder.encode(text).length
    }
    return unescape(encodeURIComponent(text)).length
  }

  const withQueryParam = (href, key, value) => {
    try {
      const url = new URL(href, window.location.origin)
      url.searchParams.set(key, value)
      return `${url.pathname}${url.search}${url.hash}`
    } catch (_) {
      return href
    }
  }

  const isPluginLauncherPath = (pathname) => {
    return typeof pathname === 'string'
      && (
        pathname.startsWith('/run/plugin/')
        || pathname.startsWith('/pinokio/run/plugin/')
        || (pathname.startsWith('/run/api/') && /\/pinokio\.js$/i.test(pathname))
      )
  }

  const pluginToolCategory = (plugin) => {
    const explicitCategory = typeof plugin?.category === 'string' ? plugin.category.trim().toLowerCase() : ''
    if (explicitCategory === 'ide') return 'Desktop'
    if (explicitCategory === 'cli') return 'Terminal'
    const launchType = typeof plugin?.launch_type === 'string' ? plugin.launch_type.trim().toLowerCase() : ''
    if (launchType === 'desktop') return 'Desktop'
    if (launchType === 'terminal') return 'Terminal'
    return plugin && plugin.categoryTitle ? String(plugin.categoryTitle) : 'Plugin'
  }

  const pluginToolValue = (href) => {
    const normalized = String(href || '').replace(/^\/run/, '').replace(/^\/+/, '')
    const parts = normalized.split('/').filter(Boolean)
    let value = ''
    if (parts[0] === 'plugin' && parts.length >= 3) {
      value = parts.slice(1, -1).join('/')
    } else {
      value = normalized
    }
    if (value.endsWith('/pinokio.js')) {
      value = value.replace(/\/pinokio\.js$/i, '')
    }
    return value
  }

  const getStoredToolPreference = () => {
    try {
      const value = window.localStorage.getItem(TOOL_PREFERENCE_KEY)
      return typeof value === 'string' ? value.trim() : ''
    } catch (_) {
      return ''
    }
  }

  const setStoredToolPreference = (value) => {
    try {
      const normalized = typeof value === 'string' ? value.trim() : ''
      if (normalized) {
        window.localStorage.setItem(TOOL_PREFERENCE_KEY, normalized)
      } else {
        window.localStorage.removeItem(TOOL_PREFERENCE_KEY)
      }
    } catch (_) {}
  }

  const mapPluginMenuToAskAiTools = (menu) => {
    if (!Array.isArray(menu)) {
      return []
    }
    return menu.map((plugin) => {
      if (!plugin || typeof plugin !== 'object') {
        return null
      }
      const href = typeof plugin.href === 'string' ? plugin.href.trim() : ''
      if (!href) {
        return null
      }
      let parsed
      try {
        parsed = new URL(href, window.location.origin)
      } catch (_) {
        return null
      }
      if (parsed.origin !== window.location.origin || !isPluginLauncherPath(parsed.pathname)) {
        return null
      }
      const label = typeof plugin.title === 'string' && plugin.title.trim()
        ? plugin.title.trim()
        : (typeof plugin.text === 'string' && plugin.text.trim() ? plugin.text.trim() : href)
      return {
        href,
        value: pluginToolValue(href),
        label,
        category: pluginToolCategory(plugin),
        iconSrc: typeof plugin.image === 'string' ? plugin.image : (typeof plugin.icon === 'string' ? plugin.icon : ''),
        pluginPath: typeof plugin.pluginPath === 'string' ? plugin.pluginPath : '',
        detailUrl: typeof plugin.detailUrl === 'string' ? plugin.detailUrl : '',
        hasInstall: plugin.hasInstall === true,
        hasInstalledCheck: plugin.hasInstalledCheck === true,
        installed: typeof plugin.installed === 'boolean' ? plugin.installed : null
      }
    }).filter(Boolean).sort((a, b) => {
      const categoryDelta = askAiToolCategoryRank(a.category) - askAiToolCategoryRank(b.category)
      if (categoryDelta !== 0) return categoryDelta
      const categoryNameDelta = String(a.category || '').localeCompare(String(b.category || ''), undefined, { sensitivity: 'base' })
      if (categoryNameDelta !== 0) return categoryNameDelta
      return String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' })
    })
  }

  const askAiToolOptionLabel = (tool) => {
    const label = String(tool?.label || '').trim()
    const category = String(tool?.category || '').trim()
    if (!category) {
      return label
    }
    if (label.toLowerCase().includes(category.toLowerCase())) {
      return label
    }
    return `${label} (${category})`
  }

  const askAiToolCategoryRank = (category) => {
    const normalized = String(category || '').trim().toLowerCase()
    const index = ASK_AI_TOOL_CATEGORY_ORDER.findIndex((item) => item.toLowerCase() === normalized)
    return index >= 0 ? index : ASK_AI_TOOL_CATEGORY_ORDER.length
  }

  class PrivacyFilterClient {
    constructor() {
      this.worker = null
      this.nextId = 1
      this.pending = new Map()
      this.runtimePromise = null
    }
    getWorker() {
      if (this.worker) {
        return this.worker
      }
      try {
        this.worker = new Worker('/privacy_filter_worker.js', { type: 'module' })
      } catch (_) {
        this.worker = new Worker('/privacy_filter_worker.js')
      }
      this.worker.addEventListener('message', (event) => this.handleMessage(event.data || {}))
      this.worker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'Privacy filter worker failed.')
        for (const pending of this.pending.values()) {
          pending.reject(error)
        }
        this.pending.clear()
        this.worker = null
      })
      return this.worker
    }
    handleMessage(message) {
      if (message.type === 'download') {
        for (const pending of this.pending.values()) {
          pending.onProgress(message)
        }
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }
      if (message.type === 'chunk') {
        pending.onProgress(message)
      } else if (message.type === 'fallback') {
        pending.onProgress(message)
      } else if (message.type === 'result') {
        this.pending.delete(message.id)
        pending.resolve(message)
      } else if (message.type === 'error') {
        this.pending.delete(message.id)
        pending.reject(new Error(message.message || 'Privacy filter failed.'))
      }
    }
    detectRuntime() {
      if (this.runtimePromise) {
        return this.runtimePromise
      }
      this.runtimePromise = (async () => {
        try {
          if (navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
            const adapter = await navigator.gpu.requestAdapter()
            if (adapter) {
              return {
                device: 'webgpu',
                dtype: adapter.features && adapter.features.has('shader-f16') ? 'q4f16' : 'q4'
              }
            }
          }
        } catch (_) {}
        return { device: 'wasm', dtype: 'q8' }
      })()
      return this.runtimePromise
    }
    async filter(text, onProgress) {
      const runtime = await this.detectRuntime()
      const id = this.nextId
      this.nextId += 1
      const worker = this.getWorker()
      if (typeof onProgress === 'function') {
        onProgress({ type: 'runtime', ...runtime })
      }
      return new Promise((resolve, reject) => {
        this.pending.set(id, {
          resolve,
          reject,
          onProgress: typeof onProgress === 'function' ? onProgress : () => {}
        })
        worker.postMessage({
          type: 'filter',
          id,
          text,
          device: runtime.device,
          dtype: runtime.dtype
        })
      })
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

  class LogsSessionReport {
    constructor(options) {
      this.reportUrl = options.reportUrl || ''
      this.draftUrl = options.draftUrl || ''
      this.registryBase = options.registryBase || 'https://pinokio.co'
      this.statusEl = options.statusEl
      this.outputEl = options.outputEl
      this.copyButton = options.copyButton
      this.askAiButton = options.askAiButton
      this.createDraftButton = options.createDraftButton
      this.draftTitleInput = options.draftTitleInput
      this.draftTitleNoteEl = options.draftTitleNoteEl
      this.runFilterButton = options.runFilterButton
      this.refreshButton = options.refreshButton
      this.reportFilesEl = options.reportFilesEl
      this.reportGeneratedEl = options.reportGeneratedEl
      this.reportSectionsEl = options.reportSectionsEl
      this.sessionPickerEl = options.sessionPickerEl
      this.sessionSelectEl = options.sessionSelectEl
      this.draftSizeBadgeEl = options.draftSizeBadgeEl
      this.draftMeterFillEl = options.draftMeterFillEl
      this.draftStatusEl = options.draftStatusEl
      this.reviewListEl = options.reviewListEl
      this.reviewFiltersEl = options.reviewFiltersEl
      this.reviewCountEl = options.reviewCountEl
      this.workspace = typeof options.workspace === 'string' ? options.workspace.trim() : ''
      this.workspaceCwd = typeof options.workspaceCwd === 'string' ? options.workspaceCwd.trim() : ''
      this.privacyFilter = options.privacyFilter || new PrivacyFilterClient()
      this.askAiTools = null
      this.askAiToolsPromise = null
      this.askAiLauncher = null
      this.report = null
      this.rawMarkdown = ''
      this.reviewMarkdown = ''
      this.currentMarkdown = ''
      this.sectionModes = new Map()
      this.draftBodyBytes = 0
      this.draftPayloadBytes = 0
      this.draftOversized = false
      this.importingDraft = false
      this.draftTitleEdited = false
      this.draftTitleSuggestion = null
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.filterChunks = 0
      this.redactionHasRun = false
      this.filtering = false
      this.activeRedactionFilter = 'all'
      this.selectedRedactionId = null
      this.filterToken = 0
      this.loading = false
      this.selectedSession = ''
      this.latestSession = ''

      if (this.copyButton) {
        this.copyButton.addEventListener('click', () => this.copy())
      }
      if (this.askAiButton) {
        this.askAiButton.addEventListener('click', () => this.openAskAiModal())
      }
      if (this.createDraftButton) {
        this.createDraftButton.addEventListener('click', () => this.createDraft())
      }
      if (this.draftTitleInput) {
        this.draftTitleInput.addEventListener('input', () => {
          this.draftTitleEdited = true
          this.updateDraftTitleNote()
          this.updateDraftSizeReview()
        })
      }
      if (this.runFilterButton) {
        this.runFilterButton.addEventListener('click', () => this.filterReport())
      }
      if (this.refreshButton) {
        this.refreshButton.addEventListener('click', () => this.load(true))
      }
      if (this.sessionSelectEl) {
        this.sessionSelectEl.addEventListener('change', () => {
          const value = this.sessionSelectEl.value || ''
          this.selectedSession = value && value !== this.latestSession ? value : ''
          this.report = null
          this.sectionModes.clear()
          this.load(true)
        })
      }
    }
    setStatus(message, isError) {
      if (!this.statusEl) return
      this.statusEl.textContent = message || ''
      this.statusEl.classList.toggle('is-error', Boolean(isError))
    }
    setBusy(isBusy) {
      if (!this.refreshButton) return
      this.refreshButton.disabled = Boolean(isBusy)
      this.refreshButton.classList.toggle('is-busy', Boolean(isBusy))
    }
    setAskAiBusy(isBusy) {
      if (!this.askAiButton) return
      if (isBusy) {
        this.askAiButton.disabled = true
        this.askAiButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Loading…</span>'
      } else {
        this.askAiButton.innerHTML = '<i class="fa-solid fa-robot"></i><span>Ask AI</span>'
        this.updateDraftSizeReview()
      }
    }
    buildAskAiMenuUrl() {
      const url = new URL('/api/plugin/menu', window.location.origin)
      if (this.workspaceCwd) {
        url.searchParams.set('workspace', this.workspaceCwd)
      }
      return `${url.pathname}${url.search}`
    }
    buildReportUrl() {
      if (!this.reportUrl) {
        return ''
      }
      try {
        const url = new URL(this.reportUrl, window.location.origin)
        url.searchParams.set('redaction', 'none')
        if (this.selectedSession) {
          url.searchParams.set('session', this.selectedSession)
        } else {
          url.searchParams.delete('session')
        }
        return `${url.pathname}${url.search}${url.hash}`
      } catch (_) {
        let href = withQueryParam(this.reportUrl, 'redaction', 'none')
        if (this.selectedSession) {
          href = withQueryParam(href, 'session', this.selectedSession)
        }
        return href
      }
    }
    async loadAskAiTools() {
      if (Array.isArray(this.askAiTools) && this.askAiTools.length > 0) {
        return this.askAiTools
      }
      if (this.askAiToolsPromise) {
        return this.askAiToolsPromise
      }
      this.askAiToolsPromise = fetch(this.buildAskAiMenuUrl(), {
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load plugins (${response.status})`)
          }
          return response.json()
        })
        .then((payload) => mapPluginMenuToAskAiTools(payload && Array.isArray(payload.menu) ? payload.menu : []))
        .finally(() => {
          this.askAiToolsPromise = null
        })
      const tools = await this.askAiToolsPromise
      this.askAiTools = tools
      return tools
    }
    buildAskAiLaunchHref(tool, prompt) {
      const href = tool && typeof tool.href === 'string' ? tool.href : ''
      if (!href) {
        return ''
      }
      try {
        const parsed = new URL(href, window.location.origin)
        if (parsed.origin !== window.location.origin || !isPluginLauncherPath(parsed.pathname)) {
          return ''
        }
        if (this.workspaceCwd && !parsed.searchParams.has('cwd')) {
          parsed.searchParams.set('cwd', this.workspaceCwd)
        }
        parsed.searchParams.set('ask_ai', '1')
        const question = String(prompt || '').trim()
        if (question) {
          parsed.searchParams.set('prompt', question)
        } else {
          parsed.searchParams.delete('prompt')
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      } catch (_) {
        return ''
      }
    }
    pluginInstallHref(tool) {
      if (!tool || tool.hasInstall !== true || tool.hasInstalledCheck !== true || tool.installed !== false) {
        return ''
      }
      const fallbackPath = tool.pluginPath || ''
      const detailUrl = tool.detailUrl || (fallbackPath ? `/plugin?path=${encodeURIComponent(fallbackPath)}` : '')
      if (!detailUrl) {
        return ''
      }
      try {
        const parsed = new URL(detailUrl, window.location.origin)
        parsed.searchParams.set('next', 'install')
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      } catch (_) {
        const separator = detailUrl.includes('?') ? '&' : '?'
        return `${detailUrl}${separator}next=install`
      }
    }
    redirectToPluginInstallIfNeeded(tool) {
      const href = this.pluginInstallHref(tool)
      if (!href) {
        return false
      }
      try {
        if (window.parent && window.parent !== window) {
          window.parent.location.href = href
          return true
        }
      } catch (_) {}
      window.location.href = href
      return true
    }
    createAskAiLaunchId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID()
        }
      } catch (_) {}
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }
    waitForAskAiLaunchAck(launchId, timeoutMs = 1500) {
      return new Promise((resolve) => {
        let settled = false
        let timer = null
        const finish = (value) => {
          if (settled) return
          settled = true
          if (timer) {
            window.clearTimeout(timer)
          }
          window.removeEventListener('message', onMessage)
          resolve(value)
        }
        const onMessage = (event) => {
          const data = event && event.data && typeof event.data === 'object' ? event.data : null
          if (!data || data.e !== 'pinokio:ask-ai-launch-result' || data.launchId !== launchId) {
            return
          }
          finish(data.opened !== false)
        }
        window.addEventListener('message', onMessage)
        timer = window.setTimeout(() => finish(false), timeoutMs)
      })
    }
    async dispatchAskAiLaunch(tool, prompt) {
      const launchHref = this.buildAskAiLaunchHref(tool, prompt)
      if (!launchHref) {
        this.setStatus('Could not launch this plugin.', true)
        return false
      }
      const payload = {
        e: 'pinokio:ask-ai-launch',
        workspace: this.workspace,
        workspaceCwd: this.workspaceCwd,
        agentHref: launchHref,
        agentLabel: tool && tool.label ? tool.label : '',
        prompt: String(prompt || '').trim()
      }
      if (window.PinokioAskAiDrawer && typeof window.PinokioAskAiDrawer.openWithUrl === 'function') {
        try {
          const opened = window.PinokioAskAiDrawer.openWithUrl(launchHref, {
            workspaceCwd: this.workspaceCwd,
            prompt: payload.prompt
          })
          if (opened !== false) {
            this.setStatus('Launching Ask AI…')
            return true
          }
        } catch (_) {}
      }
      try {
        const parentDrawer = window.parent && window.parent !== window ? window.parent.PinokioAskAiDrawer : null
        if (parentDrawer && typeof parentDrawer.openWithAgent === 'function') {
          const opened = parentDrawer.openWithAgent(payload)
          if (opened !== false) {
            this.setStatus('Launching Ask AI…')
            return true
          }
        } else if (parentDrawer && typeof parentDrawer.openWithUrl === 'function') {
          const opened = parentDrawer.openWithUrl(launchHref, {
            workspaceCwd: this.workspaceCwd,
            prompt: payload.prompt
          })
          if (opened !== false) {
            this.setStatus('Launching Ask AI…')
            return true
          }
        }
      } catch (_) {}
      try {
        if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
          const launchId = this.createAskAiLaunchId()
          payload.launchId = launchId
          const ack = this.waitForAskAiLaunchAck(launchId)
          window.parent.postMessage(payload, '*')
          const opened = await ack
          if (opened) {
            this.setStatus('Launching Ask AI…')
            return true
          }
          this.setStatus('Could not confirm Ask AI launch.', true)
          return false
        }
      } catch (_) {}
      window.location.href = launchHref
      return true
    }
    createAskAiLauncher() {
      if (this.askAiLauncher) {
        return this.askAiLauncher
      }
      const overlay = document.createElement('div')
      overlay.className = 'universal-launcher-overlay logs-ask-ai-launcher'
      overlay.hidden = true

      const panel = document.createElement('section')
      panel.className = 'universal-launcher-panel logs-ask-ai-launcher-panel'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-labelledby', 'logs-ask-ai-launcher-title')
      panel.setAttribute('aria-describedby', 'logs-ask-ai-launcher-description')
      overlay.appendChild(panel)

      const header = document.createElement('header')
      header.className = 'universal-launcher-header'
      panel.appendChild(header)

      const heading = document.createElement('div')
      heading.className = 'universal-launcher-heading'
      header.appendChild(heading)

      const titleRow = document.createElement('div')
      titleRow.className = 'universal-launcher-title-row'
      heading.appendChild(titleRow)

      const brandMark = document.createElement('span')
      brandMark.className = 'universal-launcher-brand-mark'
      brandMark.setAttribute('aria-hidden', 'true')
      titleRow.appendChild(brandMark)

      const title = document.createElement('h3')
      title.className = 'universal-launcher-title'
      title.id = 'logs-ask-ai-launcher-title'
      title.textContent = 'Ask Pinokio'
      titleRow.appendChild(title)

      const description = document.createElement('p')
      description.className = 'universal-launcher-description'
      description.id = 'logs-ask-ai-launcher-description'
      description.textContent = 'Launch a local agent with this log report open.'
      heading.appendChild(description)

      const closeButton = document.createElement('button')
      closeButton.type = 'button'
      closeButton.className = 'universal-launcher-close'
      closeButton.setAttribute('aria-label', 'Close Ask Pinokio')
      closeButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
      header.appendChild(closeButton)

      const body = document.createElement('div')
      body.className = 'universal-launcher-body logs-ask-ai-launcher-body'
      panel.appendChild(body)

      const promptSection = document.createElement('section')
      promptSection.className = 'universal-launcher-section universal-launcher-section-prompt'
      body.appendChild(promptSection)

      const promptHeading = document.createElement('div')
      promptHeading.className = 'universal-launcher-section-heading'
      promptSection.appendChild(promptHeading)

      const promptTitle = document.createElement('div')
      promptTitle.className = 'universal-launcher-section-title'
      promptTitle.textContent = 'What should Pinokio do?'
      promptHeading.appendChild(promptTitle)

      const composer = document.createElement('div')
      composer.className = 'universal-launcher-ask-composer is-ask-intent'
      promptSection.appendChild(composer)

      const promptTextarea = document.createElement('textarea')
      promptTextarea.className = 'universal-launcher-textarea logs-ask-ai-launcher-textarea'
      promptTextarea.rows = 3
      promptTextarea.setAttribute('aria-label', 'Question')
      composer.appendChild(promptTextarea)

      const error = document.createElement('div')
      error.className = 'universal-launcher-error'
      body.appendChild(error)

      const footer = document.createElement('footer')
      footer.className = 'universal-launcher-footer logs-ask-ai-launcher-footer'
      panel.appendChild(footer)

      const toolSection = document.createElement('section')
      toolSection.className = 'universal-launcher-section universal-launcher-section-tools footer-mounted logs-ask-ai-launcher-tool-section'
      footer.appendChild(toolSection)

      const toolPicker = document.createElement('div')
      toolPicker.className = 'universal-launcher-tool-picker logs-ask-ai-tool-picker'
      toolSection.appendChild(toolPicker)

      const toolTrigger = document.createElement('button')
      toolTrigger.type = 'button'
      toolTrigger.className = 'universal-launcher-tool-trigger has-value logs-ask-ai-tool-trigger'
      toolTrigger.setAttribute('aria-haspopup', 'listbox')
      toolTrigger.setAttribute('aria-expanded', 'false')
      toolPicker.appendChild(toolTrigger)

      const toolIcon = document.createElement('span')
      toolIcon.className = 'universal-launcher-tool-trigger-icon logs-ask-ai-tool-trigger-icon'
      toolTrigger.appendChild(toolIcon)

      const toolContent = document.createElement('div')
      toolContent.className = 'universal-launcher-tool-trigger-content'
      toolTrigger.appendChild(toolContent)

      const toolLabel = document.createElement('div')
      toolLabel.className = 'universal-launcher-tool-trigger-label'
      toolContent.appendChild(toolLabel)

      const toolMeta = document.createElement('div')
      toolMeta.className = 'universal-launcher-tool-trigger-meta'
      toolContent.appendChild(toolMeta)

      const toolCaret = document.createElement('i')
      toolCaret.className = 'fa-solid fa-chevron-down universal-launcher-tool-trigger-caret'
      toolCaret.setAttribute('aria-hidden', 'true')
      toolTrigger.appendChild(toolCaret)

      const toolSheetLayer = document.createElement('div')
      toolSheetLayer.className = 'universal-launcher-tool-sheet-layer logs-ask-ai-tool-sheet-layer'
      toolSheetLayer.hidden = true
      panel.appendChild(toolSheetLayer)

      const toolSheetBackdrop = document.createElement('button')
      toolSheetBackdrop.type = 'button'
      toolSheetBackdrop.className = 'universal-launcher-tool-sheet-backdrop'
      toolSheetBackdrop.setAttribute('aria-label', 'Close agent selection')
      toolSheetLayer.appendChild(toolSheetBackdrop)

      const toolSheet = document.createElement('section')
      toolSheet.className = 'universal-launcher-tool-sheet logs-ask-ai-tool-sheet'
      toolSheet.setAttribute('aria-label', 'Choose agent')
      toolSheetLayer.appendChild(toolSheet)

      const toolSheetHeader = document.createElement('div')
      toolSheetHeader.className = 'universal-launcher-tool-sheet-header'
      toolSheet.appendChild(toolSheetHeader)

      const toolSheetHeading = document.createElement('div')
      toolSheetHeading.className = 'universal-launcher-tool-sheet-heading'
      toolSheetHeader.appendChild(toolSheetHeading)

      const toolSheetTitle = document.createElement('div')
      toolSheetTitle.className = 'universal-launcher-tool-sheet-title'
      toolSheetTitle.textContent = 'Choose agent'
      toolSheetHeading.appendChild(toolSheetTitle)

      const toolSheetDescription = document.createElement('div')
      toolSheetDescription.className = 'universal-launcher-tool-sheet-description'
      toolSheetDescription.textContent = 'Launch this report with a local agent.'
      toolSheetHeading.appendChild(toolSheetDescription)

      const toolSheetClose = document.createElement('button')
      toolSheetClose.type = 'button'
      toolSheetClose.className = 'universal-launcher-tool-sheet-close'
      toolSheetClose.setAttribute('aria-label', 'Close agent selection')
      toolSheetClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
      toolSheetHeader.appendChild(toolSheetClose)

      const toolSheetBody = document.createElement('div')
      toolSheetBody.className = 'universal-launcher-tool-sheet-body logs-ask-ai-tool-sheet-body'
      toolSheetBody.setAttribute('role', 'listbox')
      toolSheet.appendChild(toolSheetBody)

      const footerActions = document.createElement('div')
      footerActions.className = 'universal-launcher-footer-actions'
      footer.appendChild(footerActions)

      const runButton = document.createElement('button')
      runButton.type = 'button'
      runButton.className = 'universal-launcher-button universal-launcher-button-primary'
      runButton.textContent = 'Run'
      footerActions.appendChild(runButton)

      let returnFocusEl = null
      let toolSheetOpen = false
      const closeToolSheet = (options = {}) => {
        toolSheetOpen = false
        toolSheetLayer.hidden = true
        toolPicker.classList.remove('open')
        toolTrigger.setAttribute('aria-expanded', 'false')
        if (options.focusTrigger !== false) {
          toolTrigger.focus()
        }
      }
      const openToolSheet = () => {
        if (!Array.isArray(this.askAiTools) || this.askAiTools.length === 0) {
          return
        }
        toolSheetOpen = true
        toolSheetLayer.hidden = false
        toolPicker.classList.add('open')
        toolTrigger.setAttribute('aria-expanded', 'true')
        window.requestAnimationFrame(() => {
          const selected = toolSheetBody.querySelector('.universal-launcher-tool.selected')
          const first = toolSheetBody.querySelector('.universal-launcher-tool')
          const target = selected || first || toolSheetClose
          if (target && typeof target.focus === 'function') {
            target.focus()
          }
        })
      }
      const syncRunState = () => {
        runButton.disabled = !String(promptTextarea.value || '').trim() || !this.selectedAskAiTool()
      }
      const getFocusable = () => {
        const scope = toolSheetOpen ? toolSheetLayer : panel
        return Array.from(scope.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
          .filter((node) => node && !node.hidden && node.offsetParent !== null)
      }
      const setOpen = (isOpen) => {
        if (!isOpen) {
          closeToolSheet({ focusTrigger: false })
        }
        overlay.hidden = !isOpen
        document.documentElement.classList.toggle('universal-launcher-open', isOpen)
        document.body.classList.toggle('universal-launcher-open', isOpen)
        if (isOpen) {
          returnFocusEl = document.activeElement && typeof document.activeElement.focus === 'function'
            ? document.activeElement
            : this.askAiButton
          window.requestAnimationFrame(() => {
            promptTextarea.focus()
            const cursorIndex = promptTextarea.value.length
            try {
              promptTextarea.setSelectionRange(cursorIndex, cursorIndex)
            } catch (_) {}
          })
        } else if (returnFocusEl && typeof returnFocusEl.focus === 'function' && document.contains(returnFocusEl)) {
          try {
            returnFocusEl.focus()
          } catch (_) {}
          returnFocusEl = null
        }
      }
      const close = () => setOpen(false)
      const syncTool = () => {
        const tool = this.selectedAskAiTool()
        toolLabel.textContent = tool ? tool.label : 'Choose agent'
        toolMeta.textContent = tool ? (tool.category || 'Plugin') : ''
        toolTrigger.classList.toggle('has-value', Boolean(tool))
        toolTrigger.setAttribute('aria-label', tool ? `Agent: ${askAiToolOptionLabel(tool)}` : 'Choose agent')
        toolIcon.textContent = ''
        while (toolIcon.firstChild) {
          toolIcon.removeChild(toolIcon.firstChild)
        }
        if (tool && tool.iconSrc) {
          const icon = document.createElement('img')
          icon.src = tool.iconSrc
          icon.alt = ''
          icon.className = 'logs-ask-ai-tool-trigger-image'
          icon.onerror = () => {
            while (toolIcon.firstChild) {
              toolIcon.removeChild(toolIcon.firstChild)
            }
            const fallbackIcon = document.createElement('i')
            fallbackIcon.className = 'fa-solid fa-robot'
            fallbackIcon.setAttribute('aria-hidden', 'true')
            toolIcon.appendChild(fallbackIcon)
          }
          toolIcon.appendChild(icon)
        } else {
          const icon = document.createElement('i')
          icon.className = 'fa-solid fa-robot'
          icon.setAttribute('aria-hidden', 'true')
          toolIcon.appendChild(icon)
        }
        ;(this.askAiLauncher && this.askAiLauncher.toolEntries ? this.askAiLauncher.toolEntries : []).forEach((entry) => {
          const selected = Boolean(tool && entry.tool === tool)
          entry.button.classList.toggle('selected', selected)
          entry.button.setAttribute('aria-selected', selected ? 'true' : 'false')
        })
        syncRunState()
      }
      const run = async () => {
        const prompt = String(promptTextarea.value || '').trim()
        const tool = this.selectedAskAiTool()
        if (!prompt) {
          error.textContent = 'Enter a question for the agent.'
          promptTextarea.focus()
          return
        }
        if (!tool) {
          error.textContent = 'Choose an agent.'
          toolTrigger.focus()
          return
        }
        error.textContent = ''
        if (this.redirectToPluginInstallIfNeeded(tool)) {
          close()
          return
        }
        if (await this.dispatchAskAiLaunch(tool, prompt)) {
          close()
        }
      }

      closeButton.addEventListener('click', close)
      toolTrigger.addEventListener('click', () => {
        if (toolSheetOpen) {
          closeToolSheet()
        } else {
          openToolSheet()
        }
      })
      toolSheetBackdrop.addEventListener('click', () => closeToolSheet())
      toolSheetClose.addEventListener('click', () => closeToolSheet())
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          close()
        }
      })
      promptTextarea.addEventListener('input', syncRunState)
      runButton.addEventListener('click', run)
      overlay.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          if (toolSheetOpen) {
            closeToolSheet()
          } else {
            close()
          }
        } else if (event.key === 'Tab') {
          const focusable = getFocusable()
          if (focusable.length === 0) {
            event.preventDefault()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          if (!runButton.disabled) {
            run()
          }
        }
      })

      document.body.appendChild(overlay)
      this.askAiLauncher = {
        overlay,
        panel,
        promptTextarea,
        toolTrigger,
        toolSheetBody,
        toolSheetLayer,
        toolLabel,
        toolMeta,
        toolIcon,
        selectedToolIndex: -1,
        toolEntries: [],
        setToolIndex(index) {
          const nextIndex = Number.isFinite(index) ? index : -1
          this.selectedToolIndex = nextIndex
          const tool = Array.isArray(this.owner.askAiTools) ? this.owner.askAiTools[nextIndex] : null
          setStoredToolPreference(tool && tool.value ? tool.value : '')
          this.syncTool()
        },
        error,
        runButton,
        setOpen,
        closeToolSheet,
        syncTool,
        syncRunState,
        owner: this
      }
      return this.askAiLauncher
    }
    populateAskAiLauncherTools(tools) {
      const launcher = this.createAskAiLauncher()
      while (launcher.toolSheetBody.firstChild) {
        launcher.toolSheetBody.removeChild(launcher.toolSheetBody.firstChild)
      }
      launcher.toolEntries = []
      const createFallbackToolIcon = () => {
        const icon = document.createElement('span')
        icon.className = 'universal-launcher-tool-icon logs-ask-ai-tool-fallback-icon'
        icon.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i>'
        return icon
      }
      const groups = new Map()
      tools.forEach((tool, index) => {
        const category = tool && tool.category ? tool.category : 'Plugin'
        if (!groups.has(category)) {
          groups.set(category, [])
        }
        groups.get(category).push({ tool, index })
      })
      const orderedGroupCategories = []
      ASK_AI_TOOL_CATEGORY_ORDER.forEach((preferredCategory) => {
        const match = Array.from(groups.keys()).find((category) => String(category).toLowerCase() === preferredCategory.toLowerCase())
        if (match && !orderedGroupCategories.includes(match)) {
          orderedGroupCategories.push(match)
        }
      })
      Array.from(groups.keys()).sort((a, b) => {
        const rankDelta = askAiToolCategoryRank(a) - askAiToolCategoryRank(b)
        if (rankDelta !== 0) return rankDelta
        return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
      }).forEach((category) => {
        if (!orderedGroupCategories.includes(category)) {
          orderedGroupCategories.push(category)
        }
      })
      orderedGroupCategories.forEach((category) => {
        const entries = groups.get(category) || []
        const group = document.createElement('div')
        group.className = 'universal-launcher-tool-group'
        const heading = document.createElement('div')
        heading.className = 'universal-launcher-tool-group-title'
        heading.textContent = category
        group.appendChild(heading)
        const list = document.createElement('div')
        list.className = 'universal-launcher-tool-list logs-ask-ai-tool-list'
        group.appendChild(list)
        entries.forEach(({ tool, index }) => {
          const option = document.createElement('button')
          option.type = 'button'
          option.className = 'universal-launcher-tool'
          option.setAttribute('role', 'option')
          option.setAttribute('aria-selected', 'false')
          option.dataset.toolIndex = String(index)

          const indicator = document.createElement('span')
          indicator.className = 'universal-launcher-tool-indicator'
          indicator.setAttribute('aria-hidden', 'true')
          option.appendChild(indicator)

          if (tool && tool.iconSrc) {
            const icon = document.createElement('img')
            icon.className = 'universal-launcher-tool-icon'
            icon.src = tool.iconSrc
            icon.alt = ''
            icon.onerror = () => {
              icon.replaceWith(createFallbackToolIcon())
            }
            option.appendChild(icon)
          } else {
            option.appendChild(createFallbackToolIcon())
          }

          const text = document.createElement('span')
          text.className = 'universal-launcher-tool-copy'
          const label = document.createElement('span')
          label.className = 'universal-launcher-tool-label'
          label.textContent = tool ? tool.label : 'Agent'
          text.appendChild(label)
          const meta = document.createElement('span')
          meta.className = 'universal-launcher-tool-meta'
          meta.textContent = tool && tool.category ? tool.category : 'Plugin'
          text.appendChild(meta)
          option.appendChild(text)

          option.addEventListener('click', () => {
            launcher.setToolIndex(index)
            launcher.closeToolSheet()
            launcher.toolTrigger.focus()
          })
          list.appendChild(option)
          launcher.toolEntries.push({ button: option, tool })
        })
        launcher.toolSheetBody.appendChild(group)
      })
      const preferredTool = getStoredToolPreference()
      const preferredIndex = preferredTool
        ? tools.findIndex((tool) => tool && tool.value === preferredTool)
        : -1
      launcher.selectedToolIndex = preferredIndex >= 0 ? preferredIndex : -1
      if (preferredTool && preferredIndex < 0) {
        setStoredToolPreference('')
      }
      launcher.syncTool()
    }
    selectedAskAiTool() {
      const launcher = this.askAiLauncher
      if (!launcher || !Array.isArray(this.askAiTools)) {
        return null
      }
      const index = launcher.selectedToolIndex
      return Number.isFinite(index) && index >= 0 ? this.askAiTools[index] || null : null
    }
    async openAskAiModal() {
      if (!this.currentMarkdown && !this.reviewMarkdown) {
        this.updateDraftSizeReview()
        return
      }
      this.setAskAiBusy(true)
      let tools = []
      try {
        tools = await this.loadAskAiTools()
      } catch (error) {
        this.setStatus(error && error.message ? error.message : 'Failed to load plugins.', true)
        this.setAskAiBusy(false)
        return
      }
      this.setAskAiBusy(false)
      if (!Array.isArray(tools) || tools.length === 0) {
        this.setStatus('No AI plugins are available.', true)
        return
      }
      const launcher = this.createAskAiLauncher()
      this.populateAskAiLauncherTools(tools)
      launcher.error.textContent = ''
      launcher.promptTextarea.value = ASK_AI_DEFAULT_PROMPT
      launcher.syncRunState()
      launcher.setOpen(true)
    }
    formatGenerated(value) {
      if (!value) return '--'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    clearReportFiles() {
      if (!this.reportFilesEl) return
      while (this.reportFilesEl.firstChild) {
        this.reportFilesEl.removeChild(this.reportFilesEl.firstChild)
      }
    }
    sectionKey(section, index) {
      return String((section && (section.file || section.script || section.source)) || `section-${index}`)
    }
    sectionMode(section, index) {
      const key = this.sectionKey(section, index)
      return this.sectionModes.get(key) || 'full'
    }
    setSectionMode(section, index, mode) {
      const key = this.sectionKey(section, index)
      const valid = DRAFT_SECTION_MODES.some((item) => item.value === mode)
      this.sectionModes.set(key, valid ? mode : 'full')
      this.rebuildDraftPreview(true)
      this.renderReportFiles(this.report && this.report.sections)
    }
    ensureSectionModes(sections) {
      const keys = new Set()
      ;(sections || []).forEach((section, index) => {
        const key = this.sectionKey(section, index)
        keys.add(key)
        if (!this.sectionModes.has(key)) {
          this.sectionModes.set(key, 'full')
        }
      })
      for (const key of Array.from(this.sectionModes.keys())) {
        if (!keys.has(key)) {
          this.sectionModes.delete(key)
        }
      }
    }
    prepareSection(section, index) {
      const mode = this.sectionMode(section, index)
      if (mode === 'exclude') {
        return null
      }
      const config = DRAFT_SECTION_MODES.find((item) => item.value === mode)
      const text = String((section && section.text) || '')
      const lines = text ? text.split(/\r?\n/) : []
      if (config && config.lines && lines.length > config.lines) {
        const omitted = lines.length - config.lines
        return {
          text: `[Older ${omitted.toLocaleString()} lines omitted by user. Showing the last ${config.lines.toLocaleString()} lines.]\n${lines.slice(-config.lines).join('\n')}`,
          includedLines: config.lines,
          omittedLines: omitted,
          mode
        }
      }
      return {
        text,
        includedLines: lines.length,
        omittedLines: 0,
        mode
      }
    }
    includedSectionCount(sections) {
      return (sections || []).reduce((total, section, index) => {
        return total + (this.prepareSection(section, index) ? 1 : 0)
      }, 0)
    }
    updateSectionCount(sections) {
      if (!this.reportSectionsEl) return
      const total = Array.isArray(sections) ? sections.length : 0
      const included = this.includedSectionCount(sections || [])
      this.reportSectionsEl.textContent = included === total ? String(total) : `${included} / ${total}`
    }
    defaultDraftTitle() {
      const payload = this.report || {}
      const appTitle = payload.title || payload.app_id || 'Pinokio app'
      return this.truncateDraftTitle(`Issue report: ${appTitle}`, DRAFT_TITLE_MAX_LENGTH)
    }
    truncateDraftTitle(value, maxLength = DRAFT_TITLE_DISPLAY_LENGTH) {
      const text = String(value || '').replace(/\s+/g, ' ').trim()
      if (text.length <= maxLength) {
        return text
      }
      return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    }
    draftTitleValue() {
      if (this.draftTitleInput) {
        return this.truncateDraftTitle(this.draftTitleInput.value, DRAFT_TITLE_MAX_LENGTH)
      }
      return (this.draftTitleSuggestion && this.draftTitleSuggestion.title) || this.defaultDraftTitle()
    }
    hasDraftTitle() {
      return Boolean(this.draftTitleValue())
    }
    clearDraftTitle() {
      this.draftTitleEdited = false
      this.draftTitleSuggestion = null
      if (this.draftTitleInput) {
        this.draftTitleInput.value = ''
        this.draftTitleInput.disabled = true
      }
      this.updateDraftTitleNote()
    }
    updateDraftTitleNote() {
      if (!this.draftTitleNoteEl) return
      let note = ''
      if (this.draftTitleInput && this.draftTitleInput.type !== 'hidden' && !this.draftTitleInput.disabled && !this.draftTitleInput.value.trim()) {
        note = 'Title required'
      }
      this.draftTitleNoteEl.textContent = note
    }
    updateDraftTitleSuggestion(force = false) {
      this.draftTitleSuggestion = this.suggestDraftTitle()
      if (this.draftTitleInput) {
        if (force || !this.draftTitleEdited) {
          this.draftTitleInput.value = this.draftTitleSuggestion.title || this.defaultDraftTitle()
          this.draftTitleEdited = false
        }
        this.draftTitleInput.disabled = !this.reviewMarkdown
      }
      this.updateDraftTitleNote()
    }
    suggestDraftTitle() {
      const payload = this.report || {}
      const appTitle = payload.title || payload.app_id || 'Pinokio app'
      const sections = Array.isArray(payload.sections) ? payload.sections : []
      const preparedSections = []
      let newestModified = 0
      sections.forEach((section, index) => {
        const prepared = this.prepareSection(section, index)
        if (!prepared) return
        const modified = Date.parse(section.modified || '')
        if (Number.isFinite(modified)) {
          newestModified = Math.max(newestModified, modified)
        }
        preparedSections.push({ section, index, prepared, modified: Number.isFinite(modified) ? modified : 0 })
      })

      const candidates = []
      for (const item of preparedSections) {
        const candidate = this.bestTitleCandidateForSection(item.section, item.index, item.prepared)
        if (!candidate) continue
        let score = candidate.score
        if (newestModified && item.modified && newestModified - item.modified > DRAFT_TITLE_RECENT_WINDOW_MS) {
          score -= 35
        }
        candidates.push({
          ...candidate,
          score,
          modified: item.modified,
          file: item.section.file || item.section.script || 'log'
        })
      }

      candidates.sort((a, b) => {
        const scoreDelta = b.score - a.score
        if (Math.abs(scoreDelta) > 10) return scoreDelta
        if (a.modified && b.modified && Math.abs(a.modified - b.modified) > 60000) {
          return a.modified - b.modified
        }
        return a.lineIndex - b.lineIndex
      })

      const best = candidates[0]
      if (!best || best.score < 35) {
        return { title: '', confidence: 'low', fallback: true }
      }
      return {
        title: this.truncateDraftTitle(`${appTitle}: ${best.text}`, DRAFT_TITLE_MAX_LENGTH),
        confidence: best.score >= 70 ? 'high' : 'medium',
        source: best.file,
        fallback: false
      }
    }
    bestTitleCandidateForSection(section, index, prepared) {
      const lines = String((prepared && prepared.text) || '').split(/\r?\n/)
      let best = null
      lines.forEach((line, lineIndex) => {
        const text = this.cleanDraftTitleLine(line)
        if (!text) return
        const score = this.scoreDraftTitleLine(text, lineIndex, lines.length)
        if (score < 25) return
        if (!best || score > best.score + 6 || (Math.abs(score - best.score) <= 6 && lineIndex < best.lineIndex)) {
          best = { text, score, lineIndex, sectionIndex: index }
        }
      })
      return best
    }
    scoreDraftTitleLine(line, lineIndex, lineCount) {
      let score = 0
      if (DRAFT_TITLE_FAILURE_PATTERN.test(line)) score += 35
      if (DRAFT_TITLE_STRONG_PATTERN.test(line)) score += 35
      if (/:\s+\S/.test(line) && DRAFT_TITLE_FAILURE_PATTERN.test(line)) score += 8
      if (lineIndex > Math.floor(lineCount * 0.7)) score += 6
      if (DRAFT_TITLE_STACK_PATTERN.test(line)) score -= 28
      if (DRAFT_TITLE_NOISE_PATTERN.test(line)) score -= 60
      if (line.length > 180) score -= 12
      return score
    }
    cleanDraftTitleLine(value) {
      let text = String(value || '')
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\r/g, ' ')
        .trim()
      if (!text || DRAFT_TITLE_NOISE_PATTERN.test(text)) {
        return ''
      }
      text = text
        .replace(/^[-+*]\s+/, '')
        .replace(/^<<PINOKIO_SHELL>>\s*/, '')
        .replace(/\b([A-Za-z_][A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY)[A-Za-z0-9_.-]*\s*=\s*)\S+/gi, '$1[redacted]')
        .replace(/\b(?:sk|hf|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{12,}\b/g, '[secret]')
        .replace(/\/(?:Users|home)\/[^/\s"'`]+\/[^\s"'`]*/g, (match) => this.shortenTitlePath(match, '/'))
        .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+\\[^\s"'`]*/g, (match) => this.shortenTitlePath(match, '\\'))
        .replace(/\s+/g, ' ')
        .trim()
      if (!text || /^[\s=#-]+$/.test(text)) {
        return ''
      }
      return this.truncateDraftTitle(text, DRAFT_TITLE_DISPLAY_LENGTH)
    }
    shortenTitlePath(value, separator) {
      const text = String(value || '')
      const parts = text.split(separator).filter(Boolean)
      if (parts.length <= 3) {
        return text
      }
      return `…${separator}${parts.slice(-2).join(separator)}`
    }
    renderDraftMarkdown() {
      const payload = this.report || {}
      const sections = Array.isArray(payload.sections) ? payload.sections : []
      const lines = [
        '# Issue Report',
        '',
        `App: ${payload.title || payload.app_id || 'unknown'} (${payload.app_id || 'unknown'})`,
        payload.repo_url ? `Repo: ${payload.repo_url}` : null,
        `Generated: ${payload.generated_at || new Date().toISOString()}`,
        `Pinokio: ${payload.pinokiod || 'unknown'}`,
        `Platform: ${payload.platform || 'unknown'} ${payload.arch || ''}`.trim(),
        `Node: ${payload.node || 'unknown'}`,
        '',
        '## Summary',
        '',
        '',
        '## System',
        '',
        '```json',
        JSON.stringify(payload.system_spec || {}, null, 2),
        '```',
        '',
        '## Logs'
      ].filter((line) => line !== null)

      let included = 0
      sections.forEach((section, index) => {
        const prepared = this.prepareSection(section, index)
        if (!prepared) {
          return
        }
        included += 1
        const totalLines = Number(section.line_count) || prepared.includedLines || 0
        const availableLines = Math.min(totalLines, Number(section.tail_count) || prepared.includedLines || totalLines)
        const lineSummary = prepared.omittedLines > 0
          ? `${totalLines} total, last ${prepared.includedLines} selected by user`
          : `${totalLines} total, last ${availableLines} included${section.truncated ? ' (truncated)' : ''}`
        lines.push(
          '',
          `### ${section.file || section.script || 'log'}`,
          '',
          `Source: ${section.source || 'api'}${section.script ? ` / ${section.script}` : ''}`,
          `Lines: ${lineSummary}`,
          '',
          '```text',
          prepared.text || '',
          '```'
        )
      })
      if (!included) {
        lines.push('', 'No app log files were selected.')
      }
      return lines.join('\n')
    }
    rebuildDraftPreview(resetRedactions) {
      this.reviewMarkdown = this.renderDraftMarkdown()
      if (resetRedactions) {
        this.redactionHasRun = false
        this.redactionItems = []
        this.renderedRedactionItems = []
        this.selectedRedactionId = null
        this.activeRedactionFilter = 'all'
        this.resetRedactionReview(this.reviewMarkdown ? 'Run the privacy filter to review detected items.' : 'No report text to review.')
      }
      this.currentMarkdown = this.reviewMarkdown
      this.updateDraftTitleSuggestion(false)
      this.renderCurrentReport()
      this.updateSectionCount(this.report && this.report.sections)
      this.setRunFilterEnabled(Boolean(this.reviewMarkdown) && !this.filtering)
    }
    renderReportFiles(sections, noSession = false) {
      this.clearReportFiles()
      if (!this.reportFilesEl) return
      ;(sections || []).forEach((section, index) => {
        const mode = this.sectionMode(section, index)
        const prepared = this.prepareSection(section, index)
        const item = document.createElement('div')
        item.className = 'logs-section-control'
        item.classList.toggle('is-excluded', mode === 'exclude')

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'logs-section-checkbox'
        checkbox.checked = mode !== 'exclude'
        checkbox.setAttribute('aria-label', `Include ${section.file || section.script || 'log section'}`)
        checkbox.addEventListener('change', () => {
          this.setSectionMode(section, index, checkbox.checked ? 'full' : 'exclude')
        })

        const textWrap = document.createElement('div')
        textWrap.className = 'logs-section-text'
        const name = document.createElement('div')
        name.className = 'logs-section-name'
        name.textContent = section.file || section.script || section.source || 'log'
        name.title = name.textContent
        const meta = document.createElement('div')
        meta.className = 'logs-section-meta'
        const size = Number(section.size) ? humanBytes(section.size) : 'unknown size'
        const totalLines = Number(section.line_count) || 0
        const trimText = prepared && prepared.omittedLines > 0 ? ` · ${prepared.omittedLines.toLocaleString()} older lines omitted` : ''
        meta.textContent = `${totalLines.toLocaleString()} lines · ${size}${trimText}`
        textWrap.appendChild(name)
        textWrap.appendChild(meta)

        const select = document.createElement('select')
        select.className = 'logs-section-mode'
        select.setAttribute('aria-label', `Draft inclusion for ${name.textContent}`)
        for (const optionConfig of DRAFT_SECTION_MODES) {
          const option = document.createElement('option')
          option.value = optionConfig.value
          option.textContent = optionConfig.label
          select.appendChild(option)
        }
        select.value = mode
        select.addEventListener('change', () => this.setSectionMode(section, index, select.value))

        item.appendChild(checkbox)
        item.appendChild(textWrap)
        item.appendChild(select)
        this.reportFilesEl.appendChild(item)
      })
      if (!sections || !sections.length) {
        const empty = document.createElement('div')
        empty.className = 'logs-review-empty'
        empty.textContent = noSession ? 'No session log bundle found.' : 'No session log files found.'
        this.reportFilesEl.appendChild(empty)
      }
    }
    sessionOptionLabel(session, index, latestId) {
      const runs = Array.isArray(session && session.runs) ? session.runs.filter(Boolean) : []
      const prefix = session && session.id === latestId ? 'Latest' : `Session ${index + 1}`
      const detail = runs.length ? runs.join(' -> ') : (session && session.id ? session.id : 'log bundle')
      return `${prefix}: ${detail}`
    }
    renderSessionPicker(payload) {
      if (!this.sessionPickerEl || !this.sessionSelectEl) return
      const sessions = Array.isArray(payload && payload.sessions) ? payload.sessions : []
      const selectedId = String((payload && payload.session) || (payload && payload.latest_session) || '')
      const latestId = String((payload && payload.latest_session) || '')
      this.latestSession = latestId
      if (this.selectedSession && this.selectedSession === latestId) {
        this.selectedSession = ''
      }
      if (this.selectedSession && !sessions.some((session) => session && session.id === this.selectedSession)) {
        this.selectedSession = ''
      }
      this.sessionPickerEl.classList.toggle('hidden', sessions.length === 0)
      this.sessionSelectEl.disabled = sessions.length === 0
      this.sessionSelectEl.textContent = ''
      sessions.forEach((session, index) => {
        if (!session || !session.id) return
        const option = document.createElement('option')
        option.value = session.id
        option.textContent = this.sessionOptionLabel(session, index, latestId)
        this.sessionSelectEl.appendChild(option)
      })
      const displayId = this.selectedSession || selectedId
      if (displayId) {
        this.sessionSelectEl.value = displayId
      }
    }
    renderSummary(payload) {
      const sections = Array.isArray(payload && payload.sections) ? payload.sections : []
      this.renderSessionPicker(payload)
      this.updateSectionCount(sections)
      if (this.reportGeneratedEl) {
        this.reportGeneratedEl.textContent = this.formatGenerated(payload && payload.generated_at)
      }
      this.renderReportFiles(sections, Boolean(payload && payload.no_session))
      return sections
    }
    setCopyEnabled(enabled) {
      if (this.copyButton) {
        this.copyButton.disabled = !enabled
      }
    }
    setRunFilterEnabled(enabled) {
      if (this.runFilterButton) {
        this.runFilterButton.disabled = !enabled
        if (!this.filtering) {
          this.runFilterButton.classList.remove('is-busy')
          this.runFilterButton.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Run privacy filter</span>'
        }
      }
    }
    setFiltering(isFiltering) {
      this.filtering = Boolean(isFiltering)
      if (this.runFilterButton) {
        this.runFilterButton.disabled = this.filtering || !this.reviewMarkdown
        this.runFilterButton.classList.toggle('is-busy', this.filtering)
        if (this.filtering) {
          this.runFilterButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Filtering…</span>'
        } else {
          this.runFilterButton.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Run privacy filter</span>'
        }
      }
      this.updateDraftSizeReview()
    }
    setOutputText(text) {
      if (this.outputEl) {
        this.outputEl.textContent = text || ''
      }
    }
    normalizeRedactionItems(items, text) {
      const normalized = (Array.isArray(items) ? items : [])
        .map((item, index) => {
          const sourceStart = Number(item.sourceStart != null ? item.sourceStart : item.maskedStart)
          const sourceEnd = Number(item.sourceEnd != null ? item.sourceEnd : item.maskedEnd)
          if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart || sourceStart < 0 || sourceEnd > text.length) {
            return null
          }
          const id = item.id != null ? String(item.id) : String(index)
          const label = String(item.label || 'private')
          return {
            id,
            label,
            sourceStart,
            sourceEnd,
            replacement: item.replacement || `[${label}]`,
            enabled: item.enabled !== false,
            line: this.lineForOffset(text, sourceStart),
            context: this.lineContext(text, sourceStart, sourceEnd),
            source: this.sourceForOffset(text, sourceStart)
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd)
      const nonOverlapping = []
      let cursor = 0
      for (const item of normalized) {
        if (item.sourceStart < cursor) {
          continue
        }
        nonOverlapping.push(item)
        cursor = item.sourceEnd
      }
      return nonOverlapping
    }
    lineForOffset(text, offset) {
      return String(text || '').slice(0, Math.max(0, offset)).split('\n').length
    }
    lineContext(text, start, end) {
      const value = String(text || '')
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const nextLine = value.indexOf('\n', Math.max(0, end))
      const lineEnd = nextLine >= 0 ? nextLine : value.length
      return value.slice(lineStart, lineEnd).trim()
    }
    sourceForOffset(text, offset) {
      const before = String(text || '').slice(0, Math.max(0, offset))
      let source = 'Issue report'
      const pattern = /^###\s+(.+)$/gm
      let match = pattern.exec(before)
      while (match) {
        source = match[1]
        match = pattern.exec(before)
      }
      return source
    }
    buildCurrentReport() {
      const text = this.reviewMarkdown || ''
      if (!text || !this.redactionItems.length) {
        this.currentMarkdown = text
        this.renderedRedactionItems = []
        return
      }
      let cursor = 0
      let output = ''
      const renderedItems = []
      for (const item of this.redactionItems) {
        if (item.sourceStart < cursor) {
          continue
        }
        if (item.sourceStart > cursor) {
          output += text.slice(cursor, item.sourceStart)
        }
        const value = item.enabled ? item.replacement : text.slice(item.sourceStart, item.sourceEnd)
        const maskedStart = output.length
        output += value
        const maskedEnd = output.length
        renderedItems.push({
          ...item,
          maskedStart,
          maskedEnd,
          line: this.lineForOffset(output, maskedStart),
          context: this.lineContext(output, maskedStart, maskedEnd),
          source: this.sourceForOffset(output, maskedStart)
        })
        cursor = item.sourceEnd
      }
      if (cursor < text.length) {
        output += text.slice(cursor)
      }
      this.currentMarkdown = output
      this.renderedRedactionItems = renderedItems
    }
    enabledRedactionCount() {
      return this.redactionItems.reduce((total, item) => total + (item.enabled ? 1 : 0), 0)
    }
    updateRedactionCount() {
      if (!this.reviewCountEl) return
      if (!this.redactionHasRun) {
        this.reviewCountEl.textContent = 'Not run'
        return
      }
      const enabled = this.enabledRedactionCount()
      const total = this.redactionItems.length
      this.reviewCountEl.textContent = total ? `${enabled} masked` : '0 masked'
    }
    encodeUtf8Base64(value) {
      const text = String(value || '')
      if (!textEncoder || typeof btoa !== 'function') {
        return btoa(unescape(encodeURIComponent(text)))
      }
      const bytes = textEncoder.encode(text)
      let binary = ''
      const chunkSize = 0x8000
      for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize)
        binary += String.fromCharCode.apply(null, chunk)
      }
      return btoa(binary)
    }
    buildDraftMetadata() {
      const payload = this.report || {}
      const appTitle = payload.title || payload.app_id || 'Pinokio app'
      const title = this.draftTitleInput
        ? this.draftTitleValue()
        : (this.draftTitleValue() || `Issue report: ${appTitle}`)
      const metadata = {
        title,
        body: this.currentMarkdown || this.reviewMarkdown || '',
        tags: ['bug', 'logs'],
        source: 'pinokio-logs',
        appLocalId: payload.app_id || ''
      }
      if (payload.repo_url) {
        metadata.repoUrl = payload.repo_url
        metadata.appRepoUrl = payload.repo_url
        metadata.parent = { type: 'app', url: payload.repo_url }
      }
      return metadata
    }
    buildDraftImportPayload() {
      const metadata = this.buildDraftMetadata()
      const metadataJson = JSON.stringify(metadata)
      const metadataB64 = this.encodeUtf8Base64(metadataJson)
      return {
        metadata,
        metadataB64,
        bodyBytes: textByteLength(metadata.body || ''),
        payloadBytes: textByteLength(metadataB64)
      }
    }
    setCreateDraftBusy(isBusy) {
      this.importingDraft = Boolean(isBusy)
      if (!this.createDraftButton) return
      if (this.importingDraft) {
        this.createDraftButton.disabled = true
        this.createDraftButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Opening…</span>'
      } else {
        this.createDraftButton.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Ask Community</span>'
        this.updateDraftSizeReview()
      }
    }
    updateDraftSizeReview() {
      const hasText = Boolean(this.currentMarkdown || this.reviewMarkdown)
      const hasTitle = this.hasDraftTitle()
      let draft = null
      if (hasText) {
        draft = this.buildDraftImportPayload()
        this.draftBodyBytes = draft.bodyBytes
        this.draftPayloadBytes = draft.payloadBytes
        this.draftOversized = draft.bodyBytes > DRAFT_BODY_TARGET_BYTES || draft.payloadBytes > DRAFT_IMPORT_FIELD_LIMIT_BYTES
      } else {
        this.draftBodyBytes = 0
        this.draftPayloadBytes = 0
        this.draftOversized = false
      }
      if (this.draftSizeBadgeEl) {
        this.draftSizeBadgeEl.textContent = hasText ? `${humanBytes(this.draftBodyBytes)} / ${humanBytes(DRAFT_BODY_TARGET_BYTES)}` : '--'
        this.draftSizeBadgeEl.classList.toggle('is-error', Boolean(hasText && this.draftOversized))
      }
      if (this.draftMeterFillEl) {
        const pct = hasText ? Math.min(100, Math.round((this.draftBodyBytes / DRAFT_BODY_TARGET_BYTES) * 100)) : 0
        this.draftMeterFillEl.style.width = `${pct}%`
        this.draftMeterFillEl.classList.toggle('is-error', Boolean(hasText && this.draftOversized))
      }
      if (this.draftStatusEl) {
        let message = 'Waiting for session report.'
        let isError = false
        if (hasText && this.draftOversized) {
          isError = true
          message = this.draftPayloadBytes > DRAFT_IMPORT_FIELD_LIMIT_BYTES
            ? `Too large for registry import after encoding. Exclude a section or keep fewer recent lines.`
            : `Too large for one-click draft import. Exclude a section or keep fewer recent lines.`
        } else if (hasText && !hasTitle) {
          isError = true
          message = 'Add a title before posting to Community.'
        } else if (hasText) {
          message = 'Ready for Ask AI or Community.'
        }
        this.draftStatusEl.textContent = message
        this.draftStatusEl.classList.toggle('is-error', isError)
      }
      if (this.draftTitleInput) {
        this.draftTitleInput.disabled = !hasText
      }
      this.updateDraftTitleNote()
      if (this.askAiButton) {
        const canAsk = hasText && !this.filtering
        this.askAiButton.disabled = !canAsk
        this.askAiButton.title = canAsk ? 'Launch a local AI agent with this report context' : 'Session report is not ready yet'
      }
      if (this.createDraftButton && !this.importingDraft) {
        const canCreate = hasText && hasTitle && !this.draftOversized && !this.filtering && Boolean(this.draftUrl)
        this.createDraftButton.disabled = !canCreate
        this.createDraftButton.title = canCreate
          ? 'Open a draft question on Community'
          : (!hasTitle ? 'Add a title before posting to Community' : (this.draftOversized ? 'Reduce the report size before posting to Community' : 'Community posting is not available for this view'))
      }
    }
    renderCurrentReport() {
      this.buildCurrentReport()
      const text = this.currentMarkdown || 'No session log bundle found.'
      this.renderHighlightedOutput(text, this.renderedRedactionItems)
      this.renderRedactionReview()
      this.updateRedactionCount()
      this.updateDraftSizeReview()
      this.setCopyEnabled(Boolean(this.currentMarkdown))
      this.selectRedaction(this.selectedRedactionId, false)
    }
    renderHighlightedOutput(text, items = []) {
      if (!this.outputEl) {
        return
      }
      this.outputEl.textContent = ''
      if (!text) {
        return
      }
      if (!items.length) {
        this.outputEl.textContent = text
        return
      }
      let cursor = 0
      for (const item of items) {
        if (item.maskedStart < cursor) {
          continue
        }
        if (item.maskedStart > cursor) {
          this.outputEl.appendChild(document.createTextNode(text.slice(cursor, item.maskedStart)))
        }
        const token = document.createElement('span')
        token.className = item.enabled ? 'logs-mask-token' : 'logs-unmasked-token'
        token.dataset.redactionId = item.id
        token.textContent = text.slice(item.maskedStart, item.maskedEnd)
        token.title = `${item.enabled ? 'Masked' : 'Visible'} ${item.label} · line ${item.line}`
        this.outputEl.appendChild(token)
        cursor = item.maskedEnd
      }
      if (cursor < text.length) {
        this.outputEl.appendChild(document.createTextNode(text.slice(cursor)))
      }
    }
    renderRedactionReview() {
      const items = this.redactionItems || []
      const renderedById = new Map((this.renderedRedactionItems || []).map((item) => [item.id, item]))
      const labels = new Map()
      for (const item of items) {
        labels.set(item.label, (labels.get(item.label) || 0) + 1)
      }
      this.updateRedactionCount()
      if (this.reviewFiltersEl) {
        this.reviewFiltersEl.textContent = ''
        const filters = [['all', `All ${items.length}`], ...Array.from(labels.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => [label, `${label} ${count}`])]
        for (const [value, label] of filters) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'logs-redaction-filter'
          button.classList.toggle('is-active', this.activeRedactionFilter === value)
          button.dataset.redactionFilter = value
          button.textContent = label
          button.addEventListener('click', () => {
            this.activeRedactionFilter = value
            this.renderRedactionReview()
          })
          this.reviewFiltersEl.appendChild(button)
        }
      }
      if (!this.reviewListEl) {
        return
      }
      this.reviewListEl.textContent = ''
      if (!items.length) {
        const empty = document.createElement('div')
        empty.className = 'logs-redaction-empty'
        empty.textContent = this.redactionHasRun ? 'No redactions detected.' : 'Run the privacy filter to review detected items.'
        this.reviewListEl.appendChild(empty)
        return
      }
      const visibleItems = this.activeRedactionFilter === 'all'
        ? items
        : items.filter((item) => item.label === this.activeRedactionFilter)
      if (!visibleItems.length) {
        const empty = document.createElement('div')
        empty.className = 'logs-redaction-empty'
        empty.textContent = 'No redactions match this filter.'
        this.reviewListEl.appendChild(empty)
        return
      }
      for (const item of visibleItems) {
        const rendered = renderedById.get(item.id) || item
        const row = document.createElement('div')
        row.className = 'logs-redaction-row'
        row.dataset.redactionId = item.id
        row.classList.toggle('is-selected', this.selectedRedactionId === item.id)
        row.classList.toggle('is-disabled', !item.enabled)
        row.tabIndex = 0
        row.setAttribute('role', 'button')
        row.setAttribute('aria-current', this.selectedRedactionId === item.id ? 'true' : 'false')
        row.addEventListener('click', () => this.selectRedaction(item.id, true))
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.selectRedaction(item.id, true)
          }
        })

        const top = document.createElement('div')
        top.className = 'logs-redaction-row-top'
        const meta = document.createElement('div')
        meta.className = 'logs-redaction-row-meta'

        const label = document.createElement('span')
        label.className = 'logs-redaction-label'
        label.textContent = item.label
        meta.appendChild(label)

        const source = document.createElement('span')
        source.className = 'logs-redaction-source'
        source.textContent = `${item.source} · line ${item.line}`
        source.title = source.textContent
        meta.appendChild(source)

        const toggle = document.createElement('label')
        toggle.className = 'logs-redaction-toggle'
        toggle.title = item.enabled ? 'Keep this item masked' : 'Show this item in the copied report'
        toggle.addEventListener('click', (event) => event.stopPropagation())
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = item.enabled
        checkbox.setAttribute('aria-label', `${item.enabled ? 'Mask' : 'Show'} ${item.label}`)
        checkbox.addEventListener('click', (event) => event.stopPropagation())
        checkbox.addEventListener('change', (event) => {
          event.stopPropagation()
          item.enabled = checkbox.checked
          this.selectedRedactionId = item.id
          this.renderCurrentReport()
        })
        const toggleTrack = document.createElement('span')
        toggleTrack.className = 'logs-redaction-toggle-track'
        toggle.appendChild(checkbox)
        toggle.appendChild(toggleTrack)

        const context = document.createElement('div')
        context.className = 'logs-redaction-context'
        context.textContent = rendered.context || ''
        context.title = rendered.context || ''

        top.appendChild(meta)
        top.appendChild(toggle)
        row.appendChild(top)
        row.appendChild(context)
        this.reviewListEl.appendChild(row)
      }
    }
    selectRedaction(id, scrollPreview) {
      this.selectedRedactionId = id == null ? null : String(id)
      if (this.outputEl) {
        this.outputEl.querySelectorAll('.logs-mask-token, .logs-unmasked-token').forEach((node) => {
          node.classList.toggle('is-selected', node.dataset.redactionId === this.selectedRedactionId)
        })
      }
      if (this.reviewListEl) {
        this.reviewListEl.querySelectorAll('.logs-redaction-row').forEach((node) => {
          const selected = node.dataset.redactionId === this.selectedRedactionId
          node.classList.toggle('is-selected', selected)
          node.setAttribute('aria-current', selected ? 'true' : 'false')
        })
      }
      if (!scrollPreview || !this.outputEl || !this.selectedRedactionId) {
        return
      }
      const token = Array.from(this.outputEl.querySelectorAll('.logs-mask-token, .logs-unmasked-token')).find((node) => {
        return node.dataset.redactionId === this.selectedRedactionId
      })
      if (!token) {
        return
      }
      const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const outputStyle = window.getComputedStyle ? window.getComputedStyle(this.outputEl) : null
      const outputOverflowY = outputStyle ? outputStyle.overflowY : ''
      const outputCanScroll = /auto|scroll|overlay/.test(outputOverflowY) && this.outputEl.scrollHeight > this.outputEl.clientHeight
      const scrollTarget = outputCanScroll ? this.outputEl : (this.outputEl.closest('.logs-page') || this.outputEl)
      const outputRect = scrollTarget.getBoundingClientRect()
      const tokenRect = token.getBoundingClientRect()
      const nextTop = scrollTarget.scrollTop + tokenRect.top - outputRect.top - Math.round(outputRect.height * 0.35)
      scrollTarget.scrollTo({
        top: Math.max(0, nextTop),
        behavior: reducedMotion ? 'auto' : 'smooth'
      })
    }
    resetRedactionReview(message = 'Filtering has not run yet.') {
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.selectedRedactionId = null
      this.activeRedactionFilter = 'all'
      this.updateRedactionCount()
      if (this.reviewFiltersEl) {
        this.reviewFiltersEl.textContent = ''
      }
      if (this.reviewListEl) {
        this.reviewListEl.textContent = ''
        const empty = document.createElement('div')
        empty.className = 'logs-redaction-empty'
        empty.textContent = message
        this.reviewListEl.appendChild(empty)
      }
    }
    render(payload) {
      const sections = this.renderSummary(payload)
      this.rawMarkdown = payload && payload.markdown ? String(payload.markdown) : ''
      this.ensureSectionModes(sections)
      this.reviewMarkdown = this.renderDraftMarkdown()
      this.currentMarkdown = this.reviewMarkdown
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.filterChunks = 0
      this.redactionHasRun = false
      this.filtering = false
      this.selectedRedactionId = null
      this.activeRedactionFilter = 'all'
      this.draftTitleEdited = false
      this.updateDraftTitleSuggestion(true)
      this.renderCurrentReport()
      this.resetRedactionReview(this.reviewMarkdown ? 'Run the privacy filter to review detected items.' : 'No report text to review.')
      this.updateRedactionCount()
      this.setRunFilterEnabled(Boolean(this.reviewMarkdown))
      if (!this.reviewMarkdown) {
        this.setStatus(`Session report found ${sections.length} log section${sections.length === 1 ? '' : 's'}.`)
        return
      }
      this.setStatus(`Session report built from ${sections.length} log section${sections.length === 1 ? '' : 's'}. Run the privacy filter only if you want local redaction review.`)
    }
    renderError(message) {
      if (this.reportSectionsEl) this.reportSectionsEl.textContent = '--'
      if (this.reportGeneratedEl) this.reportGeneratedEl.textContent = '--'
      this.clearReportFiles()
      this.rawMarkdown = ''
      this.reviewMarkdown = ''
      this.currentMarkdown = ''
      this.redactionHasRun = false
      this.filtering = false
      this.clearDraftTitle()
      this.setOutputText(message || 'Unable to build session report.')
      this.resetRedactionReview('No redaction review is available.')
      this.setCopyEnabled(false)
      this.setRunFilterEnabled(false)
      this.updateDraftSizeReview()
      this.setStatus(message || 'Unable to build session report.', true)
    }
    renderFilterProgress(progress) {
      if (!progress || typeof progress !== 'object') {
        return
      }
      if (progress.type === 'runtime') {
        this.setStatus(`Loading OpenAI Privacy Filter locally (${progress.device}/${progress.dtype}). First run downloads and caches the model.`)
      } else if (progress.type === 'fallback') {
        this.setStatus(progress.message || `Retrying privacy filtering locally with ${progress.device}/${progress.dtype}.`)
      } else if (progress.type === 'download') {
        const fileLabel = progress.file ? ` ${progress.file}` : ''
        if (progress.total) {
          this.setStatus(`Downloading privacy filter${fileLabel}: ${humanBytes(progress.loaded)} / ${humanBytes(progress.total)}. Cached for future reports.`)
        } else {
          this.setStatus(`Downloading privacy filter${fileLabel}. Cached for future reports.`)
        }
      } else if (progress.type === 'chunk') {
        const total = Number(progress.total) || 0
        const done = Number(progress.done) || 0
        this.setStatus(total > 0 ? `Filtering locally… ${Math.min(done + 1, total)} / ${total} chunks.` : 'Filtering locally…')
      }
    }
    renderFilterError(error) {
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.redactionHasRun = false
      this.currentMarkdown = this.reviewMarkdown
      this.selectedRedactionId = null
      this.setCopyEnabled(Boolean(this.currentMarkdown))
      this.setRunFilterEnabled(Boolean(this.reviewMarkdown))
      this.setOutputText(this.reviewMarkdown || 'Privacy filter failed. No report text is available.')
      this.updateDraftSizeReview()
      this.resetRedactionReview('Privacy filtering failed before any redactions could be reviewed.')
      this.setStatus(error && error.message ? error.message : 'Privacy filter failed.', true)
    }
    async filterReport() {
      const sourceMarkdown = this.reviewMarkdown || ''
      if (!sourceMarkdown || this.filtering) {
        return
      }
      const token = this.filterToken + 1
      this.filterToken = token
      this.setFiltering(true)
      this.setCopyEnabled(false)
      try {
        const result = await this.privacyFilter.filter(sourceMarkdown, (progress) => {
          if (token === this.filterToken) {
            this.renderFilterProgress(progress)
          }
        })
        if (token !== this.filterToken) {
          return
        }
        this.redactionItems = this.normalizeRedactionItems(result && result.items, sourceMarkdown)
        this.filterChunks = Number(result && result.chunks) || 1
        this.redactionHasRun = true
        this.selectedRedactionId = this.redactionItems.length ? this.redactionItems[0].id : null
        this.renderCurrentReport()
        this.selectRedaction(this.selectedRedactionId, false)
        const maskedCount = this.enabledRedactionCount()
        this.setStatus(`Privacy filter finished locally. ${maskedCount} item${maskedCount === 1 ? '' : 's'} masked across ${this.filterChunks} chunk${this.filterChunks === 1 ? '' : 's'}.`)
      } catch (error) {
        if (token === this.filterToken) {
          this.renderFilterError(error)
        }
      } finally {
        if (token === this.filterToken) {
          this.setFiltering(false)
        }
      }
    }
    async load(force = false) {
      if (!this.reportUrl) {
        this.renderError('Session reports are available for app workspaces.')
        return
      }
      if (this.report && !force) {
        this.renderSummary(this.report)
        this.rebuildDraftPreview(false)
        this.setRunFilterEnabled(Boolean(this.reviewMarkdown) && !this.filtering)
        if (!this.redactionHasRun && this.reviewMarkdown) {
          this.setStatus('Unfiltered report is ready. Run the privacy filter only if you want local redaction review.')
        }
        return
      }
      if (this.loading) return
      this.loading = true
      this.setBusy(true)
      this.setStatus('Building session report…')
      this.filterToken += 1
      this.rawMarkdown = ''
      this.reviewMarkdown = ''
      this.currentMarkdown = ''
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.redactionHasRun = false
      this.selectedRedactionId = null
      this.activeRedactionFilter = 'all'
      this.clearDraftTitle()
      this.resetRedactionReview('Waiting for session report.')
      this.setCopyEnabled(false)
      this.setFiltering(false)
      this.updateDraftSizeReview()
      try {
        const response = await fetch(this.buildReportUrl(), {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
        }
        this.report = payload
        this.render(payload)
      } catch (error) {
        this.renderError(error && error.message ? error.message : String(error || 'Unknown error'))
      } finally {
        this.loading = false
        this.setBusy(false)
      }
    }
    registryOrigin(value) {
      try {
        return new URL(value || this.registryBase, window.location.origin).origin
      } catch (_) {
        return 'https://pinokio.co'
      }
    }
    registryMessageOrigins() {
      const origins = new Set([this.registryOrigin(this.registryBase)])
      if (origins.has('https://pinokio.co')) {
        origins.add('https://www.pinokio.co')
      }
      return origins
    }
    async submitDraftImport(token, registry, popup, popupOrigin) {
      const draft = this.buildDraftImportPayload()
      if (!draft.metadata.title) {
        throw new Error('Add a title before posting to Community.')
      }
      if (!draft.metadata.body || this.draftOversized || draft.payloadBytes > DRAFT_IMPORT_FIELD_LIMIT_BYTES) {
        throw new Error('Draft is too large for registry import.')
      }
      const form = new FormData()
      form.append('token', token)
      form.append('registry', registry || this.registryBase)
      form.append('metadata_b64', draft.metadataB64)
      const response = await fetch(this.draftUrl, {
        method: 'POST',
        body: form,
        cache: 'no-store'
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : `Draft import failed (${response.status})`)
      }
      const editUrl = payload && payload.editUrl ? String(payload.editUrl) : ''
      if (popup && !popup.closed) {
        popup.postMessage({
          type: 'pinokio:draft-import-result',
          ok: true,
          editUrl
        }, popupOrigin || this.registryOrigin(this.registryBase))
      }
      this.setStatus(editUrl ? 'Community draft created. Opening editor.' : 'Community draft created.')
      return payload
    }
    async createDraft() {
      if (this.importingDraft || this.draftOversized || !this.hasDraftTitle() || !this.currentMarkdown || !this.draftUrl) {
        this.updateDraftSizeReview()
        return
      }
      const authorizeUrl = new URL('/draft-import/authorize', this.registryBase)
      authorizeUrl.searchParams.set('handoff', 'post_message')
      authorizeUrl.searchParams.set('origin', window.location.origin)
      authorizeUrl.searchParams.set('wait', '1')
      this.setCreateDraftBusy(true)
      this.setStatus('Opening Community authorization…')
      const screenInfo = window.screen || {}
      const width = Math.max(720, Math.floor(screenInfo.availWidth || window.outerWidth || 1200))
      const height = Math.max(640, Math.floor(screenInfo.availHeight || window.outerHeight || 820))
      const left = Number.isFinite(screenInfo.availLeft) ? screenInfo.availLeft : 0
      const top = Number.isFinite(screenInfo.availTop) ? screenInfo.availTop : 0
      const popupFeatures = `popup=yes,width=${width},height=${height},left=${left},top=${top}`
      const popup = window.open(authorizeUrl.toString(), 'pinokio-draft-import', popupFeatures)
      if (!popup) {
        this.setCreateDraftBusy(false)
        this.setStatus('Community authorization window was blocked.', true)
        return
      }
      try {
        if (typeof popup.moveTo === 'function') {
          popup.moveTo(left, top)
        }
        if (typeof popup.resizeTo === 'function') {
          popup.resizeTo(width, height)
        }
      } catch (_) {}
      const registryOrigin = this.registryOrigin(this.registryBase)
      const registryMessageOrigins = this.registryMessageOrigins()
      let popupOrigin = registryOrigin
      let settled = false
      const finish = (message, isError) => {
        settled = true
        window.removeEventListener('message', onMessage)
        window.clearInterval(closeTimer)
        this.setCreateDraftBusy(false)
        if (message) {
          this.setStatus(message, isError)
        }
      }
      const failPopup = (message) => {
        if (popup && !popup.closed) {
          popup.postMessage({
            type: 'pinokio:draft-import-result',
            ok: false,
            error: message
          }, popupOrigin)
        }
      }
      const onMessage = async (event) => {
        if (settled || event.source !== popup || !registryMessageOrigins.has(event.origin)) {
          return
        }
        const data = event.data || {}
        if (!data || data.type !== 'pinokio:draft-import-token') {
          return
        }
        popupOrigin = event.origin
        const token = typeof data.token === 'string' ? data.token : ''
        const registry = typeof data.registry === 'string' ? data.registry : this.registryBase
        if (!token) {
          failPopup('Community did not return an import token.')
          finish('Community did not return an import token.', true)
          return
        }
        try {
          await this.submitDraftImport(token, registry, popup, popupOrigin)
          finish(null, false)
        } catch (error) {
          const message = error && error.message ? error.message : 'Draft import failed.'
          failPopup(message)
          finish(message, true)
        }
      }
      const closeTimer = window.setInterval(() => {
        if (!settled && popup.closed) {
          finish('Community authorization was closed before import.', true)
        }
      }, 1000)
      window.addEventListener('message', onMessage)
      popup.focus()
    }
    async copy() {
      if (!this.currentMarkdown) return
      try {
        await navigator.clipboard.writeText(this.currentMarkdown)
        this.setStatus(this.redactionHasRun ? 'Reviewed report copied.' : 'Unfiltered report copied.')
      } catch (_) {
        if (this.outputEl) {
          this.outputEl.focus()
          const selection = window.getSelection()
          const range = document.createRange()
          range.selectNodeContents(this.outputEl)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        this.setStatus('Select the snapshot text to copy.')
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
      this.reportUrl = config.reportUrl || (this.workspace ? `/apps/logs/${encodeURIComponent(this.workspace)}/report` : '')
      this.initialView = config.initialView === 'latest' && this.reportUrl ? 'latest' : 'raw'
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
      this.closeButton = document.getElementById('logs-close-view')
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
      this.latestReport = new LogsSessionReport({
        reportUrl: this.reportUrl,
        draftUrl: config.draftUrl || '',
        registryBase: config.registryBase || 'https://pinokio.co',
        statusEl: document.getElementById('logs-report-status'),
        outputEl: document.getElementById('logs-report-output'),
        copyButton: document.getElementById('logs-copy-report'),
        askAiButton: document.getElementById('logs-ask-ai'),
        createDraftButton: document.getElementById('logs-create-draft'),
        draftTitleInput: document.getElementById('logs-draft-title'),
        draftTitleNoteEl: document.getElementById('logs-draft-title-note'),
        runFilterButton: document.getElementById('logs-run-filter'),
        refreshButton: document.getElementById('logs-refresh-report'),
        reportFilesEl: document.getElementById('logs-report-files'),
        reportGeneratedEl: document.getElementById('logs-report-generated'),
        reportSectionsEl: document.getElementById('logs-report-sections'),
        sessionPickerEl: document.getElementById('logs-session-picker'),
        sessionSelectEl: document.getElementById('logs-session-select'),
        draftSizeBadgeEl: document.getElementById('logs-draft-size-badge'),
        draftMeterFillEl: document.getElementById('logs-draft-meter-fill'),
        draftStatusEl: document.getElementById('logs-draft-status'),
        reviewListEl: document.getElementById('logs-redaction-list'),
        reviewFiltersEl: document.getElementById('logs-redaction-filters'),
        reviewCountEl: document.getElementById('logs-redaction-count'),
        workspace: this.workspace,
        workspaceCwd: config.workspaceCwd || ''
      })
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
      this.initCloseButton()
      this.initViewSwitch()
      this.initSidebarWidth()
      this.initSidebarToggle()
      this.initSidebarResizer()
      this.setupPaneHeightManagement()
    }

    initCloseButton() {
      if (!this.closeButton) {
        return
      }
      this.closeButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        try {
          window.parent.postMessage({ type: 'pinokio:close-logs', e: 'pinokio:close-logs' }, window.location.origin)
        } catch (_) {
          window.parent.postMessage({ type: 'pinokio:close-logs', e: 'pinokio:close-logs' }, '*')
        }
      })
    }

    initViewSwitch() {
      if (!this.rootElement) {
        return
      }
      this.viewButtons = Array.from(this.rootElement.querySelectorAll('[data-logs-view]'))
      this.viewButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const view = button.dataset.logsView === 'latest' && this.reportUrl ? 'latest' : 'raw'
          this.setView(view, true)
        })
      })
      this.setView(this.initialView, false)
    }

    setView(view, updateUrl) {
      const nextView = view === 'latest' && this.reportUrl ? 'latest' : 'raw'
      if (this.rootElement) {
        this.rootElement.dataset.view = nextView
      }
      if (Array.isArray(this.viewButtons)) {
        this.viewButtons.forEach((button) => {
          const active = button.dataset.logsView === nextView
          button.classList.toggle('is-active', active)
          button.setAttribute('aria-selected', active ? 'true' : 'false')
          button.tabIndex = active ? 0 : -1
        })
      }
      const latestPanel = document.getElementById('logs-latest-panel')
      const rawPanel = document.getElementById('logs-raw-panel')
      if (latestPanel) {
        latestPanel.hidden = nextView !== 'latest'
      }
      if (rawPanel) {
        rawPanel.hidden = nextView !== 'raw'
      }
      if (nextView === 'latest') {
        if (this.viewer) {
          this.viewer.stop()
        }
        if (this.latestReport) {
          this.latestReport.load(false)
        }
      }
      if (updateUrl) {
        try {
          const url = new URL(window.location.href)
          url.searchParams.set('view', nextView === 'latest' ? 'latest' : 'raw')
          window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
        } catch (_) {}
      }
      this.applyPaneHeight()
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
        const headers = [
          document.querySelector('header.navheader'),
          this.rootElement.querySelector('.logs-page-header')
        ].filter(Boolean)
        if (headers.length > 0) {
          this.headerObserver = new ResizeObserver(apply)
          headers.forEach((header) => this.headerObserver.observe(header))
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
      const pageHeader = this.rootElement.querySelector('.logs-page-header')
      const pageHeaderHeight = pageHeader ? Math.ceil(pageHeader.getBoundingClientRect().height) : 0
      this.rootElement.style.setProperty('--logs-sticky-header-height', `${pageHeaderHeight}px`)
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
