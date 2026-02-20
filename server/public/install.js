const installname = async (url, name, options) => {
  if (url.startsWith("http")) {
    let urlChunks = new URL(url).pathname.split("/")
    let defaultName = urlChunks[urlChunks.length-1]
    if (!defaultName.endsWith(".git")) {
      defaultName = defaultName + ".git"
    }
  //  defaultName = defaultName.split(".")[0]
    let result = await Swal.fire({
      title: 'Save as',
      html: '<input id="swal-input1" class="swal2-input" placeholder="Name">',
      focusConfirm: false,
      focusCancel: false,
      showCancelButton: true,
      showCloseButton: true,
      cancelButtonText: 'Cancel',
      confirmButtonText: 'Download',
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: true,
      showLoaderOnConfirm: true,
      customClass: {
        popup: 'pinokio-download-modal'
      },
      didOpen: () => {
        let input = Swal.getPopup().querySelector('#swal-input1')
        if (name) {
          input.value = name
        } else {
          input.value = defaultName;
        }
        input.addEventListener("keypress", (e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            e.stopPropagation()
            Swal.clickConfirm()
          }
        })
        setTimeout(() => {
          input.focus()
        }, 0)
      },
      preConfirm: async () => {
        const folderName = (Swal.getPopup().querySelector("#swal-input1").value || "").trim()
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

const install = async (name, url, term, socket, options) => {
  console.log("options", options)
  const n = new N()
  const normalizedPath = options && options.path ? normalizeInstallPath(options.path) : null
  const targetPath = normalizedPath ? `~/${normalizedPath}` : `~/${DEFAULT_INSTALL_RELATIVE_PATH}`

  try {
    const exists = await checkInstallDestinationExists(name, options)
    if (exists) {
      n.Noty({
        text: "Folder already exists. Choose a different name.",
        timeout: 6000
      })
      return
    }
  } catch (error) {
    n.Noty({
      text: error && error.message ? error.message : "Could not verify destination folder",
      timeout: 6000
    })
    return
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
      if (branch) {
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
          path: targetPath,
          on: [{
            event: "/fatal:/i",
            break: true
          }]
        }
      }, (packet) => {
        if (packet.type === 'stream') {
          term.write(packet.data.raw)
        } else if (packet.type === "result") {
          if (packet.data && packet.data.error && packet.data.error.length > 0) {
            n.Noty({
              text: "Download failed. See terminal output for details.",
              timeout: 6000
            })
            settle(reject, new Error("shell.run failed"))
            return
          }
          settle(resolve)
        } else if (packet.type === "error") {
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
      location.href = `/agents?path=${encodeURIComponent(relativePluginPath)}`
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
