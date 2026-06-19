const FSEditor = async ({title, description, old_path, icon, iconpath, redirect, copy, move, edit }) => {
  const t = (key, fallback, replacements) => {
    return typeof window.pinokioT === 'function' ? window.pinokioT(key, fallback, replacements) : `[missing translation: ${key}]`
  }
  const compare = async (file1, file2) => {
    if (file1.size !== file2.size) return false;
    const buffer1 = await file1.arrayBuffer();
    const buffer2 = await file2.arrayBuffer();
    const view1 = new Uint8Array(buffer1);
    const view2 = new Uint8Array(buffer2);
    for (let i = 0; i < view1.length; i++) {
      if (view1[i] !== view2[i]) return false;
    }
    return true;
  }
  const allowedIconMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon'
  ]
  const iconMimeToExtension = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico'
  }
  const rasterMimeTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ])
  const inferExtensionFromFile = (file, fallback) => {
    if (!file) {
      return fallback
    }
    const type = file.type || file.fileType
    if (type && iconMimeToExtension[type]) {
      return iconMimeToExtension[type]
    }
    const name = file.name || file.filename
    if (name) {
      const nameMatch = name.match(/\.([\w-]+)$/)
      if (nameMatch) {
        return nameMatch[1].toLowerCase()
      }
    }
    return fallback
  }
  const buildIconPath = (existingPath, file) => {
    const fallbackExt = (() => {
      if (!existingPath) {
        return 'png'
      }
      const match = existingPath.match(/\.([\w-]+)$/)
      return match ? match[1].toLowerCase() : 'png'
    })()
    const ext = inferExtensionFromFile(file, fallbackExt)
    const basePath = existingPath || `icon.${ext}`
    const lastSlash = basePath.lastIndexOf('/')
    const dir = lastSlash >= 0 ? basePath.slice(0, lastSlash + 1) : ''
    const filename = lastSlash >= 0 ? basePath.slice(lastSlash + 1) : basePath
    const dotIndex = filename.lastIndexOf('.')
    const nameWithoutExt = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
    return `${dir}${nameWithoutExt}.${ext}`
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
    title_label = t('common.copy_to', 'Copy to')
  } else if (move) {
    mode = "move"
    title_label = t('common.move_to', 'Move to')
  } else {
    mode = "edit"
    title_label = t('common.edit', 'Edit')
  }
  if (copy || move) {
    folderpath_html = `<div class='folder-row'>
  <label for='new-folder-description'>${t('common.folder_path', 'Folder Path')}</label>
  <div class='field-row'>
    <label>/api/</label>
    <input id="new-folder-path" class="swal2-input" placeholder="${t('common.folder_path', 'Folder Path')}" value="${old_path}" />
  </div>
</div>`
  }
  let meta_class = ((copy || move) ? 'hidden' : '')
  let result = await Swal.fire({
    title: title_label,
    html: `<div class='filepond-wrapper'>
<div class='avatar-field'>
  <input id='new-folder-image' type="file" class="filepond" name="avatar" accept="${allowedIconMimeTypes.join(', ')}" />
</div>
<div class='folder-rows'>
  ${folderpath_html}
  <div class='folder-row ${meta_class}'>
    <label for='new-folder-title'>${t('common.title', 'Title')}</label>
    <input id="new-folder-title" class="swal2-input" placeholder="${t('common.project_name_pinokio_js', 'Project Name (stored in pinokio.js)')}" value="${title}" />
  </div>
  <div class='folder-row ${meta_class}'>
    <label for='new-folder-description'>${t('common.description', 'Description')}</label>
    <textarea id="new-folder-description" class="swal2-input" placeholder="${t('common.project_description_pinokio_js', 'Project Description (stored in pinokio.js)')}">${description}</textarea>
  </div>
</div>
</div>`,
    allowOutsideClick: true,
    focusConfirm: false,
//    showCancelButton: true,
    confirmButtonText: t('common.save', 'Save'),
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

          allowFileTypeValidation: true,
          acceptedFileTypes: allowedIconMimeTypes,
          allowImageCrop: true,
          allowImageEdit: true,
          allowImageTransform: true,

          credits: false,


          labelIdle: t('common.drag_drop_picture_browse_html', 'Drag & Drop your picture or <span class="filepond--label-action">Browse</span>'),
//          imagePreviewHeight: 170,
          imageCropAspectRatio: '1:1',
          imageResizeTargetWidth: 200,
          imageResizeTargetHeight: 200,
//          stylePanelLayout: 'compact circle',
          instantUpload: false,
          server: {
//            process: {
//              url: '/pinokio/upload', // optional if same as above
            process: async (fieldName, file, metadata, load, error, progress, abort) => {
              const formData = new FormData();
              formData.append('avatar', file)
              if (dirty) {
                formData.append("icon_dirty", true)
              }
              const iconTargetPath = dirty ? buildIconPath(iconpath, file) : (iconpath || "icon.png")
              formData.append("icon_path", iconTargetPath)
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
                  //Swal.close()
                  debugger
                  if (new_path) {
                    location.replace(redirect(new_path))
                  } else {
                    location.reload()
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
            if (initial_file) {
              compare(initial_file.file, file.file).then((same) => {
                if (same) {
                  // don't do anything
                } else {
                  dirty = true
                  const mimeType = file.fileType || file.type
                  const canTransform = mimeType && rasterMimeTypes.has(mimeType)
                  pond.setOptions({
                    allowImageTransform: canTransform,
                    imageTransformOutputMimeType: canTransform ? mimeType : null
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
//            debugger
////            if (error) {
////              alert(error.body)
////            } else {
////              Swal.close()
////              if (new_path) {
////                location.href = redirect(new_path)
////              } else {
////                location.href = location.href
////              }
////            }
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
          alert(t('common.specify_new_folder_copy', 'Please specify a new folder name to copy to'))
          return false
        }
      }
      pond.processFile()
      return false
    }
  })

}
