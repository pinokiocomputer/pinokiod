const ModalInput = async (params, uri) => {
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
      let autofocus = (field.autofocus ? "autofocus" : "")
      let input
      if (type === 'textarea') {
        input = `<textarea ${autofocus} oninput="autoExpand(this)" data-id="${field.key}" class="swal2-input" placeholder="${field.placeholder ? field.placeholder : ''}"></textarea>`
      } else if (type === 'select') {
        if (field.items && Array.isArray(field.items)) {
          let items = field.items.map((item) => {
            return `<option value="${item}">${item}</option>`
          }).join("")
          input = `<select>${items}</select>`
        }
      } else if (type === 'file') {
        input = `<input type='file' data-id="${field.key}" />`
      } else {
        input = `<input ${autofocus} type='${type}' data-id="${field.key}" class="swal2-input" placeholder="${field.placeholder ? field.placeholder : ''}">`
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
    preConfirm: async () => {
      let response = {}
      let buffer_response = {}
      for(let field of form) {
        let input = Swal.getPopup().querySelector("[data-id='" + field.key + "']")

        let type = input.getAttribute("type")
        if (type === 'file') {
          const file = input.files[0];
          const reader = new FileReader();
          let buffer = await new Promise((resolve, reject) => {
            reader.onload = () => {
              resolve(new Uint8Array(reader.result))
            };
            reader.readAsArrayBuffer(file);
          })
          buffer_response[field.key] = buffer
        } else {
          response[field.key] = input.value
        }
      }
      if (Object.keys(buffer_response).length > 0) {


        const fileKeys = Object.keys(buffer_response);
        const metadata = {
          uri,
          response,
          buffer_keys: fileKeys
        };

        const metaJson = JSON.stringify(metadata);
        const metaBuffer = new TextEncoder().encode(metaJson);
        const separator = new Uint8Array([0]);

        const parts = [metaBuffer, separator];

        for (const key of fileKeys) {
          const buf = buffer_response[key];
          const lenBytes = new Uint8Array(4);
          new DataView(lenBytes.buffer).setUint32(0, buf.byteLength); // big-endian length
          parts.push(lenBytes, new Uint8Array(buf));
        }

        // Calculate total length
        const totalLen = parts.reduce((sum, part) => sum + part.length, 0);
        const combined = new Uint8Array(totalLen);

        let offset = 0;
        for (const part of parts) {
          combined.set(part, offset);
          offset += part.length;
        }

        return combined.buffer
      } else {
        return response
      }
    }
  })
  if (result) {
    return result.value
  } else {
    return null
  }
}
