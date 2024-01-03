document.addEventListener("DOMContentLoaded", () => {
  //console.log("history", history.length)
  //if (history.length <= 1) {
  //  let back = document.querySelector("#back")
  //  if (back) {
  //    back.classList.add("disabled") 
  //  }
  //}
  //if (history.length === 0) {
  //  let forward = document.querySelector("#forward")
  //  if (forward) {
  //    forward.classList.add("disabled")
  //  }
  //}
  if (document.querySelector("#new-window")) {
    document.querySelector("#new-window").addEventListener("click", (e) => {
      window.open("/", "_blank", "self")
    })
  }
})
