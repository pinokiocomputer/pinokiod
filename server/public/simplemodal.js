const SimpleModal = async (params) => {
  let menu = (params.menu ? params.menu : [])
  let btns = menu.map((item) => {
    if (item.href) {
      let icon = (item.icon ? `<i class="${item.icon}"></i> ` : "")
      return `<a class='btn' href='${item.href}' target='_blank'>${icon}${item.text}</a>`
    } else if (item.action) {
      return `<a class='btn' target='_blank'>${item.text}</a>`
    }
  }).join("")
  await Swal.fire({
    title: params.title || " ",
    confirmButtonText: 'Next',
    html: `<div class='simple-modal-desc'>
${params.description || ""}
</div>
<div class='simple-modal-content'>${btns}</div>`,
  })
}
