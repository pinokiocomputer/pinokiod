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
const install = async (name, url, term, socket, options) => {
  const n = new N()
  await new Promise((resolve, reject) => {
    socket.close()

    // normalize git url to the standard .git format

    if (!url.endsWith(".git")) {
      url = url + ".git"
    }

    socket.run({
      method: "shell.run",
      params: {
        message: `git clone ${url} ${name}`,
        path: "~/api"
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
    // ask the backend to create install.json and start.json if gradio
    location.href = `/?selected=${name}`

//    await fetch("/gepeto", {
//      method: "post",
//      headers: {
//        "Content-Type": "application/json"
//      },
//      body: JSON.stringify({
//        name
//      })
//    })
//
//    //location.href = "/api/" + name
//    location.href = `/?selected=${name}`
//    /*
//    n.Noty({
//      text: "Success! Click here to continue.",
//      callbacks: {
//        onClose: () => {
//          location.href = "/api/" + name
//        }
//      }
//    })
//    */
  }
}
const createTerm = () => {
  const term = new Terminal({
    //theme: xtermTheme.Piatto_Light,
    //theme: xtermTheme.Github,
    //theme: xtermTheme.Cobalt_Neon,      // top legibility
    theme: xtermTheme.Duotone_Dark,
    //theme: xtermTheme.Seafoam_Pastel,
    //theme: xtermTheme.IC_Green_PPL,
    //theme: xtermTheme.FunForrest,
    //theme: xtermTheme.Jackie_Brown,
    //theme: xtermTheme.Ocean,

    //theme: xtermTheme.Blazer,
    //theme: xtermTheme.BirdsOfParadise,
    //theme: xtermTheme.AtelierSulphurpool,
    //theme: xtermTheme.Borland,
    rows: 20,
    fontSize: 12
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  document.querySelector("#terminal").classList.remove("hidden")
  document.querySelector("#terminal").classList.add("expanded")
  term.open(document.querySelector("#terminal"))
  fitAddon.fit();
  return term
}
