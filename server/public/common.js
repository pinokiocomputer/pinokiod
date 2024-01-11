hotkeys("ctrl+t,cmd+t,ctrl+n,cmd+n", (e) => {
  window.open("/", "_blank", "self")
})
const refreshParent = (e) => {
  if (window.parent === window.top) {
    window.parent.postMessage(e, "*")
  }
}
window.addEventListener('message', (event) => {
  console.log("Message received from the child: ", event.data); // Message received from child
  if (event.data && event.data.action) {
    if (event.data.action === "back") {
      history.back()
    } else if (event.data.action === "forward") {
      history.forward()
    } 
  }
});
