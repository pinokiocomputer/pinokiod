const WaitModal = async (params) => {
  let menu = (params.menu ? params.menu : [])
  let btns = menu.map((item) => {
    if (item.href) {
      let icon = (item.icon ? `<i class="${item.icon}"></i> ` : "")
      return `<a class='btn' href='${item.href}' target='_blank'>${icon}${item.text}</a>`
    } else if (item.action) {
      return `<a class='btn' target='_blank'>${item.text}</a>`
    }
  }).join("")
  let c = {
    html: `<div class='wait-modal'>
  <div class='simple-modal-desc wait-modal-desc'>
    <h1><i class="fa-solid fa-spin fa-circle-notch"></i></h1>
    <div>${params.message || ""}</div>
  </div>
  <div class='simple-modal-content'>${btns}</div>
</div>`,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false
  }
  await Swal.fire(c)
}
