const open_url = (href, target, features) => {
  if (target) {
    if (target === "_blank") {
      // if target=_blank => open in new window
      //  - if features=pinokio => open in pinokio
      //  - otherwise => open in a regular browser
      if (features && features.includes("pinokio")) {
        window.open(href, "_blank", features)
      } else if (features && features.includes("browser")) {
        fetch("/go", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: href })
        }).then((res) => {
          return res.json()
        }).then((res) => {
          console.log(res)
        })
      } else {
        window.open(href, "_blank", features)
      }
    } else {
      // no target => just move from the same window
      window.open(href, target, features)
    }
  } else {
    // no target => just use window.open => move in the current window
    window.open(href, "_self", features)
  }
}
document.addEventListener("click", async (e) => {
  // [data-filepath] should open in file explorer
  let el = e.target.closest("[data-filepath]")
  if (!el) {
    let filepath = e.target.getAttribute("data-filepath")
    if (filepath) {
      el = e.target
    }
  }
  if (el) {
    e.preventDefault()
    e.stopPropagation()
    let filepath = el.getAttribute("data-filepath")
    let command = el.getAttribute("data-command")
    await fetch("/openfs", {
      method: "post",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: filepath,
        mode: "open",
        command
      })
    }).then((res) => {
      return res.json()
    })
//    window.open("about:blank", "_blank", "file://" + filepath)
    return
  }

  // [data-run] runs commands kernel.exec (without a shell UI)
  el = e.target.closest("[data-run]")
  if (!el) {
    let run = e.target.getAttribute("[data-run]")
    if (run) {
      el = e.target
    }
  }
  if (el) {
    e.preventDefault()
    e.stopPropagation()
    let run = el.getAttribute("data-run")
    let cwd = el.getAttribute("data-cwd")
    await fetch("/runcmd", {
      method: "post",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        run,
        cwd
      })
    }).then((res) => {
      return res.json()
    })
//    window.open("about:blank", "_blank", "file://" + filepath)
    return
  }

  // target=_blank should open in new window
  el = e.target.closest("[target=_blank]")
  if (!el) {
    if (e.target.getAttribute("target") === "_blank") {
      el = e.target
    }
  }
  if (el) {
    e.preventDefault()
    e.stopPropagation()
    let features = el.getAttribute("features")
    let href = el.href || el.getAttribute("data-href")
    if (href) {
      let agent = document.body.getAttribute("data-agent")
      if (agent === "electron") {
        window.open(href, "_blank", "pinokio")
      } else {
        window.open(href, "_blank", features)
      }
    }
//    if (features && features.includes("app")) {
//      window.open(el.href, "_blank", features)
//    } else {
//      fetch("/go", {
//        method: "POST",
//        headers: {
//          "Content-Type": "application/json"
//        },
//        body: JSON.stringify({ url: el.href })
//      }).then((res) => {
//        return res.json()
//      }).then((res) => {
//        console.log(res)
//      })
//    }
    return
  }


  // if ctrl/cmd+click, open in new window
  let newWin = hotkeys.isPressed("ctrl") || hotkeys.isPressed("cmd")
  if (newWin) {
    let el = e.target.closest("[href]")
    if (!el) {
      if (e.target.getAttribute("href")) {
        el = e.target
      }
    }
    if (el) {
      e.preventDefault()
      e.stopPropagation()
      let agent = document.body.getAttribute("data-agent")
      if (agent === "electron") {
        window.open(href, "_blank", "pinokio")
      } else {
//        window.open(href, "_blank", features)
        let features = el.getAttribute("features")
        window.open(el.href, "_blank", features)
      }
    }
  }
})
