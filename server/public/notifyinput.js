const NotifyInput = async (params, n) => {
/*
  {
    title,
    type: "modal" (default) |"notify"
    form: [{
      key,
      title,
      description,
      default
    }]
  }
*/

  let form = params.form || []
  let description = (params.description ? `<div class='desc'>${params.description}</div>` : "")

  let options = {
    title: (params.title || ""),
    html: description + form.map((field) => {
      let type = (field.type ? field.type : "text")
      let input
      if (type === 'textarea') {
        input = `<textarea oninput="autoExpand(this)" data-id="${field.key}" class="swal2-input" placeholder="${field.placeholder ? field.placeholder : ''}"></textarea>`
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
  }

  let notification = n.Noty({
    text: [
      "<form class='input-form'>",
        `<div class='title'>${options.title}</div>`,
        `<div class='form'>${options.html}</div>`,
        "<button id='input-done'>Done</button>",
      "</form>"
    ].join(""),
    type: "success",
    layout: "bottomRight",
    closeWith:[],
//    callbacks: {
//      onShow: () => {
//      //afterShow: () => {
//      }
//    }
  })
  for(let field of form) {
    let input = notification.barDom.querySelector(`[data-id='${field.key}']`)
    if (field.default) {
      input.value = field.default
    }
  }
  let input = notification.barDom.querySelector("[data-id]")
  debugger
  if (input) {
    if (input.oninput) input.oninput(input)
    input.focus()
  }


  let response = await new Promise((resolve, reject) => {
    notification.barDom.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault()
      e.stopPropagation()
      let response = {}
      for(let field of form) {
        let input = notification.barDom.querySelector(`[data-id='${field.key}']`)
        let val = input.value
        response[field.key] = val
      }
      resolve(response)
      notification.close()
    }, { once: true })
  })
  return response

}
