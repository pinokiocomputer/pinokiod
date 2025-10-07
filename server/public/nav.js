document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#new-window")) {
    document.querySelector("#new-window").addEventListener("click", (e) => {
      let agent = document.body.getAttribute("data-agent")
      if (agent === "electron") {
        window.open("/", "_blank", "pinokio")
      } else {
        window.open("/", "_blank")
      }
    })
  }
})
