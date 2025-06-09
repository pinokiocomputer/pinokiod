const FSEditor = async ({title, description, old_path, icon, iconpath, redirect, copy, move, edit }) => {
  console.log({ icon, iconpath })
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
  let initial_file
  let title_label
  let file_type
  let folderpath_html = ""
  if (copy) {
    mode = "copy"
    title_label = "Copy to"
  } else if (move) {
    mode = "move"
    title_label = "Move to"
  } else {
    mode = "edit"
    title_label = "Edit"
  }
  if (copy || move) {
    folderpath_html = `<div class='folder-row'>
  <label for='new-folder-description'>Folder Path</label>
  <div class='field-row'>
    <label>/api/</label>
    <input id="new-folder-path" class="swal2-input" placeholder="Folder Path" value="${old_path}" />
  </div>
</div>`
  }
  let result = await Swal.fire({
    title: title_label,
    html: `<div class='filepond-wrapper'>
<div class='avatar-field'>
  <input id='new-folder-image' type="file" class="filepond" name="avatar" accept="image/png, image/jpeg, image/gif" />
</div>
<div class='folder-rows'>
  ${folderpath_html}
  <div class='folder-row'>
    <label for='new-folder-title'>Title</label>
    <input id="new-folder-title" class="swal2-input" placeholder="Folder Name" value="${title}" />
  </div>
  <div class='folder-row'>
    <label for='new-folder-description'>Description</label>
    <textarea id="new-folder-description" class="swal2-input" placeholder="Folder Description">${description}</textarea>
  </div>
</div>
</div>`,
    allowOutsideClick: true,
    focusConfirm: false,
//    showCancelButton: true,
    confirmButtonText: 'Save',
    didOpen: () => {
      const textarea = document.querySelector("#new-folder-description")
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
      textarea.addEventListener('input', () => {
        textarea.style.height = textarea.scrollHeight + 'px';
      });
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
          allowReplace: true,
          allowRevert: true,
          allowRemove: true,

          allowImageCrop: true,
          allowImageEdit: true,
          allowImageTransform: true,


          labelIdle: `Drag & Drop your picture or <span class="filepond--label-action">Browse</span>`,
          imagePreviewHeight: 170,
          imageCropAspectRatio: '1:1',
          imageResizeTargetWidth: 200,
          imageResizeTargetHeight: 200,
          stylePanelLayout: 'compact circle',
          instantUpload: false,
          server: {
//            process: {
//              url: '/pinokio/upload', // optional if same as above
            process: async (fieldName, file, metadata, load, error, progress, abort) => {
              const formData = new FormData();

              console.log("upload", { dirty })
              if (dirty) {
                formData.append("icon_dirty", true)
              }
              formData.append("icon_path", iconpath)
              let title = Swal.getPopup().querySelector('#new-folder-title').value
              let description = Swal.getPopup().querySelector('#new-folder-description').value
              let folder_path_el = Swal.getPopup().querySelector('#new-folder-path')
              formData.append("title", title)
              formData.append("description", description)
              formData.append("old_path", old_path)
              let path
              if (folder_path_el) {
                path = folder_path_el.value
                formData.append("new_path", path)
              } else {
                path = old_path
                formData.append("new_path", old_path)
              }
              if (mode === "copy") {
                formData.append("copy", true)
              } else if (mode === "move") {
                formData.append("move", true)
              }
              if (edit) {
                formData.append("edit", true)
              }
              new_path = path

              try {
                let response = await fetch('/pinokio/upload', {
                  method: 'POST',
                  body: formData
                }).then(res => res.json())
                if (response.error) {
                  alert(response.error)
                } else {
                  Swal.close()
                  if (new_path) {
                    location.href = redirect(new_path)
                  } else {
                    location.href = location.href
                  }
                }
              } catch (e) {
                alert(e.message)
              }
              return {
                abort: () => {
                  abort();
                }
              };
            }
          },
          onaddfile(error, file) {
            console.log({ file, initial_file })
            if (initial_file) {
              compare(initial_file.file, file.file).then((same) => {
                if (same) {
                  // don't do anything
                } else {
                  dirty = true
                  // make sure the image mime type is transformed into the same type as the existing image
                  pond.setOptions({
                    imageTransformOutputMimeType: initial_file.fileType
                  })
                }
                initial_file = file
              })
            } else {
              initial_file = file
            }
          },
//          onprocessfile(error, file) {
//            console.log("onprocessfile")
//            if (error) {
//              alert(error.body)
//            } else {
//              Swal.close()
//              if (new_path) {
//                location.href = redirect(new_path)
//              } else {
//                location.href = location.href
//              }
//            }
//          },
          files: [
            {
              type: 'local',
              source: icon,
            }
          ]
        }
      );
    },
    preConfirm: () => {
      if (mode === "copy") {
        let new_path = Swal.getPopup().querySelector('#new-folder-path').value
        if (new_path === old_path) {
          alert("Please specify a new folder name to copy to")
          return false
        }
      }
      pond.processFile()
      return false
    }
  })

}
