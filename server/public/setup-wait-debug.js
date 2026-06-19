(function () {
  const HISTORY_LIMIT = 12
  const t = (key, fallback, replacements = {}) => {
    const catalog = window.PINOKIO_I18N && typeof window.PINOKIO_I18N === "object" ? window.PINOKIO_I18N : {}
    let value = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : `[missing translation: ${key}]`
    if (typeof value !== "string") {
      value = `[missing translation: ${key}]`
    }
    Object.entries(replacements || {}).forEach(([name, replacement]) => {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), replacement == null ? "" : String(replacement))
    })
    return value
  }

  function create(waitRoot) {
    const state = {
      events: [],
      phase: null,
      router: null,
      startupError: null,
    }

    function ensurePanel() {
      if (!waitRoot) {
        return null
      }
      let panel = waitRoot.querySelector(".wait-debug")
      if (!panel) {
        panel = document.createElement("div")
        panel.className = "wait-debug"
        panel.style.marginTop = "16px"
        panel.style.padding = "12px"
        panel.style.border = "1px solid rgba(255,255,255,0.12)"
        panel.style.borderRadius = "8px"
        panel.style.background = "rgba(255,255,255,0.04)"
        panel.style.textAlign = "left"
        panel.innerHTML = [
          `<div style="font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;opacity:0.75;margin-bottom:8px;">${t("setup.debug", "Debug")}</div>`,
          '<pre class="wait-debug-body" style="margin:0;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;opacity:0.9;"></pre>'
        ].join("")
        waitRoot.appendChild(panel)
      }
      return panel.querySelector(".wait-debug-body")
    }

    function event(message) {
      const timestamp = new Date().toLocaleTimeString()
      const entry = `[${timestamp}] ${message}`
      if (state.events[state.events.length - 1] !== entry) {
        state.events.push(entry)
        if (state.events.length > HISTORY_LIMIT) {
          state.events.shift()
        }
      }
    }

    function track({ routerStatus, startupStatus } = {}) {
      if (startupStatus && startupStatus.phase && startupStatus.phase !== state.phase) {
        state.phase = startupStatus.phase
        event(`phase -> ${startupStatus.phase}`)
      }
      const routerSummary = routerStatus
        ? (routerStatus.success ? "success" : (routerStatus.error || JSON.stringify(routerStatus)))
        : null
      if (routerSummary && routerSummary !== state.router) {
        state.router = routerSummary
        event(`router -> ${routerSummary}`)
      }
      if (startupStatus && startupStatus.error && startupStatus.error !== state.startupError) {
        state.startupError = startupStatus.error
        event(`startup error -> ${startupStatus.error}`)
      }
    }

    function render({ startedAt, routerStatus, startupStatus, serverDebug } = {}) {
      const body = ensurePanel()
      if (!body) {
        return
      }
      const elapsedSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0
      const lines = [
        `${t("setup.elapsed", "Elapsed")}: ${elapsedSeconds}s`,
        `${t("setup.startup_phase", "Startup phase")}: ${startupStatus && startupStatus.phase ? startupStatus.phase : "-"}`,
        `${t("setup.startup_error", "Startup error")}: ${startupStatus && startupStatus.error ? startupStatus.error : "-"}`,
        `${t("setup.router_check", "Router check")}: ${routerStatus ? JSON.stringify(routerStatus) : "-"}`,
      ]
      if (serverDebug) {
        lines.push(`${t("setup.flags", "Flags")}: ${JSON.stringify(serverDebug.flags || null)}`)
        lines.push(`${t("setup.caddy", "Caddy")}: ${JSON.stringify(serverDebug.caddy || null)}`)
        if (serverDebug.caddy && Array.isArray(serverDebug.caddy.startup_output) && serverDebug.caddy.startup_output.length > 0) {
          lines.push(`${t("setup.caddy_startup_output", "Caddy startup output")}:`)
          lines.push(...serverDebug.caddy.startup_output)
        }
        lines.push(`${t("setup.peer", "Peer")}: ${JSON.stringify(serverDebug.peer || null)}`)
        lines.push(`${t("setup.router", "Router")}: ${JSON.stringify(serverDebug.router || null)}`)
        lines.push(`${t("setup.wait", "Wait")}: ${JSON.stringify(serverDebug.wait || null)}`)
      }
      if (state.events.length > 0) {
        lines.push("")
        lines.push(`${t("setup.recent_page_events", "Recent page events")}:`)
        lines.push(...state.events)
      }
      if (serverDebug && Array.isArray(serverDebug.events) && serverDebug.events.length > 0) {
        lines.push("")
        lines.push(`${t("setup.recent_server_events", "Recent server events")}:`)
        for (const entry of serverDebug.events) {
          lines.push(`[${entry.at}] ${entry.message}`)
        }
      }
      body.textContent = lines.join("\n")
    }

    return {
      event,
      render,
      track,
    }
  }

  window.PinokioSetupWaitDebug = {
    create
  }
})();
