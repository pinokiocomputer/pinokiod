function createSecureRouterDebugStore() {
  return {
    events: [],
    state: {
      active: false,
      started_at: null,
      updated_at: null,
      last_status: null,
      caddy_start_attempted: false,
      caddy_start_finished: false,
      caddy_start_error: null,
      refresh_attempted: false,
      refresh_finished: false,
      refresh_error: null,
    }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function recordSecureRouterDebug(store, message, patch = {}) {
  if (!store) {
    return
  }
  const timestamp = new Date().toISOString()
  store.state = {
    ...(store.state || {}),
    ...patch,
    updated_at: timestamp
  }
  store.events.push({
    at: timestamp,
    message
  })
  if (store.events.length > 20) {
    store.events.shift()
  }
}

async function buildSecureRouterDebugSnapshot(server, store) {
  const kernel = server && server.kernel ? server.kernel : null
  const peer = kernel && kernel.peer ? kernel.peer : null
  const router = kernel && kernel.router && typeof kernel.router.published === "function"
    ? (kernel.router.published() || {})
    : {}
  const routerDialKeys = Object.keys(router)
  const hasPinokioLocalhost = routerDialKeys.some((dial) => {
    const domains = Array.isArray(router[dial]) ? router[dial] : []
    return domains.includes("pinokio.localhost")
  })
  const caddy = kernel && kernel.bin && kernel.bin.mod
    ? kernel.bin.mod.caddy
    : null
  let caddyInstalled = null
  let caddyRunning = null
  try {
    if (caddy && typeof caddy.installed === "function") {
      caddyInstalled = await caddy.installed()
    }
  } catch (error) {
    caddyInstalled = { error: error && error.message ? error.message : String(error) }
  }
  try {
    if (caddy && typeof caddy.running === "function") {
      caddyRunning = await caddy.running()
    }
  } catch (error) {
    caddyRunning = { error: error && error.message ? error.message : String(error) }
  }
  const startupStatus = server && typeof server.getStartupStatus === "function"
    ? server.getStartupStatus()
    : null
  const caddyStartupOutput = kernel && Array.isArray(kernel.caddy_startup_output)
    ? clone(kernel.caddy_startup_output)
    : []
  const state = store && store.state ? clone(store.state) : {}
  const events = store && Array.isArray(store.events) ? clone(store.events) : []
  return {
    wait: state,
    flags: {
      peer_active: peer ? !!peer.peer_active : null,
      https_active: peer ? !!peer.https_active : null,
      active: peer ? !!peer.active : null,
    },
    caddy: {
      installed: caddyInstalled,
      running: caddyRunning,
      start_attempted: !!state.caddy_start_attempted,
      start_finished: !!state.caddy_start_finished,
      start_error: state.caddy_start_error || null,
      startup_output: caddyStartupOutput,
    },
    peer: {
      host: peer && peer.host ? peer.host : null,
      name: peer && peer.name ? peer.name : null,
      has_info: !!(peer && peer.info),
      has_host_info: !!(peer && peer.info && peer.host && peer.info[peer.host]),
      refreshing: !!(peer && peer.refreshing),
    },
    router: {
      published_count: routerDialKeys.length,
      published_dials: routerDialKeys.slice(0, 10),
      has_pinokio_localhost: hasPinokioLocalhost,
      refresh_attempted: !!state.refresh_attempted,
      refresh_finished: !!state.refresh_finished,
      refresh_error: state.refresh_error || null,
      last_status: state.last_status || null,
    },
    startup: startupStatus,
    events
  }
}

module.exports = {
  buildSecureRouterDebugSnapshot,
  createSecureRouterDebugStore,
  recordSecureRouterDebug,
}
