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
      let agent = document.body.getAttribute("data-agent")
      window.open("/", "_blank", "self")
      /*
      if (agent === "electron") {
        window.open("/", "_blank", "self")
      } else {
        fetch("/go", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: location.href })
        }).then((res) => {
          return res.json()
        }).then((res) => {
          console.log(res)
        })
      }
      */
    })
  }
})
