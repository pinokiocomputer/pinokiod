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
if (document.querySelector("#create-new-folder")) {
  document.querySelector("#create-new-folder").addEventListener("click", async (e) => {
    e.preventDefault()
    e.stopPropagation()
    let folder = prompt("Enter a folder name to create")
    if (folder && folder.length > 0) {
    } else {
      alert("Please enter a folder name")
      return false
    }
    if (folder && folder.includes(" ")) {
      alert("Please use a folder path without a space")
      return false
    }
    let response = await fetch("/mkdir", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ folder })
    }).then((res) => {
      return res.json()
    })
    if (response.error) {
      alert(response.error)
    } else {
      location.href = response.success
    }
  })
}
