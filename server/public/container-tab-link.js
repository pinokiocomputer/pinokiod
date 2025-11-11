(function () {
  const api = window.PinokioTabLinkPopover
  if (!api) {
    return
  }
  const { renderTabLinkPopover, hideTabLinkPopover, isLocalHostLike } = api

  const getPopoverEl = () => document.getElementById('tab-link-popover')

  const ensureHttpUrl = (value) => {
    if (typeof value !== 'string') {
      return ''
    }
    let trimmed = value.trim()
    if (!trimmed) {
      return ''
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      if (/^[a-z]+:\/\//i.test(trimmed)) {
        return ''
      }
      trimmed = `http://${trimmed}`
    }
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return ''
      }
      return parsed.toString()
    } catch (_) {
      return ''
    }
  }

  const isLocalUrl = (value) => {
    if (!value) {
      return false
    }
    try {
      const parsed = new URL(value)
      return isLocalHostLike(parsed.hostname)
    } catch (_) {
      return false
    }
  }

  const resolveCurrentUrl = (input) => {
    if (input && typeof input.value === 'string' && input.value.trim().length > 0) {
      const normalized = ensureHttpUrl(input.value)
      if (normalized) {
        return normalized
      }
    }
    const fallback = input?.getAttribute('value')
    return ensureHttpUrl(fallback || '')
  }

  const showPopoverForAnchor = (anchor, urlInput) => {
    if (!anchor) {
      return
    }
    const currentUrl = resolveCurrentUrl(urlInput)
    if (!currentUrl || !isLocalUrl(currentUrl)) {
      hideTabLinkPopover({ immediate: true })
      return
    }
    renderTabLinkPopover(anchor, {
      hrefOverride: currentUrl,
      requireAlternate: false,
      restrictToBase: true,
      forceCanonicalQr: true,
      allowQrPortMismatch: true,
      skipPeerFallback: true
    })
  }

  const handleMouseLeave = (anchor, event) => {
    const related = event.relatedTarget
    const popover = getPopoverEl()
    if (related && (anchor.contains(related) || (popover && popover.contains(related)))) {
      return
    }
    hideTabLinkPopover()
  }

  const init = () => {
    const container = document.querySelector('.url-input-container')
    const urlInput = container ? container.querySelector('input[type="url"]') : null
    const mobileButton = document.getElementById('mobile-link-button')

    if (container) {
      container.addEventListener('mouseover', () => showPopoverForAnchor(container, urlInput))
      container.addEventListener('mouseout', (event) => handleMouseLeave(container, event))
      const inputFocus = () => showPopoverForAnchor(container, urlInput)
      const inputBlur = (event) => handleMouseLeave(container, event)
      if (urlInput) {
        urlInput.addEventListener('focus', inputFocus)
        urlInput.addEventListener('blur', inputBlur)
      }
    }

    if (mobileButton) {
      mobileButton.addEventListener('focus', () => showPopoverForAnchor(mobileButton, urlInput))
      mobileButton.addEventListener('blur', (event) => handleMouseLeave(mobileButton, event))
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
