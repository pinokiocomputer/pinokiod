const normalizeSwalClasses = (value) => {
  if (!value) {
    return []
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap(normalizeSwalClasses)
  }
  if (typeof value[Symbol.iterator] === "function") {
    return Array.from(value).flatMap(normalizeSwalClasses)
  }
  return []
}

const mergeSwalClassNames = (...values) => {
  return [...new Set(values.flatMap(normalizeSwalClasses))].join(" ")
}

const buildFormModalCustomClass = (customClass) => {
  const defaults = {
    popup: "pinokio-modern-modal pinokio-input-modal",
    htmlContainer: "pinokio-modern-html pinokio-input-modal-html",
    title: "pinokio-input-modal-title",
    actions: "pinokio-input-modal-actions",
    confirmButton: "pinokio-modern-confirm pinokio-input-modal-confirm",
    cancelButton: "pinokio-modern-cancel pinokio-input-modal-cancel",
    validationMessage: "pinokio-input-modal-validation"
  }
  const merged = Object.assign({}, customClass)
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = mergeSwalClassNames(defaultValue, customClass && customClass[key])
    if (value) {
      merged[key] = value
    }
  }
  return merged
}

const ModalInput = async (params, uri) => {
/*
  {
    title,
    type: "modal" (default) |"notify"
    confirm: "OK",
    form: [{
      type,
      items,
      key,
      title,
      description,
      placeholder,
      required,
      default
    }]
  }
*/
  let form = params.form || []
  let dropzones = []
  let isStyledFormModal = form.length > 0
  let usesExpansiveField = form.some((field) => {
    return field && (field.type === "textarea" || field.type === "file")
  })
  let compactFieldCount = form.filter((field) => {
    let type = field && field.type ? field.type : "text"
    return type !== "textarea" && type !== "file" && type !== "checkbox"
  }).length
  let usesDenseLayout = compactFieldCount >= 4
  let modalWidth = usesExpansiveField || form.length > 2
    ? "min(620px, calc(100vw - 28px))"
    : "min(520px, calc(100vw - 28px))"
  let shellClassName = mergeSwalClassNames(
    "pinokio-input-modal-shell",
    usesDenseLayout && "pinokio-input-modal-shell--dense"
  )
  let panelClassName = mergeSwalClassNames(
    "pinokio-input-modal-panel",
    usesDenseLayout && "pinokio-input-modal-panel--dense"
  )
  let description = (params.description ? `<div class='pinokio-input-modal-description'>${params.description}</div>` : "")
  let fields = form.map((field) => {
    let type = (field.type ? field.type : "text")
    let autofocus = (field.autofocus ? "autofocus" : "")
    let fieldClassName = mergeSwalClassNames(
      "pinokio-input-modal-field",
      `pinokio-input-modal-field--${type}`,
      (type === "textarea" || type === "file" || type === "checkbox") && "pinokio-input-modal-field--full"
    )
    let input
    if (type === 'textarea') {
      input = `<textarea ${autofocus} oninput="autoExpand(this)" data-id="${field.key}" class="swal2-textarea pinokio-input-modal-control pinokio-input-modal-control--textarea" placeholder="${field.placeholder ? field.placeholder : ''}"></textarea>`
    } else if (type === 'select') {
      if (field.items && Array.isArray(field.items)) {
        let items = field.items.map((item) => {
          if (typeof item === "object" && item.value && item.text) {
            return `<option value="${item.value}">${item.text}</option>`
          } else {
            return `<option value="${item}">${item}</option>`
          }
        }).join("")
        input = `<select data-id="${field.key}" class="swal2-select pinokio-input-modal-control pinokio-input-modal-control--select">${items}</select>`
      }
    } else if (type === 'checkbox') {
      input = `<div class='pinokio-input-modal-checkbox-row'>
        <input class='pinokio-input-modal-checkbox-input' data-type="checkbox" type="checkbox" data-id="${field.key}" value="${field.key}" />
        <div class='pinokio-input-modal-checkbox-copy'>
          <h5 class='pinokio-input-modal-checkbox-title'>${field.title}</h5>
          <div class='pinokio-input-modal-checkbox-description'>${field.description ? field.description : ''}</div>
        </div>
      </div>`
    } else if (type === 'file') {
      input = `<div data-accept='${field.accept}' class='dropzone pinokio-input-modal-dropzone' data-type='file' data-id='${field.key}'></div>`
      //input = `<input type='file' data-id="${field.key}" />`
    } else {
      input = `<input ${autofocus} type='${type}' data-id="${field.key}" class="swal2-input pinokio-input-modal-control" placeholder="${field.placeholder ? field.placeholder : ''}">`
    }
    if (type === 'checkbox') {
      return [
        `<div class='${fieldClassName}'>`,
          input,
        "</div>"
      ].join("\n")
    } else {
      return [
        `<div class='${fieldClassName}'>`,
          (field.title ? `<div class='pinokio-input-modal-label'>${field.title}</div>` : ""),
          input,
          (field.description ? `<div class='pinokio-input-modal-field-description'>${field.description}</div>` : ""),
        "</div>"
      ].join("\n")
    }
  }).join("\n")
  let html = isStyledFormModal ? [
    `<div class='${shellClassName}'>`,
      description,
      `<div class='${panelClassName}'>${fields}</div>`,
    "</div>"
  ].join("\n") : description + fields
  let result = await Swal.fire({
    title: (params.title || ""),
    customClass: isStyledFormModal ? buildFormModalCustomClass(params.customClass) : params.customClass,
    html,
    ...(isStyledFormModal ? {
      buttonsStyling: false,
      width: modalWidth,
      backdrop: "rgba(10, 10, 12, 0.42)"
    } : {}),
    //focusConfirm: false,
    confirmButtonText: params.confirm || 'Done',
    didRender: () => {
      Swal.getPopup().querySelectorAll('[data-type=file]').forEach((el, index) => {
        const dz = new Dropzone(el, {
          url: '/no-op', // dummy, not used
          acceptedFiles: el.getAttribute("data-accept") || null,
          autoProcessQueue: false,
          uploadMultiple: false,
          maxFiles: 1,
          addRemoveLinks: true,
          dictDefaultMessage: "Drag and drop or click to upload a file",
          init: function () {
            console.log(`Dropzone ${index + 1} ready`);
          }
        });
        dropzones.push(dz);
      });
    },
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
        let type = input.getAttribute("data-type")
        if (type !== 'file' && type !== 'checkbox') {
          response[field.key] = input.value
          if (field.required && input.value.length === 0) {
            alert(`${field.title || field.key} value must exist`) 
            return false
          }
        }
        if (type === 'checkbox') {
          response[field.key] = input.checked
        }

//        if (type === 'file') {
//          const file = input.files[0];
//          const reader = new FileReader();
//          let buffer = await new Promise((resolve, reject) => {
//            reader.onload = () => {
//              resolve(new Uint8Array(reader.result))
//            };
//            reader.readAsArrayBuffer(file);
//          })
//          buffer_response[field.key] = buffer
//        } else {
//          response[field.key] = input.value
//        }
      }


      for(let dz of dropzones) {
        const id = dz.element.getAttribute("data-id");
        const fileList = dz.getAcceptedFiles(); // array of File
        const file = fileList[0]; // actual File object (like from <input>)
        let buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(new Uint8Array(reader.result))
          };
          reader.readAsArrayBuffer(file);
        })
        buffer_response[id] = buffer
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
