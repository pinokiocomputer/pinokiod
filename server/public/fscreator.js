const FSCreator = async (config) => {
  const compare = async (file1, file2) => {
    if (file1.size !== file2.size) return false;
    console.log({ file1, file2 })
    const buffer1 = await file1.arrayBuffer();
    const buffer2 = await file2.arrayBuffer();
    const view1 = new Uint8Array(buffer1);
    const view2 = new Uint8Array(buffer2);
    for (let i = 0; i < view1.length; i++) {
      if (view1[i] !== view2[i]) return false;
    }
    return true;
  }
  let dirty
  let mode
  let new_path

  let els = []
  if (config.input) {
    for(let input of config.input) {
      els.push(`<div class='folder-row'>
    <label for='new-folder-${input.key}'>${input.title}</label>
    <input id="new-folder-${input.key}" class="swal2-input" placeholder="${input.description ? input.description : ''}" />
  </div>`)
    }
  }
  let title
  if (config.icon) {
    title = `<div style='display: flex; align-items: center; padding: 10px; justify-content: center;'><img src='${config.icon}' style='width:30px; height:30px; margin-right: 10px;'><div>${config.title}</div></div>`
  } else {
    title = `<div style='display: flex; align-items: center; padding: 10px; justify-content: center;'><div>${config.title}</div></div>`
  }
  let result = await Swal.fire({
    title,
    html: `<div class='filepond-wrapper'>
<div class='avatar-field'>
  <input id='new-folder-image' type="file" class="filepond" name="avatar" accept="image/png, image/jpeg, image/gif" />
</div>
<div class='folder-rows'>
  <div class='folder-row'>
    <label for='new-folder-path'>Folder Path</label>
    <div class='field-row'>
      <input id="new-folder-path" class="swal2-input" placeholder="Folder Path" autofocus  />
    </div>
  </div>
  ${els.join('')}
  <div class='folder-row hidden'>
    <label for='new-folder-title'>Title (optional)</label>
    <div class='field-row'>
      <input id="new-folder-title" class="swal2-input" placeholder="Title" />
    </div>
  </div>
  <div class='folder-row hidden'>
    <label for='new-folder-description'>Description (optional)</label>
    <div class='field-row'>
      <input id="new-folder-description" class="swal2-input" placeholder="Description" />
    </div>
  </div>
</div>
</div>`,
    allowOutsideClick: true,
    focusConfirm: false,
//    showCancelButton: true,
    confirmButtonText: 'Create',
    didOpen: () => {
      let textareas = Swal.getPopup().querySelectorAll("textarea")
      for(let textarea of textareas) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
        textarea.addEventListener('input', () => {
          textarea.style.height = textarea.scrollHeight + 'px';
        });
      }
      const input = document.querySelector("#new-folder-path")
      input.focus()
      FilePond.registerPlugin(
        FilePondPluginFileValidateType,
        FilePondPluginImageExifOrientation,
        FilePondPluginImagePreview,
        FilePondPluginImageCrop,
        FilePondPluginImageResize,
        FilePondPluginImageTransform,
        FilePondPluginImageEdit
      );
      pond = FilePond.create(
        document.querySelector('#new-folder-image'),
        {
          credits: false,
          allowReplace: true,
          allowRevert: true,
          allowRemove: true,

          allowImageCrop: true,
          allowImageEdit: true,
          allowImageTransform: true,


          labelIdle: `Drag & Drop your picture or <span class="filepond--label-action">Browse</span>`,
//          imagePreviewHeight: 170,
          imageCropAspectRatio: '1:1',
//          imageResizeTargetWidth: 200,
//          imageResizeTargetHeight: 200,
          imageTransformOutputMimeType: 'image/png',
//          stylePanelLayout: 'compact circle',
          instantUpload: false,
          server: {
            process: {
              url: config.url || '/new', // optional if same as above
              onerror: (response) => {
                let err = JSON.parse(response)
                alert(err.error)
              },
              ondata: (formData) => {
                // set custom input fields
                if (config.input) {
                  for(let input of config.input) {
                    let key = "#new-folder-" + input.key
                    let val = Swal.getPopup().querySelector(key).value
                    formData.append(input.key, val)
                  }
                }
                
                //let title = Swal.getPopup().querySelector('#new-folder-title').value
                //let description = Swal.getPopup().querySelector('#new-folder-description').value
                //formData.append("title", title)
                //formData.append("description", description)
                formData.append("id", config.id)

                // set folder path
                let folder_path_el = Swal.getPopup().querySelector('#new-folder-path')
                let path = folder_path_el.value
                formData.append("path", path)
                formData.append("title", path)

                console.log({ formData })
                return formData;
              }
            }
          },
          onprocessfile(error, file) {
            if (error) {
            } else {
              let folder_path_el = Swal.getPopup().querySelector('#new-folder-path')
              Swal.close()
              location.href = "/new/" + folder_path_el.value
            }
          },
          files: [
            {
              type: 'local',
              source: '/pinokio-black.png',
            }
          ]
        }
      );
    },
    preConfirm: () => {
      let path = Swal.getPopup().querySelector('#new-folder-path').value
      if (path && path.length > 0) {
      } else {
        alert("Please enter a folder name")
        return false
      }
      if (path && path.includes(" ")) {
        alert("Please use a folder path without a space")
        return false
      }
      pond.processFile()
      return false
    }
  })
  console.log({ result })
}
