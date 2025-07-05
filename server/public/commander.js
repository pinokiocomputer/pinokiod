const Commander = async (config) => {
  console.log({ config })
  let result = await Swal.fire({
    title: `<i class='${config.icon}'></i> ${config.title}`,
    html: `<div class='commander-dialog'>${config.description}</div>
  <input style='width:100%; padding: 10px;' class='cmd' type='text' placeholder='${config.placeholder}'>`,
    allowOutsideClick: true,
    focusConfirm: false,
//    showCancelButton: true,
    confirmButtonText: 'OK',
    didOpen: () => {
      const input = document.querySelector(".cmd")
      input.focus()
    },
    preConfirm: () => {
      let message = config.message(Swal.getPopup().querySelector(".cmd").value)
      let path = config.path
      let callback = config.callback
      let search_params = new URLSearchParams()
      search_params.set("message", message)
      if (config.callback) {
        search_params.set("callback", config.callback)
      }
      search_params.set("path", config.path)
      if (config.venv) {
        search_params.set("venv", config.venv)
      }
      if (config.target) {
        search_params.set("target", config.target)
      }

      // env
      if (config.env) {
        for(let key in config.env) {
          search_params.set("env." + key, config.env[key])
        }
      }
      let terminal_path = "/shell/" + config.id + "?" + search_params.toString()
      location.href = terminal_path
    }
  })
  console.log({ result })
}
