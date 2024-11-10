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
    let filepath = el.getAttribute("data-filepath")
    await fetch("/openfs", {
      method: "post",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: filepath
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
    window.open(el.href, "_blank", features)
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
      let features = el.getAttribute("features")
      window.open(el.href, "_blank", features)
    }
  }
})
