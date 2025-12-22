  const TAB_LINK_POPOVER_ID = "tab-link-popover"
  let tabLinkPopoverEl = null
  let tabLinkActiveLink = null
  let tabLinkPendingLink = null
  let tabLinkHideTimer = null
  let tabLinkLocalInfoPromise = null
  let tabLinkLocalInfoExpiry = 0
  let tabLinkRouterInfoPromise = null
  let tabLinkRouterInfoExpiry = 0
  let tabLinkRouterHttpsActive = null
  let tabLinkPeerInfoPromise = null
  let tabLinkPeerInfoExpiry = 0
  const TAB_LINK_TRIGGER_CLASS = "tab-link-popover-trigger"
  const TAB_LINK_TRIGGER_HOST_CLASS = "tab-link-popover-host"

  const shouldAttachTabLinkTrigger = (link) => {
    if (!link || !link.classList || !link.classList.contains("frame-link")) {
      return false
    }
    if (!link.hasAttribute("href")) {
      return false
    }
    const href = link.getAttribute("href")
    return typeof href === "string" && href.trim().length > 0
  }

  const createTabLinkTrigger = () => {
    const trigger = document.createElement("span")
    trigger.className = TAB_LINK_TRIGGER_CLASS
    trigger.setAttribute("role", "button")
    trigger.setAttribute("tabindex", "0")
    trigger.setAttribute("aria-label", "Open in browser")
    trigger.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>'
    return trigger
  }

  const ensureTabLinkTrigger = (link) => {
    if (!shouldAttachTabLinkTrigger(link)) {
      return
    }
    if (link.querySelector(`.${TAB_LINK_TRIGGER_CLASS}`)) {
      return
    }
    link.classList.add(TAB_LINK_TRIGGER_HOST_CLASS)
    link.appendChild(createTabLinkTrigger())
  }

  const ensureTabLinkPopoverEl = () => {
    if (!tabLinkPopoverEl) {
      tabLinkPopoverEl = document.createElement("div")
      tabLinkPopoverEl.id = TAB_LINK_POPOVER_ID
      tabLinkPopoverEl.className = "tab-link-popover"
      tabLinkPopoverEl.addEventListener("mouseenter", () => {
        if (tabLinkHideTimer) {
          clearTimeout(tabLinkHideTimer)
          tabLinkHideTimer = null
        }
      })
      tabLinkPopoverEl.addEventListener("mouseleave", () => {
        hideTabLinkPopover({ immediate: true })
      })
      tabLinkPopoverEl.addEventListener("click", (event) => {
        const item = event.target.closest(".tab-link-popover-item")
        if (!item) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const url = item.getAttribute("data-url")
        if (url) {
          const targetMode = (item.getAttribute("data-target") || "_blank").toLowerCase()
          if (targetMode === "_self") {
            window.location.assign(url)
          } else {
            const agent = document.body ? document.body.getAttribute("data-agent") : null
            if (agent === "electron") {
              window.open(url, "_blank", "browser")
            } else {
              window.open(url, "_blank")
            }
//            fetch("/go", {
//              method: "POST",
//              headers: {
//                "Content-Type": "application/json"
//              },
//              body: JSON.stringify({ url })
//            }).then((res) => {
//              return res.json()
//            }).then((res) => {
//              console.log(res)
//            })
          }
        }
        hideTabLinkPopover({ immediate: true })
      })
      document.body.appendChild(tabLinkPopoverEl)
    }
    return tabLinkPopoverEl
  }

  const ensurePeerInfo = async () => {
    const now = Date.now()
    if (!tabLinkPeerInfoPromise || now > tabLinkPeerInfoExpiry) {
      tabLinkPeerInfoPromise = fetch("/pinokio/peer", {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load peer info")
          }
          return response.json()
        })
        .catch(() => null)
      tabLinkPeerInfoExpiry = now + 3000
    }
    return tabLinkPeerInfoPromise
  }

  const canonicalizeUrl = (value) => {
    try {
      const parsed = new URL(value, location.origin)
      if (!parsed.protocol) {
        return value
      }
      const protocol = parsed.protocol.toLowerCase()
      if (protocol !== "http:" && protocol !== "https:") {
        return value
      }
      const hostname = parsed.hostname.toLowerCase()
      const port = parsed.port ? `:${parsed.port}` : ""
      let pathname = parsed.pathname || "/"
      if (pathname !== "/") {
        pathname = pathname.replace(/\/+/g, "/")
        if (pathname.length > 1 && pathname.endsWith("/")) {
          pathname = pathname.slice(0, -1)
        }
      }
      const search = parsed.search || ""
      return `${protocol}//${hostname}${port}${pathname}${search}`
    } catch (_) {
      return value
    }
  }

  const ensureHttpDirectoryUrl = (value) => {
    try {
      const parsed = new URL(value)
      if (parsed.protocol.toLowerCase() !== "http:") {
        return value
      }
      let pathname = parsed.pathname || "/"
      const lastSegment = pathname.split("/").pop() || ""
      const hasExtension = lastSegment.includes(".")
      if (!hasExtension && !pathname.endsWith("/")) {
        pathname = `${pathname}/`
        parsed.pathname = pathname
      }
      parsed.hash = parsed.hash || ""
      parsed.search = parsed.search || ""
      return parsed.toString()
    } catch (_) {
      return value
    }
  }

  const isLocalHostLike = (hostname) => {
    if (!hostname) {
      return false
    }
    const hostLower = hostname.toLowerCase()
    if (hostLower === location.hostname.toLowerCase()) {
      return true
    }
    if (hostLower === "localhost" || hostLower === "0.0.0.0") {
      return true
    }
    if (hostLower.startsWith("127.")) {
      return true
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostLower)) {
      return true
    }
    return false
  }

  const isIPv4Host = (host) => /^(\d{1,3}\.){3}\d{1,3}$/.test((host || '').trim())

  const normalizeHostValue = (value) => {
    if (!value || typeof value !== 'string') {
      return ''
    }
    return value.trim().toLowerCase()
  }

  const classifyHostScope = (host) => {
    const value = normalizeHostValue(host)
    if (!value) {
      return 'unknown'
    }
    if (value === 'localhost' || value === '0.0.0.0' || value.startsWith('127.')) {
      return 'loopback'
    }
    if (/^10\./.test(value)) {
      return 'lan'
    }
    if (/^192\.168\./.test(value)) {
      return 'lan'
    }
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(value)) {
      return 'lan'
    }
    if (/^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(value)) {
      return 'cgnat'
    }
    if (/^169\.254\./.test(value) || value.startsWith('fe80:')) {
      return 'linklocal'
    }
    return 'public'
  }

  const scopeToBadge = (scope) => {
    if (!scope || typeof scope !== 'string') {
      return ''
    }
    const normalized = scope.trim().toLowerCase()
    switch (normalized) {
      case 'lan':
        return 'LAN'
      case 'cgnat':
        return 'VPN'
      case 'public':
        return 'Public'
      case 'loopback':
        return 'Local'
      case 'linklocal':
        return 'Link-Local'
      default:
        return ''
    }
  }

  const mergeMeta = (existing, incoming) => {
    if (!incoming) {
      return existing || null
    }
    if (!existing) {
      return { ...incoming }
    }
    const merged = { ...existing }
    const assignIfMissing = (key) => {
      if ((merged[key] === undefined || merged[key] === null || merged[key] === '') && incoming[key]) {
        merged[key] = incoming[key]
      }
    }
    assignIfMissing('scope')
    assignIfMissing('interface')
    assignIfMissing('source')
    assignIfMissing('host')
    assignIfMissing('port')
    return merged
  }

  const extractProjectSlug = (node) => {
    if (!node) {
      return ""
    }
    const explicit = node.getAttribute("data-project-slug")
    if (typeof explicit === "string" && explicit.trim().length > 0) {
      return explicit.trim().toLowerCase()
    }
    const candidates = []
    const targetFull = node.getAttribute("data-target-full")
    if (typeof targetFull === "string" && targetFull.length > 0) {
      candidates.push(targetFull)
    }
    const dataHref = node.getAttribute("href")
    if (typeof dataHref === "string" && dataHref.length > 0) {
      candidates.push(dataHref)
    }
    try {
      const absolute = new URL(node.href, location.origin)
      candidates.push(absolute.pathname)
    } catch (_) {
      // ignore
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || candidate.length === 0) {
        continue
      }
      const assetMatch = candidate.match(/\/asset\/api\/([^\/?#]+)/i)
      if (assetMatch && assetMatch[1]) {
        return assetMatch[1]
      }
      const pageMatch = candidate.match(/\/p\/([^\/?#]+)/i)
      if (pageMatch && pageMatch[1]) {
        return pageMatch[1]
      }
      const apiMatch = candidate.match(/\/api\/([^\/?#]+)/i)
      if (apiMatch && apiMatch[1]) {
        return apiMatch[1]
      }
    }
    return ""
  }

  const formatDisplayUrl = (value) => {
    try {
      const parsed = new URL(value, location.origin)
      const host = parsed.host
      const pathname = parsed.pathname || "/"
      const hash = parsed.hash || ""
      return `${host}${pathname}${hash}`
    } catch (_) {
      return value
    }
  }

  const isHttpOrHttps = (value) => {
    try {
      const parsed = new URL(value, location.origin)
      const protocol = parsed.protocol.toLowerCase()
      return protocol === "http:" || protocol === "https:"
    } catch (_) {
      return false
    }
  }

  const isHttpUrl = (value) => {
    try {
      const parsed = new URL(value, location.origin)
      return parsed.protocol.toLowerCase() === "http:"
    } catch (_) {
      return false
    }
  }

  const isHttpsUrl = (value) => {
    try {
      const parsed = new URL(value, location.origin)
      return parsed.protocol.toLowerCase() === "https:"
    } catch (_) {
      return false
    }
  }

  const collectUrlsFromLocal = (root) => {
    if (!root || typeof root !== "object") {
      return []
    }
    const queue = [root]
    const visited = new Set()
    const urls = new Set()
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || typeof current !== "object") {
        continue
      }
      if (visited.has(current)) {
        continue
      }
      visited.add(current)
      const values = Array.isArray(current) ? current : Object.values(current)
      for (const value of values) {
        if (typeof value === "string") {
          if (isHttpOrHttps(value)) {
            urls.add(value)
          }
        } else if (value && typeof value === "object") {
          queue.push(value)
        }
      }
    }
    return Array.from(urls)
  }

  const collectScriptKeys = (node) => {
    const keys = new Set()
    const scriptAttr = node.getAttribute("data-script")
    if (scriptAttr) {
      const decoded = decodeURIComponent(scriptAttr)
      if (decoded) {
        keys.add(decoded)
        const withoutQuery = decoded.split("?")[0]
        if (withoutQuery) {
          keys.add(withoutQuery)
        }
      }
    }
    const filepathAttr = node.getAttribute("data-filepath")
    if (filepathAttr) {
      keys.add(filepathAttr)
    }
    return Array.from(keys)
  }

  const ensureLocalMemory = async () => {
    const now = Date.now()
    if (!tabLinkLocalInfoPromise || now > tabLinkLocalInfoExpiry) {
      tabLinkLocalInfoPromise = fetch("/info/local", {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load local info")
          }
          return response.json()
        })
        .catch(() => ({}))
      tabLinkLocalInfoExpiry = now + 3000
    }
    return tabLinkLocalInfoPromise
  }

  const normalizeHttpsTarget = (value) => {
    if (!value || typeof value !== "string") {
      return ""
    }
    let trimmed = value.trim()
    if (!trimmed) {
      return ""
    }
    // If it's already a URL, ensure it's HTTPS and not an IP host
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed)
        const host = (parsed.hostname || '').toLowerCase()
        if (!host || isIPv4Host(host)) {
          return ""
        }
        // Only accept domains (prefer *.localhost) for HTTPS targets
        if (!(host === 'localhost' || host.endsWith('.localhost') || host.includes('.'))) {
          return ""
        }
        let pathname = parsed.pathname || ""
        if (pathname === "/") pathname = ""
        const search = parsed.search || ""
        return `https://${host}${pathname}${search}`
      } catch (_) {
        return ""
      }
    }
    // Not a full URL: accept plain domains (prefer *.localhost), reject IPs
    try {
      const hostCandidate = trimmed.split('/')[0].toLowerCase()
      if (!hostCandidate || isIPv4Host(hostCandidate)) {
        return ""
      }
      if (!(hostCandidate === 'localhost' || hostCandidate.endsWith('.localhost') || hostCandidate.includes('.'))) {
        return ""
      }
      return `https://${hostCandidate}`
    } catch (_) {
      return ""
    }
  }

  const parseHostPort = (value) => {
    if (!value || typeof value !== "string") {
      return null
    }
    let trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed)
        if (!parsed.hostname) {
          return null
        }
        const protocol = parsed.protocol.toLowerCase()
        let port = parsed.port
        if (!port) {
          if (protocol === "http:") {
            port = "80"
          } else if (protocol === "https:") {
            port = "443"
          }
        }
        if (!port) {
          return null
        }
        return {
          host: parsed.hostname.toLowerCase(),
          port
        }
      } catch (_) {
        return null
      }
    }
    const slashIndex = trimmed.indexOf("/")
    if (slashIndex >= 0) {
      trimmed = trimmed.slice(0, slashIndex)
    }
    const match = trimmed.match(/^\[?([^\]]+)\]?(?::([0-9]+))$/)
    if (!match) {
      return null
    }
    const host = match[1] ? match[1].toLowerCase() : ""
    const port = match[2] || ""
    if (!host || !port) {
      return null
    }
    return { host, port }
  }

  const ensureRouterInfoMapping = async () => {
    const now = Date.now()
    if (!tabLinkRouterInfoPromise || now > tabLinkRouterInfoExpiry) {
      // Use lightweight router mapping to avoid favicon/installed overhead
      tabLinkRouterInfoPromise = fetch("/info/router", {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load system info")
          }
          return response.json()
        })
        .then((data) => {
          if (typeof data?.https_active === "boolean") {
            tabLinkRouterHttpsActive = data.https_active
          }
          const processes = Array.isArray(data?.router_info) ? data.router_info : []
          const rewriteMapping = data?.rewrite_mapping && typeof data.rewrite_mapping === "object"
            ? Object.values(data.rewrite_mapping)
            : []
          const portMap = new Map()
          const hostPortMap = new Map()
          const externalHttpByExtPort = new Map() // ext port -> Set of host:port (external_ip)
          const externalHttpByIntPort = new Map() // internal port -> Set of host:port (external_ip)
          const externalHostMeta = new Map() // host:port -> meta info
          const hostAliasPortMap = new Map()
          if (data?.router && typeof data.router === "object") {
            Object.entries(data.router).forEach(([dial, hosts]) => {
              const parsedDial = parseHostPort(dial)
              if (!parsedDial || !parsedDial.port) {
                return
              }
              if (!Array.isArray(hosts)) {
                return
              }
              hosts.forEach((host) => {
                if (typeof host !== "string") {
                  return
                }
                const trimmed = host.trim().toLowerCase()
                if (!trimmed) {
                  return
                }
                if (!hostAliasPortMap.has(trimmed)) {
                  hostAliasPortMap.set(trimmed, new Set())
                }
                hostAliasPortMap.get(trimmed).add(parsedDial.port)
              })
            })
          }
          const localAliases = ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"]

          const registerExternalHttpHost = ({ host, port, internalPort, scope, iface, source }) => {
            if (!host || !port) {
              return
            }
            const hostTrimmed = `${host}`.trim()
            const portTrimmed = `${port}`.trim()
            if (!hostTrimmed || !portTrimmed) {
              return
            }
            const hostPort = `${hostTrimmed}:${portTrimmed}`
            if (!externalHttpByExtPort.has(portTrimmed)) {
              externalHttpByExtPort.set(portTrimmed, new Set())
            }
            externalHttpByExtPort.get(portTrimmed).add(hostPort)
            if (internalPort) {
              const intKey = `${internalPort}`.trim()
              if (intKey) {
                if (!externalHttpByIntPort.has(intKey)) {
                  externalHttpByIntPort.set(intKey, new Set())
                }
                externalHttpByIntPort.get(intKey).add(hostPort)
              }
            }
            if (!externalHostMeta.has(hostPort)) {
              const inferredScope = scope || classifyHostScope(hostTrimmed)
              externalHostMeta.set(hostPort, {
                scope: inferredScope,
                interface: iface || null,
                source: source || null,
                host: hostTrimmed,
                port: portTrimmed
              })
            } else {
              const current = externalHostMeta.get(hostPort)
              externalHostMeta.set(hostPort, mergeMeta(current, {
                scope: scope || classifyHostScope(hostTrimmed),
                interface: iface || null,
                source: source || null,
                host: hostTrimmed,
                port: portTrimmed
              }))
            }
          }

          const addHttpMapping = (host, port, httpsSet) => {
            if (!host || !port || !httpsSet || httpsSet.size === 0) {
              return
            }
            const hostLower = host.toLowerCase()
            const keys = new Set([`${hostLower}:${port}`])
            if (localAliases.includes(hostLower)) {
              localAliases.forEach((alias) => keys.add(`${alias}:${port}`))
            }
            keys.forEach((key) => {
              if (!hostPortMap.has(key)) {
                hostPortMap.set(key, new Set())
              }
              const set = hostPortMap.get(key)
              httpsSet.forEach((url) => set.add(url))
            })
            if (localAliases.includes(hostLower)) {
              if (!portMap.has(port)) {
                portMap.set(port, new Set())
              }
              const portSet = portMap.get(port)
              httpsSet.forEach((url) => portSet.add(url))
            }
          }

          const gatherHttpsTargets = (value) => {
            const targets = new Set()
            const visit = (input) => {
              if (!input) {
                return
              }
              if (Array.isArray(input)) {
                input.forEach(visit)
                return
              }
              if (typeof input === "object") {
                Object.values(input).forEach(visit)
                return
              }
              if (typeof input !== "string") {
                return
              }
              const normalized = normalizeHttpsTarget(input)
              if (normalized) {
                targets.add(normalized)
              }
            }
            visit(value)
            return targets
          }

          const collectHostPort = (value, hostPortCandidates, portCandidates) => {
            if (!value) {
              return
            }
            if (Array.isArray(value)) {
              value.forEach((item) => collectHostPort(item, hostPortCandidates, portCandidates))
              return
            }
            if (typeof value === "object") {
              Object.values(value).forEach((item) => {
                collectHostPort(item, hostPortCandidates, portCandidates)
              })
              return
            }
            if (typeof value !== "string") {
              return
            }
            const parsed = parseHostPort(value)
            let hostLower
            if (parsed && parsed.host && parsed.port) {
              hostLower = parsed.host.toLowerCase()
              hostPortCandidates.add(`${hostLower}:${parsed.port}`)
              if (localAliases.includes(hostLower)) {
                portCandidates.add(parsed.port)
              }
            }
            const rawHost = value.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase()
            const aliasPorts = hostAliasPortMap.get(rawHost)
            if (aliasPorts && aliasPorts.size > 0) {
              aliasPorts.forEach((aliasPort) => {
                hostPortCandidates.add(`${rawHost}:${aliasPort}`)
                if (localAliases.includes(rawHost)) {
                  portCandidates.add(aliasPort)
                }
              })
            }
          }

          const collectPort = (value, portCandidates) => {
            if (value === null || value === undefined || value === "") {
              return
            }
            if (Array.isArray(value)) {
              value.forEach((item) => collectPort(item, portCandidates))
              return
            }
            const port = `${value}`.trim()
            if (port && /^[0-9]+$/.test(port)) {
              portCandidates.add(port)
            }
          }

          const registerEntry = (entry) => {
            if (!entry || typeof entry !== "object") {
              return
            }
            const httpsTargets = new Set()
            const mergeTargets = (targetValue) => {
              const targets = gatherHttpsTargets(targetValue)
              targets.forEach((url) => httpsTargets.add(url))
            }

            mergeTargets(entry.external_router)
            mergeTargets(entry.external_domain)
            mergeTargets(entry.https_href)
            mergeTargets(entry.app_href)
            // Some rewrite mapping entries expose domain candidates under `hosts`
            mergeTargets(entry.hosts)
            // Internal router can also include domain aliases (e.g., comfyui.localhost)
            mergeTargets(entry.internal_router)

            // Record external http host:port candidates by external and internal ports for later
            if (entry.external_ip && typeof entry.external_ip === 'string') {
              const parsed = parseHostPort(entry.external_ip)
              if (parsed && parsed.host && parsed.port) {
                registerExternalHttpHost({
                  host: parsed.host,
                  port: parsed.port,
                  internalPort: entry.internal_port,
                  source: 'external_ip'
                })
              }
            }
            if (Array.isArray(entry.external_hosts)) {
              entry.external_hosts.forEach((hostEntry) => {
                if (!hostEntry) {
                  return
                }
                if (typeof hostEntry === 'string') {
                  const parsed = parseHostPort(hostEntry)
                  if (parsed && parsed.host && parsed.port) {
                    registerExternalHttpHost({
                      host: parsed.host,
                      port: parsed.port,
                      internalPort: entry.internal_port,
                      source: 'external_hosts'
                    })
                  }
                  return
                }
                if (typeof hostEntry === 'object') {
                  let host = typeof hostEntry.host === 'string' ? hostEntry.host : null
                  if (!host && typeof hostEntry.address === 'string') {
                    host = hostEntry.address
                  }
                  let portValue = hostEntry.port || hostEntry.external_port
                  if ((!host || !portValue) && typeof hostEntry.url === 'string') {
                    const parsed = parseHostPort(hostEntry.url)
                    if (parsed) {
                      if (!host && parsed.host) {
                        host = parsed.host
                      }
                      if (!portValue && parsed.port) {
                        portValue = parsed.port
                      }
                    }
                  }
                  registerExternalHttpHost({
                    host,
                    port: portValue,
                    internalPort: entry.internal_port,
                    scope: typeof hostEntry.scope === 'string' ? hostEntry.scope : null,
                    iface: typeof hostEntry.interface === 'string' ? hostEntry.interface : null,
                    source: 'external_hosts'
                  })
                }
              })
            }

            if (httpsTargets.size === 0) {
              return
            }

            const hostPortCandidates = new Set()
            const portCandidates = new Set()

            collectHostPort(entry.external_ip, hostPortCandidates, portCandidates)
            collectHostPort(entry.internal_ip, hostPortCandidates, portCandidates)
            collectHostPort(entry.ip, hostPortCandidates, portCandidates)
            collectHostPort(entry.dial, hostPortCandidates, portCandidates)
            collectHostPort(entry.match, hostPortCandidates, portCandidates)
            collectHostPort(entry.target, hostPortCandidates, portCandidates)
            collectHostPort(entry.forward, hostPortCandidates, portCandidates)
            collectHostPort(entry.internal_router, hostPortCandidates, portCandidates)
            collectHostPort(entry.external_router, hostPortCandidates, portCandidates)

            collectPort(entry.port, portCandidates)
            collectPort(entry.internal_port, portCandidates)
            collectPort(entry.external_port, portCandidates)

            if (hostPortCandidates.size === 0 && portCandidates.size === 0) {
              httpsTargets.forEach((target) => {
                collectHostPort(target, hostPortCandidates, portCandidates)
              })
            }

            if (hostPortCandidates.size === 0 && portCandidates.size === 0) {
              return
            }

            hostPortCandidates.forEach((key) => {
              const parsed = parseHostPort(key)
              if (parsed) {
                addHttpMapping(parsed.host, parsed.port, httpsTargets)
              }
            })

            portCandidates.forEach((port) => {
              localAliases.forEach((host) => {
                addHttpMapping(host, port, httpsTargets)
              })
            })
          }

          const visited = new WeakSet()
          const traverseNode = (node) => {
            if (!node) {
              return
            }
            if (Array.isArray(node)) {
              node.forEach(traverseNode)
              return
            }
            if (typeof node !== "object") {
              return
            }
            if (visited.has(node)) {
              return
            }
            visited.add(node)
            registerEntry(node)
            Object.values(node).forEach((value) => {
              if (value && typeof value === "object") {
                traverseNode(value)
              }
            })
          }

          processes.forEach(traverseNode)
          rewriteMapping.forEach(traverseNode)

          return {
            portMap,
            hostPortMap,
            externalHttpByExtPort,
            externalHttpByIntPort,
            externalHostMeta
          }
        })
        .catch(() => {
          tabLinkRouterHttpsActive = null
          return {
            portMap: new Map(),
            hostPortMap: new Map(),
            externalHttpByExtPort: new Map(),
            externalHttpByIntPort: new Map(),
            externalHostMeta: new Map()
          }
        })
      tabLinkRouterInfoExpiry = now + 3000
    }
    return tabLinkRouterInfoPromise
  }

  const collectHttpsUrlsFromRouter = (httpUrl, routerData) => {
    if (!routerData) {
      return []
    }
    let parsed
    try {
      parsed = new URL(httpUrl, location.origin)
    } catch (_) {
      return []
    }
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") {
      return []
    }
    let port = parsed.port
    if (!port) {
      if (protocol === "http:") {
        port = "80"
      } else if (protocol === "https:") {
        port = "443"
      }
    }
    const hostLower = parsed.hostname.toLowerCase()
    const results = new Set()
    if (port) {
      const hostPortKey = `${hostLower}:${port}`
      if (routerData.hostPortMap.has(hostPortKey)) {
        routerData.hostPortMap.get(hostPortKey).forEach((value) => results.add(value))
      }
      if (routerData.portMap.has(port)) {
        routerData.portMap.get(port).forEach((value) => results.add(value))
      }
    }
    return Array.from(results)
  }

  const buildTabLinkEntries = async (
    link,
    baseHrefOverride = null,
    { forceCanonicalQr = false, allowQrPortMismatch = false, skipPeerFallback = false } = {}
  ) => {
    const sourceLink = link || null
    const baseHref = baseHrefOverride || (sourceLink ? sourceLink.href : "")
    if (!baseHref) {
      return []
    }

    let canonicalBase = canonicalizeUrl(baseHref)
    if (canonicalBase && isHttpUrl(canonicalBase)) {
      canonicalBase = ensureHttpDirectoryUrl(canonicalBase)
    }
    let parsedBaseUrl = null
    let sameOrigin = false
    let basePortNormalized = ""
    try {
      parsedBaseUrl = new URL(baseHref, location.origin)
      sameOrigin = parsedBaseUrl.origin === location.origin
      if (parsedBaseUrl) {
        basePortNormalized = parsedBaseUrl.port
        if (!basePortNormalized) {
          const proto = parsedBaseUrl.protocol ? parsedBaseUrl.protocol.toLowerCase() : "http:"
          basePortNormalized = proto === "https:" ? "443" : "80"
        }
      }
    } catch (_) {}
    const projectSlug = extractProjectSlug(sourceLink).toLowerCase()
    const entries = []
    const entryByUrl = new Map()
    const addEntry = (type, label, url, opts = {}) => {
      if (!url) {
        return
      }
      let canonical = canonicalizeUrl(url)
      if (canonical && type === "http") {
        canonical = ensureHttpDirectoryUrl(canonical)
      }
      if (!canonical) {
        return
      }
      let skip = false
      const allowSameOrigin = opts && opts.allowSameOrigin === true
      try {
        const parsed = new URL(canonical)
        const originLower = parsed.origin.toLowerCase()
        if (!allowSameOrigin && originLower === location.origin.toLowerCase()) {
          skip = true
        }
      } catch (_) {
        // ignore parse failures but do not skip by default
      }
      if (skip) {
        return
      }
      if (entryByUrl.has(canonical)) {
        const existing = entryByUrl.get(canonical)
        if (opts && opts.qr === true) existing.qr = true
        if (opts && opts.meta) {
          existing.meta = mergeMeta(existing.meta, opts.meta)
          existing.badge = scopeToBadge(existing.meta && existing.meta.scope ? existing.meta.scope : '')
        }
        return
      }
      const entryMeta = opts && opts.meta ? opts.meta : null
      const entry = {
        type,
        label,
        url: canonical,
        display: formatDisplayUrl(canonical),
        qr: opts && opts.qr === true,
        meta: entryMeta,
        badge: scopeToBadge(entryMeta && entryMeta.scope ? entryMeta.scope : '')
      }
      entryByUrl.set(canonical, entry)
      entries.push(entry)
    }

    if (isHttpUrl(baseHref)) {
      addEntry("http", "HTTP", baseHref, { allowSameOrigin: true })
    } else if (isHttpsUrl(baseHref)) {
      addEntry("https", "HTTPS", baseHref, { allowSameOrigin: true })
    } else {
      addEntry("url", "URL", baseHref, { allowSameOrigin: true })
    }

    const httpCandidates = new Map() // url -> { qr: boolean, meta: object|null }
    const httpsCandidates = new Set()

    const upsertHttpCandidate = (url, { qr = false, meta = null } = {}) => {
      if (!url) {
        return
      }
      const existing = httpCandidates.get(url) || { qr: false, meta: null }
      if (qr === true) {
        existing.qr = true
      }
      if (meta) {
        existing.meta = mergeMeta(existing.meta, meta)
      }
      httpCandidates.set(url, existing)
    }

    if (isHttpUrl(baseHref)) {
      upsertHttpCandidate(canonicalBase || canonicalizeUrl(baseHref), { qr: false })
    } else if (isHttpsUrl(baseHref)) {
      if (canonicalBase) {
        httpsCandidates.add(canonicalBase)
      } else {
        httpsCandidates.add(canonicalizeUrl(baseHref))
      }
    }

    if (projectSlug) {
      try {
        const baseUrl = parsedBaseUrl || new URL(baseHref, location.origin)
        let pathname = baseUrl.pathname || "/"
        if (pathname.endsWith("/index.html")) {
          pathname = pathname.slice(0, -"/index.html".length)
        }
        if (!pathname.endsWith("/")) {
          pathname = `${pathname}/`
        }
        const normalizedPath = pathname.toLowerCase()
        if (normalizedPath.includes(`/asset/api/${projectSlug}`)) {
          const fallbackHttp = `http://127.0.0.1:42000${pathname}`
          upsertHttpCandidate(canonicalizeUrl(fallbackHttp), { qr: false })
        } else if (normalizedPath.includes(`/api/${projectSlug}`)) {
          const fallbackHttp = `http://127.0.0.1:42000/asset/api/${projectSlug}/`
          upsertHttpCandidate(canonicalizeUrl(fallbackHttp), { qr: false })
        }
      } catch (_) {
        // ignore fallback errors
      }
    }

    const scriptKeys = collectScriptKeys(sourceLink)
    if (scriptKeys.length > 0) {
      const localInfo = await ensureLocalMemory()
      scriptKeys.forEach((key) => {
        if (!key) {
          return
        }
        const local = localInfo ? localInfo[key] : undefined
        if (!local) {
          return
        }
        const urls = collectUrlsFromLocal(local)
        urls.forEach((value) => {
          const canonical = canonicalizeUrl(value)
          if (isHttpsUrl(canonical)) {
            httpsCandidates.add(canonical)
          } else if (isHttpUrl(canonical)) {
            upsertHttpCandidate(canonical, { qr: false })
          }
        })
      })
    }

    const routerData = await ensureRouterInfoMapping()
    if (httpCandidates.size > 0) {
      Array.from(httpCandidates.keys()).forEach((httpUrl) => {
        const mapped = collectHttpsUrlsFromRouter(httpUrl, routerData)
        mapped.forEach((httpsUrl) => {
          httpsCandidates.add(httpsUrl)
        })
      })
    }

    // Add external 192.168.* http host:port candidates mapped from the same internal port as base HTTP
    try {
      const base = parsedBaseUrl || new URL(baseHref, location.origin)
      let basePort = base.port
      if (!basePort) {
        basePort = base.protocol.toLowerCase() === 'https:' ? '443' : '80'
      }
      const samePortHosts = routerData && routerData.externalHttpByIntPort ? routerData.externalHttpByIntPort.get(basePort) : null
      if (samePortHosts && samePortHosts.size > 0) {
        samePortHosts.forEach((hostport) => {
          try {
            const hpUrl = `http://${hostport}${base.pathname || '/'}${base.search || ''}`
            const canonical = canonicalizeUrl(hpUrl)
            if (isHttpUrl(canonical)) {
              const meta = routerData && routerData.externalHostMeta ? routerData.externalHostMeta.get(hostport) : null
              upsertHttpCandidate(canonical, { qr: true, meta })
            }
          } catch (_) {}
        })
      }
    } catch (_) {}

    const httpsList = Array.from(httpsCandidates).sort()

    if (httpsList.length > 0) {
      httpsList.forEach((url) => {
        try {
          const parsed = new URL(url)
          if (parsed.protocol.toLowerCase() !== "https:") {
            return
          }
          if (!parsed.port || parsed.port !== "42000") {
            return
          }
          const hostPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
          const httpUrl = `http://${hostPort}${parsed.pathname || "/"}${parsed.search || ""}`
          const key = canonicalizeUrl(httpUrl)
          upsertHttpCandidate(key, { qr: false })
        } catch (_) {
          // ignore failures
        }
      })
    }

    const httpList = Array.from(httpCandidates.keys()).sort()

    httpList.forEach((url) => {
      const candidate = httpCandidates.get(url) || { qr: false, meta: null }
      addEntry("http", "HTTP", url, { qr: candidate.qr === true, meta: candidate.meta || null })
    })
    httpsList.forEach((url) => {
      addEntry("https", "HTTPS", url)
    })

    const matchesBasePort = (value) => {
      if (!basePortNormalized) {
        return true
      }
      try {
        const parsed = new URL(value, location.origin)
        let port = parsed.port
        if (!port) {
          const proto = parsed.protocol ? parsed.protocol.toLowerCase() : "http:"
          port = proto === "https:" ? "443" : "80"
        }
        return port === basePortNormalized
      } catch (_) {
        return false
      }
    }

    const shouldAddPeerFallback = !skipPeerFallback && (sameOrigin || forceCanonicalQr)
    if (shouldAddPeerFallback) {
      try {
        const peerInfo = await ensurePeerInfo()
        const peerHost = peerInfo && typeof peerInfo.host === "string" ? peerInfo.host.trim() : ""
        if (peerHost) {
          const peerHostLower = peerHost.toLowerCase()
          if (peerHostLower !== "localhost" && !peerHostLower.startsWith("127.")) {
            const baseUrl = parsedBaseUrl || new URL(baseHref, location.origin)
            const baseHostLower = (baseUrl.hostname || "").toLowerCase()
            const candidateList = Array.isArray(peerInfo?.host_candidates) ? peerInfo.host_candidates : []
            const metaForHost = (hostValue, source = 'peer-fallback') => {
              if (!hostValue) {
                return null
              }
              const normalized = normalizeHostValue(hostValue)
              const match = candidateList.find((candidate) => normalizeHostValue(candidate && candidate.address) === normalized)
              if (match) {
                return {
                  scope: typeof match.scope === 'string' ? match.scope : classifyHostScope(hostValue),
                  interface: typeof match.interface === 'string' ? match.interface : null,
                  source: 'peer-candidate',
                  host: match.address || hostValue
                }
              }
              return {
                scope: classifyHostScope(hostValue),
                interface: null,
                source,
                host: hostValue
              }
            }
            if (peerHostLower !== baseHostLower) {
              const baseProtocol = baseUrl.protocol ? baseUrl.protocol.toLowerCase() : "http:"
              const scheme = baseProtocol === "https:" ? "https://" : "http://"
              const port = baseUrl.port || (baseProtocol === "https:" ? "443" : "80")
              const hostPort = port ? `${peerHostLower}:${port}` : peerHostLower
              const pathSegment = baseUrl.pathname || "/"
              const searchSegment = baseUrl.search || ""
              const fallbackUrl = `${scheme}${hostPort}${pathSegment}${searchSegment}`
              const label = baseProtocol === "https:" ? "HTTPS" : "HTTP"
              addEntry(baseProtocol === "https:" ? "https" : "http", label, fallbackUrl, { qr: true, meta: metaForHost(peerHost) })
            }
            if (candidateList.length > 0) {
              candidateList.forEach((candidate) => {
                if (!candidate || typeof candidate.address !== "string") {
                  return
                }
                const candidateHost = candidate.address.trim()
                if (!candidateHost) {
                  return
                }
                const candidateHostLower = candidateHost.toLowerCase()
                if (candidateHostLower === peerHostLower) {
                  return
                }
                if (candidateHostLower === "localhost" || candidateHostLower.startsWith("127.")) {
                  return
                }
                const baseProtocol = baseUrl.protocol ? baseUrl.protocol.toLowerCase() : "http:"
                const scheme = baseProtocol === "https:" ? "https://" : "http://"
                const port = baseUrl.port || (baseProtocol === "https:" ? "443" : "80")
                const hostPort = port ? `${candidateHost}:${port}` : candidateHost
                const pathSegment = baseUrl.pathname || "/"
                const searchSegment = baseUrl.search || ""
                const fallbackUrl = `${scheme}${hostPort}${pathSegment}${searchSegment}`
                const label = baseProtocol === "https:" ? "HTTPS" : "HTTP"
                const entryMeta = {
                  scope: typeof candidate.scope === 'string' ? candidate.scope : classifyHostScope(candidateHost),
                  interface: typeof candidate.interface === 'string' ? candidate.interface : null,
                  source: 'peer-candidate',
                  host: candidateHost
                }
                addEntry(baseProtocol === "https:" ? "https" : "http", label, fallbackUrl, { qr: true, meta: entryMeta })
              })
            }
          }
        }
      } catch (_) {}
    }

    if (sameOrigin) {

      const filteredEntries = entries.filter((entry) => {
        if (!entry || !entry.url) {
          return false
        }
        if (entry.url === canonicalBase) {
          return true
        }
        if (entry.qr === true) {
          return matchesBasePort(entry.url)
        }
        return false
      })
      if (filteredEntries.length > 0) {
        return filteredEntries
      }
    }

    return entries
  }

  const positionTabLinkPopover = (popover, link) => {
    if (!popover || !link) {
      return
    }
    const rect = link.getBoundingClientRect()
    const minWidth = Math.max(rect.width, 260)
    popover.style.minWidth = `${Math.round(minWidth)}px`
    popover.style.display = "flex"
    popover.classList.add("visible")
    popover.style.visibility = "hidden"
    popover.style.maxHeight = ""
    popover.style.overflowY = ""
    const popoverWidth = popover.offsetWidth
    let popoverHeight = popover.offsetHeight
    const viewportPadding = 12
    const dropOffset = 8

    const appcanvas = document.querySelector(".appcanvas")
    const isVerticalLayout = !!(appcanvas && appcanvas.classList.contains("vertical"))

    let left
    let top

    if (isVerticalLayout) {
      left = rect.right + dropOffset
      top = rect.top

      if (left + popoverWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - popoverWidth - viewportPadding
      }
      if (left < viewportPadding) {
        left = viewportPadding
      }

      const availableHeight = Math.max(0, window.innerHeight - viewportPadding * 2)
      if (availableHeight > 0 && popoverHeight > availableHeight) {
        popover.style.maxHeight = `${Math.round(availableHeight)}px`
        popover.style.overflowY = "auto"
        popoverHeight = Math.min(availableHeight, popover.offsetHeight)
      }

      if (top + popoverHeight > window.innerHeight - viewportPadding) {
        top = window.innerHeight - popoverHeight - viewportPadding
      }
      if (top < viewportPadding) {
        top = viewportPadding
      }
    } else {
      left = rect.left
      top = Math.max(viewportPadding, rect.bottom + dropOffset)

      if (left + popoverWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - popoverWidth - viewportPadding
      }
      if (left < viewportPadding) {
        left = viewportPadding
      }

      const availableBelow = Math.max(0, window.innerHeight - viewportPadding - top)
      if (availableBelow > 0 && popoverHeight > availableBelow) {
        popover.style.maxHeight = `${Math.round(availableBelow)}px`
        popover.style.overflowY = "auto"
        popoverHeight = Math.min(availableBelow, popover.offsetHeight)
      }
    }

    popover.style.left = `${Math.round(left)}px`
    popover.style.top = `${Math.round(top)}px`
    popover.style.visibility = ""
  }

  const hideTabLinkPopover = ({ immediate = false } = {}) => {
    const applyHide = () => {
      if (tabLinkPopoverEl) {
        tabLinkPopoverEl.classList.remove("visible")
        tabLinkPopoverEl.style.display = "none"
      }
      tabLinkActiveLink = null
      tabLinkPendingLink = null
      tabLinkHideTimer = null
    }

    if (tabLinkHideTimer) {
      clearTimeout(tabLinkHideTimer)
      tabLinkHideTimer = null
    }

    if (immediate) {
      applyHide()
    } else {
      tabLinkHideTimer = setTimeout(applyHide, 120)
    }
  }

  const renderTabLinkPopover = async (link, options = {}) => {
    const hrefOverride = typeof options.hrefOverride === 'string' ? options.hrefOverride.trim() : ''
    const effectiveHref = hrefOverride || (link && link.href) || ''
    if (!link || !effectiveHref) {
      hideTabLinkPopover({ immediate: true })
      return
    }

    const requireAlternate = options && options.requireAlternate === false ? false : true
    const restrictToBase = options && options.restrictToBase === true
    const forceCanonicalQr = options && options.forceCanonicalQr === true
    let sameOrigin = false
    let canonicalBase = canonicalizeUrl(effectiveHref)
    if (canonicalBase && isHttpUrl(canonicalBase)) {
      canonicalBase = ensureHttpDirectoryUrl(canonicalBase)
    }
    let basePortNormalized = ""
    try {
      const linkUrl = new URL(effectiveHref, location.href)
      sameOrigin = linkUrl.origin === location.origin
      canonicalBase = canonicalizeUrl(linkUrl.href)
      if (canonicalBase && isHttpUrl(canonicalBase)) {
        canonicalBase = ensureHttpDirectoryUrl(canonicalBase)
      }
      basePortNormalized = linkUrl.port
      if (!basePortNormalized) {
        const proto = linkUrl.protocol ? linkUrl.protocol.toLowerCase() : "http:"
        basePortNormalized = proto === "https:" ? "443" : "80"
      }
    } catch (_) {
      hideTabLinkPopover({ immediate: true })
      return
    }

    const matchesBasePort = (value) => {
      if (!basePortNormalized) {
        return true
      }
      try {
        const parsed = new URL(value, location.origin)
        let port = parsed.port
        if (!port) {
          const proto = parsed.protocol ? parsed.protocol.toLowerCase() : "http:"
          port = proto === "https:" ? "443" : "80"
        }
        return port === basePortNormalized
      } catch (_) {
        return false
      }
    }

    if (tabLinkActiveLink === link && tabLinkPopoverEl && tabLinkPopoverEl.classList.contains("visible")) {
      if (tabLinkHideTimer) {
        clearTimeout(tabLinkHideTimer)
        tabLinkHideTimer = null
      }
      return
    }

    if (tabLinkPendingLink === link && tabLinkPopoverEl && tabLinkPopoverEl.classList.contains("visible")) {
      return
    }

    tabLinkPendingLink = link
    if (tabLinkHideTimer) {
      clearTimeout(tabLinkHideTimer)
      tabLinkHideTimer = null
    }

    // Show lightweight loading popover immediately while mapping fetch runs
    try {
      const pop = ensureTabLinkPopoverEl()
      pop.innerHTML = ''
      const header = document.createElement('div')
      header.className = 'tab-link-popover-header'
      header.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i><span>Open in browser</span>`
      const item = document.createElement('div')
      item.className = 'tab-link-popover-item'
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = 'Loading…'
      const value = document.createElement('span')
      value.className = 'value muted'
      value.textContent = 'Discovering routes'
      item.append(label, value)
      pop.append(header, item)
      positionTabLinkPopover(pop, link)
    } catch (_) {}

    let entries
    try {
      entries = await buildTabLinkEntries(link, effectiveHref, {
        forceCanonicalQr,
        allowQrPortMismatch: restrictToBase && options && options.allowQrPortMismatch === true,
        skipPeerFallback: options && options.skipPeerFallback === true
      })
    } catch (error) {
      tabLinkPendingLink = null
      console.error('[tab-link-popover] failed to build entries', error)
      hideTabLinkPopover({ immediate: true })
      return
    }

    if (tabLinkPendingLink !== link) {
      return
    }

    if (sameOrigin) {
      const slug = extractProjectSlug(link).toLowerCase()
      if (slug) {
        entries = entries.filter((entry) => {
          if (!entry || !entry.url) {
            return false
          }
        if (entry.url === canonicalBase) {
          return true
        }
        if (entry.qr === true) {
          return matchesBasePort(entry.url)
        }
        try {
          const parsed = new URL(entry.url)
            const hostLower = parsed.hostname ? parsed.hostname.toLowerCase() : ""
            if (isLocalHostLike(hostLower)) {
              if (entry.type === "http") {
                const pathLower = parsed.pathname ? parsed.pathname.toLowerCase() : ""
                if (pathLower.includes(`/asset/api/${slug}`) || pathLower.includes(`/p/${slug}`)) {
                  return true
                }
              }
              return false
            }
            const pathLower = parsed.pathname ? parsed.pathname.toLowerCase() : ""
            if (pathLower.includes(`/asset/api/${slug}`)) {
              return true
            }
            if (pathLower.includes(`/p/${slug}`)) {
              return true
            }
            if (hostLower.split(".").some((part) => part === slug)) {
              return true
            }
          } catch (_) {
            return false
          }
          return false
        })
      } else {
        entries = entries.filter((entry) => {
          if (!entry || !entry.url) {
            return false
          }
        if (entry.url === canonicalBase) {
          return true
        }
        return false
      })
    }

    entries = entries.filter((entry) => {
      if (!entry || !entry.url) {
        return false
      }
      if (entry.url === canonicalBase) {
        return true
      }
      if (entry.qr === true) {
        return matchesBasePort(entry.url)
      }
      return false
    })

  }

    const allowQrMismatch = options && options.allowQrPortMismatch === true
    if (restrictToBase) {
      entries = entries.filter((entry) => {
        if (!entry || !entry.url) {
          return false
        }
        if (canonicalBase && entry.url === canonicalBase) {
          return true
        }
        if (entry.qr === true) {
          return allowQrMismatch || matchesBasePort(entry.url)
        }
        return false
      })
    }

    if (forceCanonicalQr && canonicalBase) {
      try {
        const canonicalHost = new URL(canonicalBase).hostname.toLowerCase()
        const locationHost = (location.hostname || '').toLowerCase()
        const isLoopbackHost = canonicalHost === 'localhost' || canonicalHost === '0.0.0.0' || canonicalHost.startsWith('127.')
        if (!isLoopbackHost && isLocalHostLike(canonicalHost) && canonicalHost !== locationHost) {
          entries.forEach((entry) => {
            if (entry && entry.url === canonicalBase && entry.type === 'http') {
              entry.qr = true
            }
          })
        }
      } catch (_) {}
    }

    if (!entries || entries.length === 0) {
      hideTabLinkPopover({ immediate: true })
      return
    }

    const hasAlternate = entries.some((entry) => entry && entry.url && entry.url !== canonicalBase)
    if (requireAlternate && !hasAlternate) {
      console.debug('[tab-link-popover] no alternate routes for', effectiveHref)
      hideTabLinkPopover({ immediate: true })
      return
    }

    const popover = ensureTabLinkPopoverEl()
    popover.innerHTML = ""

    const header = document.createElement("div")
    header.className = "tab-link-popover-header"
    header.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i><span>Open in browser</span>`
    popover.appendChild(header)

    const hasHttpsEntry = entries.some((entry) => entry && entry.type === "https")

    entries.forEach((entry) => {
      const item = document.createElement("button")
      item.type = "button"
      item.setAttribute("data-url", entry.url)
      const labelSpan = document.createElement("span")
      labelSpan.className = "label"
      const labelText = entry && entry.badge ? `${entry.label} (${entry.badge})` : entry.label
      labelSpan.textContent = labelText
      const valueSpan = document.createElement("span")
      valueSpan.className = "value"
      valueSpan.textContent = entry.display
      valueSpan.title = entry.url

      if (entry.type === 'http' && entry.qr === true) {
        item.className = "tab-link-popover-item qr-inline"
        const textCol = document.createElement('div')
        textCol.className = 'textcol'
        textCol.append(labelSpan, valueSpan)
        const qrImg = document.createElement('img')
        qrImg.className = 'qr'
        qrImg.alt = 'QR'
        qrImg.decoding = 'async'
        qrImg.loading = 'lazy'
        qrImg.src = `/qr?data=${encodeURIComponent(entry.url)}&s=4&m=0`
        item.append(textCol, qrImg)
      } else {
        item.className = "tab-link-popover-item"
        // Keep label and value as direct children so column layout applies
        item.append(labelSpan, valueSpan)
      }
      popover.appendChild(item)
    })

    if (tabLinkRouterHttpsActive === false && !hasHttpsEntry) {
      const footerButton = document.createElement("button")
      footerButton.type = "button"
      footerButton.className = "tab-link-popover-item tab-link-popover-footer"
      footerButton.setAttribute("data-url", "/network")
      footerButton.setAttribute("data-target", "_self")
      footerButton.setAttribute("aria-label", "Open network settings to configure local HTTPS")

      const footerLabel = document.createElement("span")
      footerLabel.className = "label"
      footerLabel.textContent = "Custom domain not active"

      const footerValue = document.createElement("span")
      footerValue.className = "value"
      footerValue.textContent = "Click to activate"

      footerButton.append(footerLabel, footerValue)
      popover.appendChild(footerButton)
    }

    tabLinkActiveLink = link
    tabLinkPendingLink = null
    positionTabLinkPopover(popover, link)
  }

  const setupTabLinkHover = () => {
    const container = document.querySelector(".appcanvas > aside .menu-container")
    if (!container) {
      return
    }
    if (container.dataset.tabLinkPopoverReady === "1") {
      return
    }
    container.dataset.tabLinkPopoverReady = "1"

    const ensureTriggers = (root) => {
      if (!root || !root.querySelectorAll) {
        return
      }
      root.querySelectorAll(".frame-link").forEach((link) => {
        ensureTabLinkTrigger(link)
      })
    }

    ensureTriggers(container)

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!node || node.nodeType !== 1) {
            return
          }
          if (node.classList && node.classList.contains("frame-link")) {
            ensureTabLinkTrigger(node)
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(".frame-link").forEach((link) => {
              ensureTabLinkTrigger(link)
            })
          }
        })
      })
    })
    observer.observe(container, { childList: true, subtree: true })

    const togglePopoverForLink = (link) => {
      if (!link) {
        return
      }
      const popover = tabLinkPopoverEl || document.getElementById(TAB_LINK_POPOVER_ID)
      if (tabLinkActiveLink === link && popover && popover.classList.contains("visible")) {
        hideTabLinkPopover({ immediate: true })
        return
      }
      renderTabLinkPopover(link, { requireAlternate: false })
    }

    const handleTriggerClick = (event) => {
      const trigger = event.target.closest(`.${TAB_LINK_TRIGGER_CLASS}`)
      if (!trigger || !container.contains(trigger)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const link = trigger.closest(".frame-link")
      togglePopoverForLink(link)
    }

    const handleTriggerKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return
      }
      const trigger = event.target.closest(`.${TAB_LINK_TRIGGER_CLASS}`)
      if (!trigger || !container.contains(trigger)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const link = trigger.closest(".frame-link")
      togglePopoverForLink(link)
    }

    container.addEventListener("click", handleTriggerClick, true)
    container.addEventListener("keydown", handleTriggerKeydown, true)
  }

  const handleGlobalPointer = (event) => {
    if (!tabLinkPopoverEl || !tabLinkPopoverEl.classList.contains("visible")) {
      return
    }
    if (tabLinkPopoverEl.contains(event.target)) {
      return
    }
    if (tabLinkActiveLink && tabLinkActiveLink.contains(event.target)) {
      return
    }
    hideTabLinkPopover({ immediate: true })
  }

  window.addEventListener("scroll", (event) => {
    if (!tabLinkPopoverEl || !tabLinkPopoverEl.classList.contains("visible")) {
      return
    }
    if (event && event.target && tabLinkPopoverEl.contains(event.target)) {
      return
    }
    hideTabLinkPopover({ immediate: true })
  }, true)

  window.addEventListener("resize", () => {
    if (tabLinkPopoverEl && tabLinkPopoverEl.classList.contains("visible") && tabLinkActiveLink) {
      positionTabLinkPopover(tabLinkPopoverEl, tabLinkActiveLink)
    }
  })

  document.addEventListener("mousedown", handleGlobalPointer, true)
  try {
    document.addEventListener("touchstart", handleGlobalPointer, { passive: true, capture: true })
  } catch (_) {
    document.addEventListener("touchstart", handleGlobalPointer, true)
  }

  if (typeof window !== 'undefined') {
    window.renderTabLinkPopover = renderTabLinkPopover
    window.hideTabLinkPopover = hideTabLinkPopover
    window.setupTabLinkHover = setupTabLinkHover
    window.PinokioTabLinkPopover = Object.freeze({
      renderTabLinkPopover,
      hideTabLinkPopover,
      setupTabLinkHover,
      isLocalHostLike,
      canonicalizeUrl,
      ensureHttpDirectoryUrl
    })
  }
