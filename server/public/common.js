hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
  window.open("/", "_blank", "self")
})
const refreshParent = (e) => {
  if (window.parent === window.top) {
    window.parent.postMessage(e, "*")
  }
}
