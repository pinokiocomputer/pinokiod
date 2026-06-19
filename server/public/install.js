const installT = (key, fallback, replacements = {}) => {
  const fn = typeof window !== "undefined" && typeof window.pinokioT === "function" ? window.pinokioT : null
  if (fn) {
    return fn(key, fallback, replacements)
  }
  const catalog = typeof window !== "undefined" && window.PINOKIO_I18N && typeof window.PINOKIO_I18N === "object" ? window.PINOKIO_I18N : {}
  let value = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : `[missing translation: ${key}]`
  if (typeof value !== "string") {
    value = `[missing translation: ${key}]`
  }
  Object.entries(replacements || {}).forEach(([name, replacement]) => {
    value = value.replace(new RegExp(`\\{${name}\\}`, "g"), replacement == null ? "" : String(replacement))
  })
  return value
}

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
      title: installT("install.save_as", "Save as"),
      html: `<p class="pinokio-download-note">${escapeInstallHtml(installT("install.saved_in", "Saved in"))} <code>~/${escapeInstallHtml(relativePath)}</code></p>`,
      input: 'text',
      inputLabel: installT("install.folder_name", "Folder name"),
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
      cancelButtonText: installT("common.cancel", "Cancel"),
      confirmButtonText: installT("common.download", "Download"),
      buttonsStyling: false,
      backdrop: 'rgba(9, 11, 15, 0.65)',
      width: 'min(460px, 92vw)',
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: true,
      showLoaderOnConfirm: true,
      loaderHtml: `<span class="pinokio-download-loader-spinner" aria-hidden="true"></span><span class="pinokio-download-loader-text">${escapeInstallHtml(installT("terminal.downloading_ellipsis", "Downloading..."))}</span>`,
      customClass: {
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
            Swal.showValidationMessage(installT("install.folder_exists_choose_different", "Folder already exists. Choose a different name."))
            return false
          }
        } catch (error) {
          Swal.showValidationMessage(error && error.message ? error.message : installT("install.could_not_check_destination", "Could not check destination folder"))
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
      <span class="pinokio-install-inline-status-icon" aria-hidden="true"><i class="${iconClass}"></i></span>
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
    return installT("install.name_required", "Name is required")
  }
  if (folderName === "." || folderName === "..") {
    return installT("install.invalid_name", "Invalid name")
  }
  if (/[\\/]/.test(folderName)) {
    return installT("install.name_no_slashes", "Name cannot include / or \\\\")
  }
  if (folderName.includes("\0")) {
    return installT("install.invalid_name", "Invalid name")
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
    const message = payload && payload.error ? payload.error : installT("install.failed_check_destination_status", "Failed to check destination folder ({status})", { status: response.status })
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
    throw new Error(payload && payload.error ? payload.error : installT("tasks.failed_prepare_install", "Failed to prepare task install."))
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
    throw new Error(result && result.error ? result.error : installT("tasks.failed_install", "Failed to install task."))
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
      title: installT("install.importing_task_ellipsis", "Importing task..."),
      detailHtml: `<p>${escapeInstallHtml(installT("install.downloading_into", "Downloading into"))} <code>~/${TASKS_INSTALL_RELATIVE_PATH}</code>.</p>`,
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
        throw new Error(installT("tasks.failed_prepare_install", "Failed to prepare task install."))
      }
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: installT("install.task_import_failed", "Task import failed"),
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : installT("tasks.failed_prepare_install", "Failed to prepare task install."))}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : installT("tasks.failed_prepare_install", "Failed to prepare task install."),
        timeout: 6000
      })
      return
    }
  } else {
    setInlineInstallStatus({
      state: 'progress',
      title: installT("terminal.downloading_ellipsis", "Downloading..."),
      detailHtml: `<p>${escapeInstallHtml(installT("install.cloning_into", "Cloning into"))} <code>${escapeInstallHtml(targetPath)}/${escapeInstallHtml(name)}</code>.</p>`,
      iconClass: 'fa-solid fa-circle-notch fa-spin'
    })

    try {
      const exists = await checkInstallDestinationExists(name, options)
      if (exists) {
        ensureInlineInstallStatus().hidden = true
        document.body.classList.remove('pinokio-install-status-visible')
        n.Noty({
          text: installT("install.folder_exists_choose_different", "Folder already exists. Choose a different name."),
          timeout: 6000
        })
        return
      }
    } catch (error) {
      ensureInlineInstallStatus().hidden = true
      document.body.classList.remove('pinokio-install-status-visible')
      n.Noty({
        text: error && error.message ? error.message : installT("install.could_not_verify_destination", "Could not verify destination folder"),
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
              title: installT("universal.download_failed", "Download failed."),
              detailHtml: `<p>${escapeInstallHtml(installT("install.clone_failed_check_terminal", "Pinokio could not clone the repository. Check the terminal output for details."))}</p>`,
              iconClass: 'fa-solid fa-triangle-exclamation'
            })
            n.Noty({
              text: installT("install.download_failed_terminal", "Download failed. See terminal output for details."),
              timeout: 6000
            })
            settle(reject, new Error("shell.run failed"))
            return
          }
          settle(resolve)
        } else if (packet.type === "error") {
          setInlineInstallStatus({
            state: 'error',
            title: installT("universal.download_failed", "Download failed."),
            detailHtml: `<p>${escapeInstallHtml(typeof packet.data === "string" ? packet.data : installT("install.shell_run_error", "shell.run error"))}</p>`,
            iconClass: 'fa-solid fa-triangle-exclamation'
          })
          n.Noty({
            text: packet.data
          })
          settle(reject, new Error(typeof packet.data === "string" ? packet.data : installT("install.shell_run_error", "shell.run error")))
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
        throw new Error(installT("tasks.failed_install", "Failed to install task."))
      }
      location.href = finalized.url
      return
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: installT("install.task_import_failed", "Task import failed"),
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : installT("tasks.failed_install", "Failed to install task."))}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : installT("tasks.failed_install", "Failed to install task."),
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
          title: installT("universal.download_failed", "Download failed."),
          detailHtml: `<p>${escapeInstallHtml(installT("install.clone_failed", "Pinokio could not clone the repository."))}</p>`,
          iconClass: 'fa-solid fa-triangle-exclamation'
        })
        n.Noty({
          text: installT("universal.download_failed", "Download failed."),
          timeout: 6000
        })
        return
      }
    } catch (error) {
      setInlineInstallStatus({
        state: 'error',
        title: installT("universal.download_failed", "Download failed."),
        detailHtml: `<p>${escapeInstallHtml(error && error.message ? error.message : installT("install.could_not_verify_destination", "Could not verify destination folder"))}</p>`,
        iconClass: 'fa-solid fa-triangle-exclamation'
      })
      n.Noty({
        text: error && error.message ? error.message : installT("install.could_not_verify_destination", "Could not verify destination folder"),
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
        text: installT("install.downloaded_to", "Downloaded to {path}", { path: `~/${normalizedPath}/${name}` }),
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
