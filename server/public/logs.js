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

  const withQueryParam = (href, key, value) => {
    try {
      const url = new URL(href, window.location.origin)
      url.searchParams.set(key, value)
      return `${url.pathname}${url.search}${url.hash}`
    } catch (_) {
      return href
    }
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

  class LogsLatestReport {
    constructor(options) {
      this.reportUrl = options.reportUrl || ''
      this.rawReportUrl = this.reportUrl ? withQueryParam(this.reportUrl, 'redaction', 'none') : ''
      this.statusEl = options.statusEl
      this.outputEl = options.outputEl
      this.copyButton = options.copyButton
      this.runFilterButton = options.runFilterButton
      this.refreshButton = options.refreshButton
      this.reportFilesEl = options.reportFilesEl
      this.reportGeneratedEl = options.reportGeneratedEl
      this.reportSectionsEl = options.reportSectionsEl
      this.reviewListEl = options.reviewListEl
      this.reviewFiltersEl = options.reviewFiltersEl
      this.reviewCountEl = options.reviewCountEl
      this.privacyFilter = options.privacyFilter || new PrivacyFilterClient()
      this.report = null
      this.rawMarkdown = ''
      this.currentMarkdown = ''
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.filterChunks = 0
      this.redactionHasRun = false
      this.filtering = false
      this.activeRedactionFilter = 'all'
      this.selectedRedactionId = null
      this.filterToken = 0
      this.loading = false

      if (this.copyButton) {
        this.copyButton.addEventListener('click', () => this.copy())
      }
      if (this.runFilterButton) {
        this.runFilterButton.addEventListener('click', () => this.filterReport())
      }
      if (this.refreshButton) {
        this.refreshButton.addEventListener('click', () => this.load(true))
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
    renderReportFiles(sections) {
      this.clearReportFiles()
      if (!this.reportFilesEl) return
      for (const section of sections || []) {
        const item = document.createElement('div')
        item.className = 'logs-review-file'
        item.textContent = section.file || section.script || section.source || 'log'
        item.title = item.textContent
        this.reportFilesEl.appendChild(item)
      }
      if (!sections || !sections.length) {
        const empty = document.createElement('div')
        empty.className = 'logs-review-empty'
        empty.textContent = 'No latest files found.'
        this.reportFilesEl.appendChild(empty)
      }
    }
    renderSummary(payload) {
      const sections = Array.isArray(payload && payload.sections) ? payload.sections : []
      if (this.reportSectionsEl) {
        this.reportSectionsEl.textContent = String(sections.length)
      }
      if (this.reportGeneratedEl) {
        this.reportGeneratedEl.textContent = this.formatGenerated(payload && payload.generated_at)
      }
      this.renderReportFiles(sections)
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
      if (!this.runFilterButton) return
      this.runFilterButton.disabled = this.filtering || !this.rawMarkdown
      this.runFilterButton.classList.toggle('is-busy', this.filtering)
      if (this.filtering) {
        this.runFilterButton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Filtering…</span>'
      } else {
        this.runFilterButton.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Run privacy filter</span>'
      }
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
      const text = this.rawMarkdown || ''
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
    renderCurrentReport() {
      this.buildCurrentReport()
      const text = this.currentMarkdown || 'No latest app logs were found.'
      this.renderHighlightedOutput(text, this.renderedRedactionItems)
      this.renderRedactionReview()
      this.updateRedactionCount()
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
      const outputRect = this.outputEl.getBoundingClientRect()
      const tokenRect = token.getBoundingClientRect()
      const nextTop = this.outputEl.scrollTop + tokenRect.top - outputRect.top - Math.round(outputRect.height * 0.35)
      this.outputEl.scrollTo({
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
      this.currentMarkdown = this.rawMarkdown
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.filterChunks = 0
      this.redactionHasRun = false
      this.filtering = false
      this.selectedRedactionId = null
      this.activeRedactionFilter = 'all'
      this.setCopyEnabled(Boolean(this.rawMarkdown))
      this.setRunFilterEnabled(Boolean(this.rawMarkdown))
      this.setOutputText(this.rawMarkdown || 'No latest app logs were found.')
      this.resetRedactionReview(this.rawMarkdown ? 'Run the privacy filter to review detected items.' : 'No report text to review.')
      this.updateRedactionCount()
      if (!this.rawMarkdown) {
        this.setStatus(`Latest snapshot found ${sections.length} log section${sections.length === 1 ? '' : 's'}.`)
        return
      }
      this.setStatus(`Latest snapshot built from ${sections.length} log section${sections.length === 1 ? '' : 's'}. Run the privacy filter only if you want local redaction review.`)
    }
    renderError(message) {
      if (this.reportSectionsEl) this.reportSectionsEl.textContent = '--'
      if (this.reportGeneratedEl) this.reportGeneratedEl.textContent = '--'
      this.clearReportFiles()
      this.rawMarkdown = ''
      this.currentMarkdown = ''
      this.redactionHasRun = false
      this.filtering = false
      this.setOutputText(message || 'Unable to build latest log snapshot.')
      this.resetRedactionReview('No redaction review is available.')
      this.setCopyEnabled(false)
      this.setRunFilterEnabled(false)
      this.setStatus(message || 'Unable to build latest log snapshot.', true)
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
      this.currentMarkdown = this.rawMarkdown
      this.selectedRedactionId = null
      this.setCopyEnabled(Boolean(this.currentMarkdown))
      this.setRunFilterEnabled(Boolean(this.rawMarkdown))
      this.setOutputText(this.rawMarkdown || 'Privacy filter failed. No report text is available.')
      this.resetRedactionReview('Privacy filtering failed before any redactions could be reviewed.')
      this.setStatus(error && error.message ? error.message : 'Privacy filter failed.', true)
    }
    async filterReport() {
      if (!this.rawMarkdown || this.filtering) {
        return
      }
      const token = this.filterToken + 1
      this.filterToken = token
      this.setFiltering(true)
      this.setCopyEnabled(false)
      try {
        const result = await this.privacyFilter.filter(this.rawMarkdown, (progress) => {
          if (token === this.filterToken) {
            this.renderFilterProgress(progress)
          }
        })
        if (token !== this.filterToken) {
          return
        }
        this.redactionItems = this.normalizeRedactionItems(result && result.items, this.rawMarkdown)
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
        this.renderError('Latest log snapshot is available for app workspaces.')
        return
      }
      if (this.report && !force) {
        this.renderSummary(this.report)
        this.renderCurrentReport()
        this.setRunFilterEnabled(Boolean(this.rawMarkdown) && !this.filtering)
        if (!this.redactionHasRun && this.rawMarkdown) {
          this.setStatus('Unfiltered report is ready. Run the privacy filter only if you want local redaction review.')
        }
        return
      }
      if (this.loading) return
      this.loading = true
      this.setBusy(true)
      this.setStatus('Building latest log snapshot…')
      this.filterToken += 1
      this.rawMarkdown = ''
      this.currentMarkdown = ''
      this.redactionItems = []
      this.renderedRedactionItems = []
      this.redactionHasRun = false
      this.selectedRedactionId = null
      this.activeRedactionFilter = 'all'
      this.resetRedactionReview('Waiting for latest log snapshot.')
      this.setCopyEnabled(false)
      this.setFiltering(false)
      try {
        const response = await fetch(this.rawReportUrl || this.reportUrl, {
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
      this.latestReport = new LogsLatestReport({
        reportUrl: this.reportUrl,
        statusEl: document.getElementById('logs-report-status'),
        outputEl: document.getElementById('logs-report-output'),
        copyButton: document.getElementById('logs-copy-report'),
        runFilterButton: document.getElementById('logs-run-filter'),
        refreshButton: document.getElementById('logs-refresh-report'),
        reportFilesEl: document.getElementById('logs-report-files'),
        reportGeneratedEl: document.getElementById('logs-report-generated'),
        reportSectionsEl: document.getElementById('logs-report-sections'),
        reviewListEl: document.getElementById('logs-redaction-list'),
        reviewFiltersEl: document.getElementById('logs-redaction-filters'),
        reviewCountEl: document.getElementById('logs-redaction-count')
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
