const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "never"
}

const installname = async (url, name, options) => {
  if (url.startsWith("http")) {
    let urlChunks = new URL(url).pathname.split("/")
    let defaultName = urlChunks[urlChunks.length-1]
    if (!defaultName.endsWith(".git")) {
      defaultName = defaultName + ".git"
    }
    const normalizedPath = options && options.path ? normalizeInstallPath(options.path) : null
    const relativePath = normalizedPath || DEFAULT_INSTALL_RELATIVE_PATH
    if (normalizedPath === TASKS_INSTALL_RELATIVE_PATH) {
      return defaultName
    }
    const inputValue = name || defaultName
    let result = await Swal.fire({
      title: 'Save as',
      html: `<p class="pinokio-download-note">Saved in <code>~/${relativePath}</code></p>`,
      input: 'text',
      inputLabel: 'Folder name',
      inputValue,
      inputPlaceholder: defaultName,
      inputAttributes: {
        autocapitalize: 'off',
        autocorrect: 'off',
        autocomplete: 'off',
        spellcheck: 'false'
      },
      focusConfirm: false,
      focusCancel: false,
      showCancelButton: true,
      showCloseButton: true,
      cancelButtonText: 'Cancel',
      confirmButtonText: 'Download',
      buttonsStyling: false,
      backdrop: true,
      width: 'min(460px, 92vw)',
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: true,
      showLoaderOnConfirm: true,
      loaderHtml: '<span class="pinokio-download-loader-spinner" aria-hidden="true"></span><span class="pinokio-download-loader-text">Downloading...</span>',
      customClass: {
        container: 'pinokio-download-container',
        popup: 'pinokio-download-modal',
        htmlContainer: 'pinokio-download-html',
        inputLabel: 'pinokio-download-label',
        input: 'pinokio-download-input',
        validationMessage: 'pinokio-download-validation',
        actions: 'pinokio-download-actions',
        loader: 'pinokio-download-loader',
        closeButton: 'pinokio-download-close',
        confirmButton: 'pinokio-download-confirm',
        cancelButton: 'pinokio-download-cancel'
      },
      didOpen: () => {
        const input = Swal.getInput()
        if (input) {
          input.focus()
          input.select()
        }
      },
      preConfirm: async (value) => {
        const folderName = String(value || "").trim()
        const validationError = validateInstallFolderName(folderName)
        if (validationError) {
          Swal.showValidationMessage(validationError)
          return false
        }
        try {
          const exists = await checkInstallDestinationExists(folderName, options)
          if (exists) {
            Swal.showValidationMessage("Folder already exists. Choose a different name.")
            return false
          }
        } catch (error) {
          Swal.showValidationMessage(error && error.message ? error.message : "Could not check destination folder")
          return false
        }
        return folderName
      }
    })
    return result.value
  } else {
    return null
  }
}
const DEFAULT_INSTALL_RELATIVE_PATH = 'api'
const TASKS_INSTALL_RELATIVE_PATH = 'tasks'
const INLINE_INSTALL_STATUS_ID = 'pinokio-inline-install-status'

const escapeInstallHtml = (value) => {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const INLINE_INSTALL_STATUS_SPINNER_HTML = `
  <span class="pinokio-install-inline-status-spinner" aria-hidden="true">
    <span class="pinokio-install-inline-status-spinner-dot pinokio-install-inline-status-spinner-dot-1"></span>
    <span class="pinokio-install-inline-status-spinner-dot pinokio-install-inline-status-spinner-dot-2"></span>
    <span class="pinokio-install-inline-status-spinner-dot pinokio-install-inline-status-spinner-dot-3"></span>
    <span class="pinokio-install-inline-status-spinner-dot pinokio-install-inline-status-spinner-dot-4"></span>
  </span>`

const getInlineInstallStatusIconHtml = (iconClass) => {
  const normalizedIconClass = String(iconClass || '')
  const isProgressIcon = /\bfa-circle-notch\b/.test(normalizedIconClass) || /\bfa-spin\b/.test(normalizedIconClass)
  if (isProgressIcon) {
    return INLINE_INSTALL_STATUS_SPINNER_HTML
  }
  return `<span class="pinokio-install-inline-status-icon" aria-hidden="true"><i class="${escapeInstallHtml(normalizedIconClass)}"></i></span>`
}

const ensureInlineInstallStatus = () => {
  let status = document.getElementById(INLINE_INSTALL_STATUS_ID)
  if (status) {
    return status
  }
  status = document.createElement('div')
  status.id = INLINE_INSTALL_STATUS_ID
  status.className = 'pinokio-install-inline-status'
  status.hidden = true
  status.setAttribute('aria-live', 'polite')
  const anchor = document.querySelector('.terminal-container') || document.querySelector('main') || document.querySelector('#terminal')?.parentElement || document.body
  if (anchor && anchor !== document.body) {
    anchor.insertAdjacentElement('afterend', status)
  } else {
    document.body.appendChild(status)
  }
  return status
}

const setInlineInstallStatus = ({ state, title, detailHtml, iconClass }) => {
  const status = ensureInlineInstallStatus()
  const normalizedState = state || 'progress'
  status.className = `pinokio-install-inline-status is-${normalizedState}`
  status.innerHTML = `
    <div class="pinokio-install-inline-status-shell">
      ${getInlineInstallStatusIconHtml(iconClass)}
      <div class="pinokio-install-inline-status-copy">
        <div class="pinokio-install-inline-status-title">${escapeInstallHtml(title || '')}</div>
        ${detailHtml ? `<div class="pinokio-install-inline-status-detail">${detailHtml}</div>` : ''}
      </div>
    </div>
  `
  status.hidden = false
  document.body.classList.add('pinokio-install-status-visible')
}

// Ensure the requested install path stays within the Pinokio home directory
const normalizeInstallPath = (rawPath) => {
  if (typeof rawPath !== 'string') {
    return null
  }
  let trimmed = rawPath.trim()
  if (!trimmed) {
    return null
  }
  // drop leading ~/ or any absolute indicators
  trimmed = trimmed.replace(/^~[\\/]?/, '').replace(/^[\\/]+/, '')
  if (!trimmed) {
    return null
  }
  const segments = trimmed.split(/[\\/]+/).filter(Boolean)
  if (!segments.length) {
    return null
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }
  return segments.join('/')
}

const validateInstallFolderName = (folderName) => {
  if (!folderName) {
    return "Name is required"
  }
  if (folderName === "." || folderName === "..") {
    return "Invalid name"
  }
  if (/[\\/]/.test(folderName)) {
    return "Name cannot include / or \\\\"
  }
  if (folderName.includes("\0")) {
    return "Invalid name"
  }
  return null
}

const checkInstallDestinationExists = async (folderName, options) => {
  const normalizedPath = options && options.path ? normalizeInstallPath(options.path) : null
  const relativePath = normalizedPath || DEFAULT_INSTALL_RELATIVE_PATH
  const response = await fetch("/pinokio/install/exists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      relativePath,
      folderName
    })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `Failed to check destination folder (${response.status})`
    throw new Error(message)
  }
  return payload && payload.exists === true
}

const prepareLegacyTaskDownload = async (ref) => {
  const response = await fetch("/launcher/download/prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "ask",
      ref
    })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload && payload.error ? payload.error : "Failed to prepare task install.")
  }
  return payload
}

const finalizeLegacyTaskDownload = async (payload) => {
  const response = await fetch("/launcher/download/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.error ? result.error : "Failed to install task.")
  }
  return result
}

const install = async (name, url, term, socket, options) => {
  console.log("options", options)
  const n = new N()
  const normalizedPath = options && options.path ? normalizeInstallPath(options.path) : null
  const isTaskInstall = normalizedPath === TASKS_INSTALL_RELATIVE_PATH
  const targetPath = normalizedPath ? `~/${normalizedPath}` : `~/${DEFAULT_INSTALL_RELATIVE_PATH}`
  let cloneSpec = null
  let finalizePayload = null

  if (isTaskInstall) {
    setInlineInstallStatus({
      state: 'progress',
      title: 'Importing task...',
      detailHtml: `<p>Downloading into <code>~/${TASKS_INSTALL_RELATIVE_PATH}</code>.</p>`,
      iconClass: 'fa-solid fa-circle-notch fa-spin'
    })
    try {
      const prepared = await prepareLegacyTaskDownload(url)
      if (prepared && prepared.existing && prepared.url) {
        location.href = prepared.url
        return
      }
      cloneSpec = prepared && prepared.clone ? prepared.clone : null
      finalizePayload = prepared && prepared.finalize ? prepared.finalize : null
      if (!cloneSpec || !finalizePayload) {
        throw new Error("Failed to prepare task install.")
      }
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: 'Task import failed',
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : "Failed to prepare task install.")}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : "Failed to prepare task install.",
        timeout: 6000
      })
      return
    }
  } else {
    setInlineInstallStatus({
      state: 'progress',
      title: 'Downloading...',
      detailHtml: `<p>Cloning into <code>${escapeInstallHtml(targetPath)}/${escapeInstallHtml(name)}</code>.</p>`,
      iconClass: 'fa-solid fa-circle-notch fa-spin'
    })

    try {
      const exists = await checkInstallDestinationExists(name, options)
      if (exists) {
        ensureInlineInstallStatus().hidden = true
        document.body.classList.remove('pinokio-install-status-visible')
        n.Noty({
          text: "Folder already exists. Choose a different name.",
          timeout: 6000
        })
        return
      }
    } catch (error) {
      ensureInlineInstallStatus().hidden = true
      document.body.classList.remove('pinokio-install-status-visible')
      n.Noty({
        text: error && error.message ? error.message : "Could not verify destination folder",
        timeout: 6000
      })
      return
    }
  }

  try {
    await new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        fn(value)
      }
      socket.close()

      // normalize git url to the standard .git format
      let branch
      if (options && options.branch) {
        branch = options.branch
      }

      if (!url.endsWith(".git")) {
        url = url + ".git"
      }

      let cmd
      let shellPath = targetPath
      let env = { ...NON_INTERACTIVE_GIT_ENV }
      if (isTaskInstall) {
        cmd = cloneSpec.message
        shellPath = cloneSpec.path
        env = cloneSpec.env || env
      } else if (branch) {
        cmd = `git clone -b ${branch} ${url} ${name}`
      } else {
        cmd = `git clone ${url} ${name}`
      }
      socket.run({
        method: "shell.run",
        client: {
          cols: term.cols,
          rows: term.rows,
        },
        params: {
          message: cmd,
          path: shellPath,
          env
        }
      }, (packet) => {
        if (packet.type === 'stream') {
          term.write(packet.data.raw)
        } else if (packet.type === "result") {
          if (packet.data && packet.data.error && packet.data.error.length > 0) {
            setInlineInstallStatus({
              state: 'error',
              title: 'Download failed',
              detailHtml: '<p>Pinokio could not clone the repository. Check the terminal output for details.</p>',
              iconClass: 'fa-solid fa-triangle-exclamation'
            })
            n.Noty({
              text: "Download failed. See terminal output for details.",
              timeout: 6000
            })
            settle(reject, new Error("shell.run failed"))
            return
          }
          settle(resolve)
        } else if (packet.type === "error") {
          setInlineInstallStatus({
            state: 'error',
            title: 'Download failed',
            detailHtml: `<p>${escapeInstallHtml(typeof packet.data === "string" ? packet.data : "shell.run error")}</p>`,
            iconClass: 'fa-solid fa-triangle-exclamation'
          })
          n.Noty({
            text: packet.data
          })
          settle(reject, new Error(typeof packet.data === "string" ? packet.data : "shell.run error"))
        }
      })
    })
  } catch (_) {
    return
  }

  if (isTaskInstall) {
    try {
      const finalized = await finalizeLegacyTaskDownload(finalizePayload)
      if (!finalized || !finalized.url) {
        throw new Error("Failed to install task.")
      }
      location.href = finalized.url
      return
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: 'Task import failed',
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : "Failed to install task.")}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : "Failed to install task.",
        timeout: 6000
      })
      return
    }
  } else {
    try {
      const cloned = await checkInstallDestinationExists(name, options)
      if (!cloned) {
        setInlineInstallStatus({
          state: 'error',
          title: 'Download failed',
          detailHtml: '<p>Pinokio could not clone the repository.</p>',
          iconClass: 'fa-solid fa-triangle-exclamation'
        })
        n.Noty({
          text: "Download failed.",
          timeout: 6000
        })
        return
      }
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: 'Download failed',
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : "Could not verify destination folder")}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : "Could not verify destination folder",
        timeout: 6000
      })
      return
    }
  }

  /*
    options := {
      html,
      href,
      action: "close"
    }
  */

  if (options && options.html) {
    n.Noty({
      text: options.html,
      callbacks: {
        onClose: () => {
          let uri = options.uri || options.href
          if (uri) {
            let target = options.target || "_self"
            let features = options.features
            window.open(uri, target, features)
          } else if (options.action === "close") {
            window.close()
          }
        }
      }
    })
  } else {
    const shouldInitialize = !normalizedPath || normalizedPath === DEFAULT_INSTALL_RELATIVE_PATH
    if (shouldInitialize) {
      // ask the backend to create install.json and start.json if gradio
      //location.href = `/pinokio/browser/${name}`
      location.href = `/initialize/${name}`
    } else {
      n.Noty({
        text: `Downloaded to ~/${normalizedPath}/${name}`,
        timeout: 4000
      })
      const relativePluginPath = `${normalizedPath}/${name}`
      location.href = `/plugin?path=${encodeURIComponent(relativePluginPath)}&downloaded=1`
    }
  }
}
const createTerm = async (_theme) => {
  const theme = Object.assign({ }, _theme, {
    selectionBackground: "red",
    selectionForeground: "white"
  })
  let config = {
    scrollback: 9999999,
    fontSize: 12,
    fontFamily: 'monospace',
    theme,
  }
  let res = await fetch("/xterm_config").then((res) => {
    return res.json()
  })
  if (res && res.config) {
    config = res.config
  }
  const baseConfig = Object.assign({}, config)
  if (window.PinokioTerminalSettings && typeof window.PinokioTerminalSettings.applyToConfig === 'function') {
    config = window.PinokioTerminalSettings.applyToConfig(config)
  }
  const term = new Terminal(config)
  if (window.PinokioTerminalSettings && typeof window.PinokioTerminalSettings.register === 'function') {
    window.PinokioTerminalSettings.register(term, { baseConfig })
  }
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  document.querySelector("#terminal").classList.remove("hidden")
  document.querySelector("#terminal").classList.add("expanded")
  term.open(document.querySelector("#terminal"))
  fitAddon.fit();
  return term
}
