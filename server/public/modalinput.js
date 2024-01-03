const ModalInput = async (params) => {
/*
  {
    title,
    type: "modal" (default) |"notify"
    form: [{
      type,
      items,
      key,
      title,
      description,
      placeholder,
      default
    }]
  }
*/
  let form = params.form || []
  let description = (params.description ? `<div class='desc'>${params.description}</div>` : "")
  let result = await Swal.fire({
    title: (params.title || ""),
    html: description + form.map((field) => {
      let type = (field.type ? field.type : "text")
      let input
      if (type === 'textarea') {
        input = `<textarea oninput="autoExpand(this)" data-id="${field.key}" class="swal2-input" placeholder="${field.placeholder ? field.placeholder : ''}"></textarea>`
      } else if (type === 'select') {
        if (field.items && Array.isArray(field.items)) {
          let items = field.items.map((item) => {
            return `<option value="${item}">${item}</option>`
          }).join("")
          input = `<select>${items}</select>`
        }
      } else {
        input = `<input type='${type}' data-id="${field.key}" class="swal2-input" placeholder="${field.placeholder ? field.placeholder : ''}">`
      }
      return [
        "<div class='field'>",
          `<label class='title'>${field.title ? field.title : ''}</label>`,
          input,
          `<label class='description'>${field.description ? field.description : ''}</label>`,
        "</div>"
      ].join("\n")
    }).join("\n"),
    //focusConfirm: false,
    confirmButtonText: 'Done',
    didOpen: () => {
      for(let field of form) {
        if (field.default) {
          let input = Swal.getPopup().querySelector("[data-id='" + field.key + "']")
          input.value = field.default
          if (input.oninput) input.oninput(input)
        }
      }
      document.querySelector(".swal2-confirm").blur()
    },
    preConfirm: () => {
      let response = {}
      for(let field of form) {
        debugger
        let input = Swal.getPopup().querySelector("[data-id='" + field.key + "']")
        response[field.key] = input.value
      }
      return response
    }
  })
  if (result) {
    return result.value
  } else {
    return null
  }
}
