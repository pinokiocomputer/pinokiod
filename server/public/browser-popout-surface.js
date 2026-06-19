(function() {
  const translate = (key, fallback, replacements = {}) => {
    if (window.pinokioT) {
      return window.pinokioT(key, fallback, replacements)
    }
    return `[missing translation: ${key}]`.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
      return Object.prototype.hasOwnProperty.call(replacements, name) ? replacements[name] : `{${name}}`
    })
  }
  const normalizeHref = (value) => {
    if (typeof value !== "string") {
      return ""
    }
    const trimmed = value.trim()
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }

  const resolveHref = (target) => {
    if (!target) {
      return ""
    }
    return normalizeHref(target.getAttribute("data-target-full") || target.href || target.getAttribute("href") || "")
  }

  const openBrowserPopoutUrl = (href) => {
    if (!href) {
      return
    }
    const agent = document.body ? document.body.getAttribute("data-agent") : null
    if (agent === "electron") {
      window.open(href, "_blank", "browser")
    } else {
      window.open(href, "_blank", "noopener")
    }
  }

  window.createBrowserPopoutSurface = function(options = {}) {
    const surface = document.getElementById(options.id || "browserview-external-surface")
    const title = surface ? surface.querySelector("[data-browserview-external-title]") : null
    const url = surface ? surface.querySelector("[data-browserview-external-url]") : null
    const titleText = options.title || translate("common.click_open_browser", "Click to open in browser")
    const onShow = typeof options.onShow === "function" ? options.onShow : null

    const hide = () => {
      if (!surface) {
        return
      }
      surface.classList.add("hidden")
      surface.setAttribute("hidden", "")
      delete surface.dataset.href
    }

    const show = (target) => {
      if (!surface || !target) {
        return
      }
      const href = resolveHref(target)
      surface.dataset.href = href
      surface.classList.remove("hidden")
      surface.removeAttribute("hidden")
      if (title) {
        title.textContent = titleText
      }
      if (url) {
        url.textContent = href
      }
      if (onShow) {
        onShow({ target, href })
      }
    }

    if (surface && !surface.dataset.browserPopoutBound) {
      surface.dataset.browserPopoutBound = "true"
      surface.addEventListener("click", () => {
        openBrowserPopoutUrl(surface.dataset.href || "")
      })
      surface.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openBrowserPopoutUrl(surface.dataset.href || "")
        }
      })
    }

    return {
      hide,
      isPopoutTab: (node) => Boolean(node && node.getAttribute("data-popout-browser") === "true"),
      open: openBrowserPopoutUrl,
      show,
      surface,
    }
  }
})()
