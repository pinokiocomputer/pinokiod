hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
  window.open("/", "_blank", "self")
})
const refreshParent = (e) => {
  if (window.parent === window.top) {
    window.parent.postMessage(e, "*")
  }
}
if (document.querySelector("#back")) {
  document.querySelector("#back").addEventListener("click", (e) => {
    history.back()
  })
}
if (document.querySelector("#forward")) {
  document.querySelector("#forward").addEventListener("click", (e) => {
    history.forward()
  })
}
if (document.querySelector("#genlog")) {
  document.querySelector("#genlog").addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.target.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'
    fetch("/pinokio/log", {
      method: "post",
    }).then((res) => {
      console.log("RES", res)
      let btn = document.querySelector("#genlog")
      let btn2 = document.querySelector("#downloadlogs")
      btn2.classList.remove("hidden") 
      btn.classList.add("hidden")
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Generated!'
      //btn.classList.add("hidden")
    })
  })
}
