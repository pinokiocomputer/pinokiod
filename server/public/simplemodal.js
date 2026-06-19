const simpleModalT = (key, fallback, replacements = {}) => {
  const fn = typeof window !== "undefined" && typeof window.pinokioT === "function" ? window.pinokioT : null
  if (fn) {
    return fn(key, fallback, replacements)
  }
  const catalog = typeof window !== "undefined" && window.PINOKIO_I18N && typeof window.PINOKIO_I18N === "object" ? window.PINOKIO_I18N : {}
  let value = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : `[missing translation: ${key}]`
  if (typeof value !== "string") {
    value = `[missing translation: ${key}]`
  }
  Object.entries(replacements || {}).forEach(([name, replacement]) => {
    value = value.replace(new RegExp(`\\{${name}\\}`, "g"), replacement == null ? "" : String(replacement))
  })
  return value
}

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
    confirmButtonText: simpleModalT("common.next", "Next"),
    html: `<div class='simple-modal-desc'>
${params.description || ""}
</div>
<div class='simple-modal-content'>${btns}</div>`,
  })
}
