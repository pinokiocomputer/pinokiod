const installname = async (url, name) => {
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
  //    showCancelButton: true,
      confirmButtonText: 'Download',
      allowOutsideClick: false,
      didOpen: () => {
        let input = Swal.getPopup().querySelector('#swal-input1')
        if (name) {
          input.value = name
        } else {
          input.value = defaultName;
        }
        input.addEventListener("keypress", (e) => {
          if (event.key === "Enter") {
            e.preventDefault()
            e.stopPropagation()
            Swal.clickConfirm()
          }
        })
      },
      preConfirm: () => {
        const name = Swal.getPopup().querySelector('#swal-input1').value;
        return name
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

const install = async (name, url, term, socket, options) => {
  console.log("options", options)
  const n = new N()
  const normalizedPath = options && options.path ? normalizeInstallPath(options.path) : null
  const targetPath = normalizedPath ? `~/${normalizedPath}` : `~/${DEFAULT_INSTALL_RELATIVE_PATH}`

  await new Promise((resolve, reject) => {
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
        path: targetPath
      }
    }, (packet) => {
      if (packet.type === 'stream') {
        term.write(packet.data.raw)
      } else if (packet.type === "result") {
        resolve()
      } else if (packet.type === "error") {
        n.Noty({
          text: packet.data
        })
      }
    })
  })
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
      location.href = "/terminals"
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
    theme,
  }
  let res = await fetch("/xterm_config").then((res) => {
    return res.json()
  })
  if (res && res.config) {
    config = res.config
  }
  const term = new Terminal(config)
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  document.querySelector("#terminal").classList.remove("hidden")
  document.querySelector("#terminal").classList.add("expanded")
  term.open(document.querySelector("#terminal"))
  fitAddon.fit();
  return term
}
