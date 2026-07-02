(function() {
  const TOP_LEVEL_REDACTION_MAX_FILE_BYTES = 2 * 1024 * 1024
  const TOP_LEVEL_REDACTION_EXTENSIONS = new Set(['.json', '.log', '.txt'])
  const CADDY_LOG_PATTERN = /^caddy(?:-.+)?\.log$/i

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

  const extensionForPath = (value) => {
    const text = String(value || '').toLowerCase()
    const index = text.lastIndexOf('.')
    return index >= 0 ? text.slice(index) : ''
  }

  const isTopLevelRedactableLogPath = (value) => {
    const text = String(value || '').trim()
    return Boolean(
      text &&
      !text.startsWith('.') &&
      !text.includes('/') &&
      !text.includes('\\') &&
      !CADDY_LOG_PATTERN.test(text) &&
      TOP_LEVEL_REDACTION_EXTENSIONS.has(extensionForPath(text))
    )
  }

  const TOP_LEVEL_REDACTION_PRIORITY = new Map([
    ['system.json', 0],
    ['state.json', 1],
    ['stdout.txt', 2],
    ['fatal.json', 3]
  ])

  function topLevelRedactionSortValue(entry) {
    const pathValue = String(entry && (entry.path || entry.name) || '')
    const name = pathValue.split('/').pop().toLowerCase()
    if (TOP_LEVEL_REDACTION_PRIORITY.has(name)) {
      return TOP_LEVEL_REDACTION_PRIORITY.get(name)
    }
    const extension = extensionForPath(name)
    if (extension === '.json') return 10
    if (extension === '.txt') return 20
    if (extension === '.log') return 30
    return 40
  }

  function compareTopLevelRedactionEntries(a, b) {
    const priorityDiff = topLevelRedactionSortValue(a) - topLevelRedactionSortValue(b)
    if (priorityDiff !== 0) return priorityDiff
    const sizeDiff = (Number(a && a.size) || 0) - (Number(b && b.size) || 0)
    if (sizeDiff !== 0) return sizeDiff
    return String(a && (a.path || a.name) || '').localeCompare(String(b && (b.path || b.name) || ''))
  }

  class LogsTopLevelRedactor {
    constructor(options) {
      this.button = options.button
      this.chip = options.chip
      this.pane = options.pane
      this.collapseButton = options.collapseButton
      this.statusEl = options.statusEl
      this.countEl = options.countEl
      this.filesEl = options.filesEl
      this.filtersEl = options.filtersEl
      this.listEl = options.listEl
      this.viewer = options.viewer || null
      this.tree = options.tree || null
      this.onLayoutChange = typeof options.onLayoutChange === 'function' ? options.onLayoutChange : () => {}
      this.onRunningChange = typeof options.onRunningChange === 'function' ? options.onRunningChange : () => {}
      this.privacyFilter = options.privacyFilter
      if (!this.privacyFilter) {
        throw new Error('LogsTopLevelRedactor requires privacyFilter')
      }
      this.files = []
      this.items = []
      this.activeFilter = 'all'
      this.selectedItemId = null
      this.selectedPath = ''
      this.hasRun = false
      this.isOpen = false
      this.isRunning = false
      if (this.button) {
        this.button.addEventListener('click', () => this.handleRedactClick())
      }
      if (this.chip) {
        this.chip.addEventListener('click', () => this.setOpen(true))
      }
      if (this.collapseButton) {
        this.collapseButton.addEventListener('click', () => this.setOpen(false))
      }
      this.renderEmptyReview()
      this.updateChip()
    }
    handleRedactClick() {
      if (this.isRunning) {
        return
      }
      if (this.hasRun && !this.isOpen) {
        this.setOpen(true)
        return
      }
      this.run()
    }
    setOpen(open) {
      this.isOpen = Boolean(open)
      if (this.pane) {
        this.pane.classList.toggle('hidden', !this.isOpen)
      }
      if (this.chip) {
        this.chip.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false')
      }
      if (this.isOpen && this.hasRun) {
        this.renderPreview()
      }
      this.onLayoutChange()
    }
    setBusy(isBusy) {
      this.isRunning = Boolean(isBusy)
      this.onRunningChange(this.isRunning)
      if (!this.button) {
        return
      }
      this.button.disabled = this.isRunning
      if (this.isRunning) {
        this.button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Redacting…</span>'
      } else {
        this.button.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Redact</span>'
      }
    }
    setStatus(message, isError) {
      if (this.statusEl) {
        this.statusEl.textContent = message || ''
        this.statusEl.classList.toggle('is-error', Boolean(isError))
      }
    }
    updateCount() {
      if (!this.countEl) {
        return
      }
      if (!this.hasRun && !this.isRunning) {
        this.countEl.textContent = 'Not run'
        return
      }
      const files = this.files.filter((file) => file.reviewed).length
      const total = this.files.length
      const enabled = this.enabledRedactionCount()
      this.countEl.textContent = this.isRunning
        ? `${files} / ${total} files · ${enabled} masked`
        : `${files} file${files === 1 ? '' : 's'} · ${enabled} masked`
    }
    updateChip() {
      if (!this.chip) {
        return
      }
      const labelEl = this.chip.querySelector('span') || this.chip
      if (!this.hasRun && !this.isRunning) {
        this.chip.classList.add('hidden')
        labelEl.textContent = 'Not run'
        return
      }
      const files = this.files.filter((file) => file.reviewed).length
      const total = this.files.length
      const enabled = this.enabledRedactionCount()
      labelEl.textContent = this.isRunning
        ? `Redacting ${files}/${total} · ${enabled} item${enabled === 1 ? '' : 's'}`
        : `Redacted ${files} file${files === 1 ? '' : 's'} · ${enabled} item${enabled === 1 ? '' : 's'}`
      this.chip.classList.remove('hidden')
    }
    enabledRedactionCount() {
      return this.items.reduce((total, item) => total + (item && item.enabled ? 1 : 0), 0)
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
    normalizeItems(file, result) {
      const text = String(file && file.text || '')
      const pathValue = String(file && file.path || '')
      const items = (Array.isArray(result && result.items) ? result.items : [])
        .map((item, index) => {
          const sourceStart = Number(item.sourceStart != null ? item.sourceStart : item.maskedStart)
          const sourceEnd = Number(item.sourceEnd != null ? item.sourceEnd : item.maskedEnd)
          if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart || sourceStart < 0 || sourceEnd > text.length) {
            return null
          }
          const label = String(item.label || 'private')
          return {
            id: `${pathValue}:${item.id != null ? item.id : index}`,
            path: pathValue,
            label,
            sourceStart,
            sourceEnd,
            replacement: item.replacement || `[${label}]`,
            enabled: item.enabled !== false,
            line: this.lineForOffset(text, sourceStart),
            context: this.lineContext(text, sourceStart, sourceEnd)
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd)
      const nonOverlapping = []
      let cursor = 0
      for (const item of items) {
        if (item.sourceStart < cursor) {
          continue
        }
        nonOverlapping.push(item)
        cursor = item.sourceEnd
      }
      return nonOverlapping
    }
    buildFileText(file) {
      const text = String(file && file.text || '')
      const items = (file && Array.isArray(file.items) ? file.items : [])
        .filter((item) => item && item.path === file.path)
        .sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd)
      let cursor = 0
      let output = ''
      const renderedItems = []
      for (const item of items) {
        if (item.sourceStart < cursor) {
          continue
        }
        if (item.sourceStart > cursor) {
          output += text.slice(cursor, item.sourceStart)
        }
        const replacement = item.enabled ? item.replacement : text.slice(item.sourceStart, item.sourceEnd)
        const maskedStart = output.length
        output += replacement
        const maskedEnd = output.length
        renderedItems.push({
          ...item,
          maskedStart,
          maskedEnd,
          line: this.lineForOffset(output, maskedStart),
          context: this.lineContext(output, maskedStart, maskedEnd)
        })
        cursor = item.sourceEnd
      }
      if (cursor < text.length) {
        output += text.slice(cursor)
      }
      file.renderedItems = renderedItems
      return output
    }
    async fetchTopLevelEntries() {
      const url = new URL('/api/logs/tree', window.location.origin)
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `HTTP ${response.status}`)
      }
      const payload = await response.json()
      const entries = (Array.isArray(payload && payload.entries) ? payload.entries : [])
        .filter((entry) => entry && entry.type !== 'directory' && isTopLevelRedactableLogPath(entry.path || entry.name))
        .sort(compareTopLevelRedactionEntries)
      const oversized = entries.find((entry) => Number.isFinite(Number(entry.size)) && Number(entry.size) > TOP_LEVEL_REDACTION_MAX_FILE_BYTES)
      if (oversized) {
        const name = oversized.path || oversized.name || 'file'
        throw new Error(`${name} is too large to redact in the browser (${humanBytes(Number(oversized.size))}).`)
      }
      return entries
    }
    async fetchFile(entry) {
      const pathValue = String(entry && (entry.path || entry.name) || '')
      const url = new URL('/pinokio/logs/file', window.location.origin)
      url.searchParams.set('path', pathValue)
      const response = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Failed to read ${pathValue}`)
      }
      const payload = await response.json()
      return {
        path: payload.path || pathValue,
        name: payload.name || pathValue,
        size: Number(payload.size) || Number(entry && entry.size) || 0,
        text: String(payload.text || ''),
        reviewed: false,
        items: [],
        renderedItems: []
      }
    }
    renderFilterProgress(file, progress) {
      if (!progress || typeof progress !== 'object') {
        return
      }
      const name = file && file.name ? file.name : 'file'
      if (progress.type === 'runtime') {
        this.setStatus(`Loading privacy filter locally (${progress.device}/${progress.dtype}) for ${name}.`)
      } else if (progress.type === 'download') {
        this.setStatus(progress.total
          ? `Downloading privacy filter: ${humanBytes(progress.loaded)} / ${humanBytes(progress.total)}.`
          : 'Downloading privacy filter.')
      } else if (progress.type === 'chunk') {
        const total = Number(progress.total) || 0
        const done = Number(progress.done) || 0
        this.setStatus(total > 0 ? `Filtering ${name}… ${Math.min(done + 1, total)} / ${total} chunks.` : `Filtering ${name}…`)
      } else if (progress.type === 'fallback') {
        this.setStatus(progress.message || `Retrying ${name} locally with ${progress.device}/${progress.dtype}.`)
      }
    }
    async run() {
      this.setOpen(true)
      this.setBusy(true)
      this.hasRun = false
      this.files = []
      this.items = []
      this.selectedItemId = null
      this.activeFilter = 'all'
      this.updateCount()
      this.updateChip()
      this.renderEmptyReview('Preparing top-level files…')
      try {
        this.setStatus('Finding top-level files…')
        const entries = await this.fetchTopLevelEntries()
        if (!entries.length) {
          throw new Error('No top-level text log files are available for redaction.')
        }
        const files = []
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]
          this.setStatus(`Loading ${entry.path || entry.name}… ${index + 1} / ${entries.length}`)
          const file = await this.fetchFile(entry)
          files.push(file)
        }
        this.files = files
        this.selectedPath = files[0] ? files[0].path : ''
        this.renderFileList()
        this.renderReview()
        this.updateCount()
        this.updateChip()
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index]
          this.setStatus(`Filtering ${file.name}… ${index + 1} / ${files.length}`)
          const result = await this.privacyFilter.filter(file.text, (progress) => this.renderFilterProgress(file, progress))
          file.items = this.normalizeItems(file, result)
          file.reviewed = true
          this.buildFileText(file)
          this.items = files.flatMap((candidate) => candidate.items)
          this.hasRun = true
          if (!this.selectedPath || !this.files.find((candidate) => candidate.path === this.selectedPath && candidate.reviewed)) {
            this.selectedPath = file.path
          }
          if (!this.selectedItemId && file.items.length) {
            this.selectedItemId = file.items[0].id
          }
          this.renderFileList()
          this.renderReview()
          this.renderPreview()
          this.updateCount()
          this.updateChip()
        }
        this.items = files.flatMap((file) => file.items)
        this.hasRun = true
        this.selectedPath = this.selectedPath || (files[0] ? files[0].path : '')
        this.selectedItemId = this.items.length ? this.items[0].id : null
        this.renderFileList()
        this.renderReview()
        this.renderPreview()
        this.updateCount()
        this.updateChip()
        const enabled = this.enabledRedactionCount()
        this.setStatus(`Privacy filter finished. ${enabled} item${enabled === 1 ? '' : 's'} masked across ${files.length} top-level file${files.length === 1 ? '' : 's'}.`)
      } catch (error) {
        this.files = []
        this.items = []
        this.hasRun = false
        this.selectedPath = ''
        this.selectedItemId = null
        this.renderEmptyReview('No redaction review is available.')
        this.updateCount()
        this.updateChip()
        this.setStatus(error && error.message ? error.message : 'Privacy filtering failed.', true)
      } finally {
        this.setBusy(false)
        this.updateCount()
        this.updateChip()
      }
    }
    renderEmptyReview(message = 'Run Redact to review detected items.') {
      if (this.filesEl) {
        this.filesEl.textContent = ''
      }
      if (this.filtersEl) {
        this.filtersEl.textContent = ''
      }
      if (this.listEl) {
        this.listEl.textContent = ''
        const empty = document.createElement('div')
        empty.className = 'logs-redaction-empty'
        empty.textContent = message
        this.listEl.appendChild(empty)
      }
    }
    renderFileList() {
      if (!this.filesEl) {
        return
      }
      this.filesEl.textContent = ''
      this.files.forEach((file) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'logs-top-redaction-file'
        row.classList.toggle('is-active', file.path === this.selectedPath)
        row.setAttribute('aria-label', `Preview redacted ${file.name}`)
        const text = document.createElement('span')
        text.className = 'logs-top-redaction-file-text'
        const name = document.createElement('span')
        name.className = 'logs-top-redaction-file-name'
        name.textContent = file.name
        const meta = document.createElement('span')
        meta.className = 'logs-top-redaction-file-meta'
        const count = file.items.reduce((total, item) => total + (item.enabled ? 1 : 0), 0)
        meta.textContent = file.reviewed
          ? `${humanBytes(file.size)} · ${count} masked`
          : `${humanBytes(file.size)} · pending`
        text.appendChild(name)
        text.appendChild(meta)
        row.appendChild(text)
        row.addEventListener('click', () => {
          this.selectedPath = file.path
          this.renderFileList()
          this.renderPreview()
        })
        this.filesEl.appendChild(row)
      })
    }
    renderReview() {
      const includedItems = this.items
      const labels = new Map()
      includedItems.forEach((item) => labels.set(item.label, (labels.get(item.label) || 0) + 1))
      if (this.filtersEl) {
        this.filtersEl.textContent = ''
        const filters = [['all', `All ${includedItems.length}`], ...Array.from(labels.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => [label, `${label} ${count}`])]
        filters.forEach(([value, label]) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'logs-redaction-filter'
          button.classList.toggle('is-active', this.activeFilter === value)
          button.textContent = label
          button.addEventListener('click', () => {
            this.activeFilter = value
            this.renderReview()
          })
          this.filtersEl.appendChild(button)
        })
      }
      if (!this.listEl) {
        return
      }
      this.listEl.textContent = ''
      const visibleItems = this.activeFilter === 'all'
        ? includedItems
        : includedItems.filter((item) => item.label === this.activeFilter)
      if (!visibleItems.length) {
        const empty = document.createElement('div')
        empty.className = 'logs-redaction-empty'
        empty.textContent = this.hasRun ? 'No redactions match this filter.' : 'Run Redact to review detected items.'
        this.listEl.appendChild(empty)
        return
      }
      const renderedById = new Map()
      this.files.forEach((file) => {
        this.buildFileText(file)
        ;(file.renderedItems || []).forEach((item) => renderedById.set(item.id, item))
      })
      visibleItems.forEach((item) => {
        const rendered = renderedById.get(item.id) || item
        const row = document.createElement('div')
        row.className = 'logs-redaction-row'
        row.dataset.redactionId = item.id
        row.classList.toggle('is-selected', this.selectedItemId === item.id)
        row.classList.toggle('is-disabled', !item.enabled)
        row.tabIndex = 0
        row.setAttribute('role', 'button')
        row.setAttribute('aria-current', this.selectedItemId === item.id ? 'true' : 'false')
        row.addEventListener('click', () => this.selectItem(item.id, true))
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.selectItem(item.id, true)
          }
        })

        const top = document.createElement('div')
        top.className = 'logs-redaction-row-top'
        const meta = document.createElement('div')
        meta.className = 'logs-redaction-row-meta'
        const label = document.createElement('span')
        label.className = 'logs-redaction-label'
        label.textContent = item.label
        const source = document.createElement('span')
        source.className = 'logs-redaction-source'
        source.textContent = `${item.path} · line ${rendered.line || item.line}`
        source.title = source.textContent
        meta.appendChild(label)
        meta.appendChild(source)

        const toggle = document.createElement('label')
        toggle.className = 'logs-redaction-toggle'
        toggle.title = item.enabled ? 'Keep this item masked' : 'Show this item in the generated zip'
        toggle.addEventListener('click', (event) => event.stopPropagation())
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = item.enabled
        checkbox.setAttribute('aria-label', `${item.enabled ? 'Mask' : 'Show'} ${item.label}`)
        checkbox.addEventListener('click', (event) => event.stopPropagation())
        checkbox.addEventListener('change', (event) => {
          event.stopPropagation()
          item.enabled = checkbox.checked
          this.selectedItemId = item.id
          this.renderFileList()
          this.renderReview()
          this.renderPreview()
          this.updateCount()
          this.updateChip()
        })
        const toggleTrack = document.createElement('span')
        toggleTrack.className = 'logs-redaction-toggle-track'
        toggle.appendChild(checkbox)
        toggle.appendChild(toggleTrack)

        const context = document.createElement('div')
        context.className = 'logs-redaction-context'
        context.textContent = rendered.context || item.context || ''
        context.title = context.textContent

        top.appendChild(meta)
        top.appendChild(toggle)
        row.appendChild(top)
        row.appendChild(context)
        this.listEl.appendChild(row)
      })
    }
    selectItem(id, scrollPreview) {
      this.selectedItemId = id == null ? null : String(id)
      const item = this.items.find((candidate) => candidate.id === this.selectedItemId)
      if (item) {
        this.selectedPath = item.path
      }
      this.renderFileList()
      this.renderPreview()
      this.renderReviewSelection()
      if (scrollPreview && this.viewer && this.viewer.outputEl && this.selectedItemId) {
        const token = Array.from(this.viewer.outputEl.querySelectorAll('.logs-mask-token, .logs-unmasked-token')).find((node) => {
          return node.dataset.redactionId === this.selectedItemId
        })
        if (token) {
          token.scrollIntoView({ block: 'center' })
        }
      }
    }
    renderReviewSelection() {
      if (this.listEl) {
        this.listEl.querySelectorAll('.logs-redaction-row').forEach((node) => {
          const selected = node.dataset.redactionId === this.selectedItemId
          node.classList.toggle('is-selected', selected)
          node.setAttribute('aria-current', selected ? 'true' : 'false')
        })
      }
      if (this.viewer && this.viewer.outputEl) {
        this.viewer.outputEl.querySelectorAll('.logs-mask-token, .logs-unmasked-token').forEach((node) => {
          node.classList.toggle('is-selected', node.dataset.redactionId === this.selectedItemId)
        })
      }
    }
    renderHighlightedOutput(outputEl, text, items) {
      if (!outputEl) {
        return
      }
      outputEl.textContent = ''
      if (!text) {
        return
      }
      if (!items || !items.length) {
        outputEl.textContent = text
        return
      }
      let cursor = 0
      items.forEach((item) => {
        if (item.maskedStart < cursor) {
          return
        }
        if (item.maskedStart > cursor) {
          outputEl.appendChild(document.createTextNode(text.slice(cursor, item.maskedStart)))
        }
        const token = document.createElement('span')
        token.className = item.enabled ? 'logs-mask-token' : 'logs-unmasked-token'
        token.dataset.redactionId = item.id
        token.textContent = text.slice(item.maskedStart, item.maskedEnd)
        token.title = `${item.enabled ? 'Masked' : 'Visible'} ${item.label} · line ${item.line}`
        outputEl.appendChild(token)
        cursor = item.maskedEnd
      })
      if (cursor < text.length) {
        outputEl.appendChild(document.createTextNode(text.slice(cursor)))
      }
    }
    renderPreview() {
      if (!this.viewer || (!this.hasRun && !this.files.some((entry) => entry.reviewed))) {
        return
      }
      const file = this.files.find((entry) => entry.path === this.selectedPath && entry.reviewed)
        || this.files.find((entry) => entry.reviewed)
      if (!file || !file.reviewed) {
        return
      }
      this.selectedPath = file.path
      this.viewer.stop()
      this.viewer.currentPath = file.path
      this.viewer.updatePath(file.path)
      this.viewer.setStatus(`Reviewed browser redaction preview for ${file.name}.`)
      if (this.viewer.clearButton) {
        this.viewer.clearButton.disabled = false
      }
      const text = this.buildFileText(file)
      this.renderHighlightedOutput(this.viewer.outputEl, text, file.renderedItems || [])
      this.renderReviewSelection()
      if (this.tree) {
        this.tree.setActiveFile(file.path)
      }
    }
    handleFileSelection(entry) {
      if (!this.hasRun || !this.isOpen || !entry || !entry.path) {
        return false
      }
      const file = this.files.find((candidate) => candidate.path === entry.path)
      if (!file) {
        return false
      }
      this.selectedPath = file.path
      this.renderFileList()
      this.renderPreview()
      return true
    }
    getArchiveBlockMessage() {
      return this.isRunning
        ? 'Privacy filter is still reviewing top-level files. Generate zip after redaction finishes.'
        : ''
    }
    buildArchivePayload() {
      if (this.isRunning) {
        return null
      }
      if (!this.hasRun) {
        return null
      }
      const overrides = this.files
        .filter((file) => file.reviewed && isTopLevelRedactableLogPath(file.path))
        .map((file) => {
          const text = this.buildFileText(file)
          return {
            path: file.path,
            text
          }
        })
      if (!overrides.length) {
        return null
      }
      return {
        redacted_overrides: overrides
      }
    }
  }

  function mountLogsTopLevelRedactor(options) {
    const button = document.getElementById('logs-redact-top-level')
    if (!button) {
      return null
    }
    return new LogsTopLevelRedactor({
      button,
      chip: document.getElementById('logs-redaction-chip'),
      pane: document.getElementById('logs-top-redaction-pane'),
      collapseButton: document.getElementById('logs-redaction-collapse'),
      statusEl: document.getElementById('logs-top-redaction-status'),
      countEl: document.getElementById('logs-top-redaction-count'),
      filesEl: document.getElementById('logs-top-redaction-files'),
      filtersEl: document.getElementById('logs-top-redaction-filters'),
      listEl: document.getElementById('logs-top-redaction-list'),
      viewer: options.viewer,
      tree: options.tree,
      privacyFilter: options.privacyFilter,
      onLayoutChange: options.onLayoutChange,
      onRunningChange: options.onRunningChange
    })
  }


  window.LogsTopLevelRedactor = LogsTopLevelRedactor
  window.mountLogsTopLevelRedactor = mountLogsTopLevelRedactor
  window.LogsTopLevelRedaction = {
    isTopLevelRedactableLogPath,
    maxFileBytes: TOP_LEVEL_REDACTION_MAX_FILE_BYTES
  }
})()
