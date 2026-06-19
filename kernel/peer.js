const dgram = require('dgram');
const axios = require('axios');
const os = require('os')
const systeminformation = require('systeminformation')
const Environment = require("./environment")
class PeerDiscovery {
  constructor(kernel, port = 41234, message = 'ping', interval = 1000) {
    this.kernel = kernel
    this.port = port;
    this.message = Buffer.from(message);
    this.kill_message = Buffer.from("kill")
    this.interval = interval;
    this.peers = new Set();
    this.interface_addresses = []
    this.host_candidates = []
    this.host = null
    this.default_port = 42000
    this.router_info_cache = {}
//    this.start();
  }
  stop() {
    if (this.socket) {
      clearInterval(this.interval_handle)
      this.socket.close()
    }
  }
  async check_peers () {
    let peer_array = Array.from(this.peers)
    for(let host of peer_array) {
      if (this.host !== host) {
        let result = await this._refresh(host)
        if (!result) {
          this.peers.delete(host)
          if (this.info) {
            delete this.info[host]
          }
        }
      }
    }
  }
  announce() {
    if (!this.socket) {
      return
    }
    const targets = this._broadcastTargets()
    for (const target of targets) {
      try {
        this.socket.send(this.message, 0, this.message.length, this.port, target)
      } catch (err) {
        console.error('peer broadcast failed', { target, err })
      }
    }
  }
  async check(kernel) {
    let env
    try {
      env = await Environment.get(kernel.homedir, kernel)
    } catch (e) {
    }
    const resolveFlag = (key, fallback) => {
      const fromEnvFile = env && typeof env[key] !== 'undefined' ? String(env[key]) : undefined
      const fromProcess = typeof process.env[key] !== 'undefined' ? String(process.env[key]) : undefined
      const value = typeof fromProcess !== 'undefined' ? fromProcess : fromEnvFile
      if (typeof value === 'undefined' || value === null) {
        return fallback
      }
      const normalized = value.trim().toLowerCase()
      if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true
      }
      if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false
      }
      return fallback
    }

    const peer_active = resolveFlag('PINOKIO_NETWORK_ACTIVE', false)
    const https_active = resolveFlag('PINOKIO_HTTPS_ACTIVE', false)
//    console.log("kernel.refresh", { active, notify_peers })

    //this.name = os.userInfo().username
    this.name = "p" + this.host.split(".").pop()
    if (env && env.PINOKIO_NETWORK_NAME && env.PINOKIO_NETWORK_NAME.length > 0) {
      this.name = env.PINOKIO_NETWORK_NAME
    }
    this.peer_active = peer_active
    this.https_active = https_active
    if (peer_active && https_active) {
      this.active = true
    } else {
      this.active = false
    }
  }
  // Prepare host/peer state before the rest of the kernel bootstraps
  async initialize(kernel) {
    await this.refreshLocalAddress()
    if (kernel) {
      await this.check(kernel)
    }
  }
  async start(kernel) {
    await this.check(kernel)

    if (this.peer_active) {
      // Listen for incoming pings
      this.socket = dgram.createSocket('udp4');
      this.socket.on('message', (msg, rinfo) => {
        const ip = rinfo.address;
        let str = msg.toString()
        let kill_message = this.kill_message.toString()
        if (str.startsWith(kill_message + " ") && this._isLocalLAN(ip)) {
          let host = str.split(" ")[1]
          console.log({ host })
          this.kill(host)
        }
        if (msg.toString() === this.message.toString() && this._isLocalLAN(ip)) {
          if (!this.peers.has(ip)) {
            console.log(`Discovered peer: ${ip}`);
            this.peers.add(ip);
//            this.refresh()
//            this.notify_refresh()
          }
        }
      });
      this.socket.on('error', (err) => {
        console.error('UDP error', err);
      });

      // Enable broadcast
      console.log("binding socket")
      this.socket.bind({ address: "0.0.0.0", port: this.port }, () => {
        console.log("socket bound")
//        this.socket.setMulticastLoopback(true);

        this.socket.setBroadcast(true);

        this.announce()

//        // Send broadcast pings every interval
//        this.interval_handle = setInterval(() => {
//          //this.socket.send(this.message, 0, this.message.length, this.port, '255.255.255.255');
//          this.socket.send(this.message, 0, this.message.length, this.port, '192.168.1.255');
//        }, this.interval);
      });
    }
  }
  async _refresh(host) {
    try {
      if (host === this.host) {
        return this.current_host()
      } else {
        let res = await axios.get(`http://${host}:${this.default_port}/pinokio/peer`, {
          timeout: 2000
        })
        return res.data
      }
    } catch (e) {
      return null
    }
  }
  async notify_refresh() {
    // notify all peers of the current host info
    if (this.info) {
      let info = this.info[this.host]
      let peer_array = Array.from(this.peers)
      for(let host of peer_array) {
        if (this.host !== host) {
          try {
            let endpoint = `http://${host}:${this.default_port}/pinokio/peer/refresh`
            let res = await axios.post(endpoint, info, {
              timeout: 2000
            })
          } catch (e) {
          }
        }
      }
    }
  }
  async _broadcast(host) {
    try {
      let res = await axios.post(`http://${host}:${this.default_port}/pinokio/peer/refresh`, {
        timeout: 2000
      })
      return res.data
    } catch (e) {
      return null
    }
  }
  // notify peers to refresh my info
  async notify_peers() {
    if (this.active) {
      let peer_array = Array.from(this.peers)
      let res = await Promise.all(peer_array.map((host) => {
        return this._broadcast(host)
      }))
      return res
    }
  }
  async proc_info(proc) {
    let title
    let description
    let http_icon
    let https_icon
    let icon
    let iconpath
    let appname
    if (proc.external_router) {
      // try to get icons from pinokio
      for(let router of proc.external_router) {
        // replace the root domain: facefusion-pinokio.git.x.localhost => facefusion-pinokio.git
        let pattern = `.${this.name}.localhost`
        if (router.endsWith(pattern)) {
          let name = router.replace(pattern, "")
          appname = name
          let api_path = this.kernel.path("api", name)
          let exists = await this.kernel.exists(api_path)
          if (exists) {
            let meta = await this.kernel.api.meta(name)
            if (meta.icon) {
              icon = meta.icon
              iconpath = meta.iconpath
            }
            if (meta.title) {
              title = meta.title
            }
            if (meta.description) {
              description = meta.description
            }
          }
        }
      }
    }
    // if not an app running inside pinokio, try to fetch and infer the favicon
    if (icon) {
      http_icon = `http://${this.host}:42000${icon}`;
      //https_icon = `https://${appname}.${this.name}.localhost/${iconpath}?raw=true`
      https_icon = `https://pinokio.${this.name}.localhost/asset/api/${appname}/${iconpath}`
    } else {
      for(let protocol of ["https", "http"]) {
        if (protocol === "https") {
          if (proc.external_router.length > 0) {
            let favicon = await this.kernel.favicon.get("https://" + proc.external_router[0])
            if (favicon) {
              https_icon = favicon
            }
          }
        } else {
          if (proc.external_ip) {
            let favicon = await this.kernel.favicon.get("http://" + proc.external_ip)
            if (favicon) {
              http_icon = favicon
            }
          }
        }
      }
    }
    return {
      title, description, http_icon, https_icon, icon
    }
  }
  async router_info() {
    try {
      let processes = []
      if (this.info && this.info[this.host]) {
        let procs = this.info[this.host].proc
        let router = this.info[this.host].router
        let port_mapping = this.info[this.host].port_mapping
        for(let proc of procs) {
          let pid = proc.pid
          let d = Date.now()
          let chunks = proc.ip.split(":")
          let internal_port = chunks[chunks.length-1]
          let internal_host = chunks.slice(0, chunks.length-1).join(":")
          let external_port = port_mapping[internal_port]
          let merged
          const external_hosts = this._buildExternalHostEntries(external_port)
          let external_ip
          if (external_hosts.length > 0) {
            external_ip = external_hosts[0].url
          } else if (external_port) {
            external_ip = `${this.host}:${external_port}`
          }
          let internal_router = []
          // check both the 127.0.0.1 and 0.0.0.0 for local ip
          let a = router["127.0.0.1:" + proc.port]
          let b = router["0.0.0.0:" + proc.port]
          let c = router["localhost:" + proc.port]
          if (a) {
            internal_router = internal_router.concat(a)
          }
          if (b) {
            internal_router = internal_router.concat(b)
          }
          if (c) {
            internal_router = internal_router.concat(c)
          }
//          let ip = 
//          if (router[proc.ip]) {
//          }proc.
          let info = {
            external_router: router[external_ip] || [],
            internal_router,
            external_hosts,
            external_ip,
            external_port: external_port ? parseInt(external_port, 10) : undefined,
            internal_port: internal_port ? parseInt(internal_port, 10) : undefined,
            ...proc,
          }
          const usingCustomDomain = this.kernel.router_kind === 'custom-domain'
          if (usingCustomDomain) {
            if ((!info.external_router || info.external_router.length === 0)) {
              const fallbackKeys = new Set([
                proc.ip,
                `${internal_host}:${proc.port}`,
                `127.0.0.1:${proc.port}`,
                `0.0.0.0:${proc.port}`,
                `localhost:${proc.port}`
              ])
              for (const key of fallbackKeys) {
                if (key && router[key] && router[key].length > 0) {
                  info.external_router = router[key]
                  break
                }
              }
            }
            if (info.external_router && info.external_router.length > 0) {
              info.external_router = Array.from(new Set(info.external_router))
            } else if (internal_router.length > 0) {
              info.external_router = Array.from(new Set(internal_router))
            }
          }
          let cached = this.router_info_cache[pid]
          let cached_str = JSON.stringify(cached)
          let info_str = JSON.stringify(info)
          if (cached && cached_str === info_str) {
            // nothing has changed. use the cached version
            processes.push(cached)
          } else {
            // something has changed, refresh
            let proc_info = await this.proc_info(info)
            info = { ...proc_info, ...info }
            this.router_info_cache[pid] = info
            processes.push(info)
          }
        }
      }
      processes.sort((a, b) => {
        return b.external_port-a.external_port
      })
      return processes
    } catch (e) {
      console.log("ERROR", e)
      return []
    }
  }
  async router_info_lite() {
    try {
      let processes = []
      if (this.info && this.info[this.host]) {
        let procs = this.info[this.host].proc
        let router = this.info[this.host].router
        let port_mapping = this.info[this.host].port_mapping
        for (let proc of procs) {
          let chunks = (proc.ip || '').split(":")
          let internal_port = chunks[chunks.length - 1]
          let internal_host = chunks.slice(0, chunks.length - 1).join(":")
          let external_port = port_mapping ? port_mapping[internal_port] : undefined
          const external_hosts = this._buildExternalHostEntries(external_port)
          let external_ip = external_hosts.length > 0 ? external_hosts[0].url : undefined
          if (!external_ip && external_port) {
            external_ip = `${this.host}:${external_port}`
          }

          let internal_router = []
          // Check common local keys
          const keys = [
            `127.0.0.1:${proc.port}`,
            `0.0.0.0:${proc.port}`,
            `localhost:${proc.port}`,
          ]
          for (const key of keys) {
            if (router && router[key]) {
              internal_router = internal_router.concat(router[key])
            }
          }

          const info = {
            external_router: (router && external_ip && router[external_ip]) ? router[external_ip] : [],
            internal_router,
            external_hosts,
            external_ip,
            external_port: external_port ? parseInt(external_port, 10) : undefined,
            internal_port: internal_port ? parseInt(internal_port, 10) : undefined,
            ...proc,
          }

          // In custom-domain mode, ensure external_router has something meaningful
          const usingCustomDomain = this.kernel.router_kind === 'custom-domain'
          if (usingCustomDomain) {
            if (!info.external_router || info.external_router.length === 0) {
              const fallbackKeys = new Set([
                proc.ip,
                `${internal_host}:${proc.port}`,
                `127.0.0.1:${proc.port}`,
                `0.0.0.0:${proc.port}`,
                `localhost:${proc.port}`
              ])
              for (const key of fallbackKeys) {
                if (key && router && router[key] && router[key].length > 0) {
                  info.external_router = router[key]
                  break
                }
              }
            }
            if (info.external_router && info.external_router.length > 0) {
              info.external_router = Array.from(new Set(info.external_router))
            } else if (internal_router.length > 0) {
              info.external_router = Array.from(new Set(internal_router))
            }
          }

          processes.push(info)
        }
      }
      processes.sort((a, b) => {
        return (b.external_port || 0) - (a.external_port || 0)
      })
      return processes
    } catch (e) {
      console.log('router_info_lite ERROR', e)
      return []
    }
  }
  async installed() {
    let folders = await fs.promises.readdir(this.kernel.path("api"))
    let installed = []
    for(let folder of folders) {
      let meta = await this.kernel.api.meta(folder)
      /*
      meta := {
        title,
        icon,
        description,
      }
      */
      let http_icon = null
      let https_icon = null
      let https_href = `https://pinokio.${this.name}.localhost/p/${folder}`
      let http_href = `http://${this.host}:42000/p/${folder}`
      let app_href = null
      if (meta && !meta.init_required) {
        if (meta.title) {
          if (meta.icon) {
            http_icon = `http://${this.host}:42000${meta.icon}`;
            //https_icon = `https://${folder}.${this.name}.localhost/${meta.iconpath}?raw=true`
            https_icon = `https://pinokio.${this.name}.localhost/asset/api/${folder}/${meta.iconpath}`
          }
          //https_href = `https://${folder}.${this.name}.localhost`
          app_href = `https://${folder}.${this.name}.localhost`
          installed.push({
            folder,
            http_icon,
            https_icon,
            app_href,
            https_href,
            http_href,
            ...meta 
          })
          continue
        }
      }

      installed.push({
        folder,
        https_href,
        http_href,
        ...meta 
      })


    }
    return installed
  }
  async current_host() {
    let d = Date.now()
    let router_info = await this.router_info()
    let installed = await this.installed()
    let peers
    if (this.info) {
      peers = Object.values(this.info).filter((info) => {
        return info.host !== this.host
      }).map((info) => {
        return {
          name: info.name,
          host: info.host
        }
      })
    } else {
      peers = []
    }
    return {
      active: this.active,
      https_active: this.https_active,
      version: this.kernel.version,
      home: this.kernel.homedir,
      arch: this.kernel.arch,
      platform: this.kernel.platform,
      gpu: this.kernel.gpu,
      gpus: this.kernel.gpus,
      name: this.name,
      host: this.host,
      peers: peers,
      host_candidates: this.host_candidates,
      port_mapping: this.kernel.router.port_mapping,
      rewrite_mapping: this.kernel.router.rewrite_mapping,
      proc: this.kernel.processes.info,
      router: this.kernel.router.published(),
      router_info,
      installed,
      memory: this.kernel.memory
    }
  }
  refresh_info(info) {
    this.info[info.host] = info
  }
  async refresh_host(host) {
    this.refreshing = true
    if (!this.info) {
      this.info = {}
    }

    let info = await this._refresh(host)
    if (info) {
      this.info[host] = {
        host,
        ...info
      }
    }
    this.refreshing = false
  }
  // refresh peer info
  async refresh(peers) {
//    if (this.active) {
      this.refreshing = true
      let refresh_peers
      if (peers) {
        refresh_peers = peers
      } else {
        if (!this.info) {
          this.info = {}
        }
        refresh_peers = Array.from(this.peers)
      }
      let peer_info = await Promise.all(refresh_peers.map((host) => {
        return this._refresh(host)
      }))
      for(let i=0; i<peer_info.length; i++) {
        let peer = peer_info[i]
        if (peer) {
          this.info[peer.host] = {
            host: peer.host,
            ...peer
          }
        } else {
//          let host = refresh_peers[i]
//          console.log(`remove peer ${host}`)
//          delete this.info[host]
//          this.peers.delete(host)
//          console.log("after removing")
//          console.log("info", this.info)
//          console.log("peers", this.peers)
        }
      }
      this.refreshing = false
      return this.info
//    }
  }
  _isLocalLAN(ip) {
    return this.isRFC1918(ip)
  }
  // Refresh LAN/IP selection; keeps peers set in sync with the active address
  async refreshLocalAddress() {
    try {
      const { host, host_candidates, interface_addresses } = await this._getLocalIPAddress()
      this.interface_addresses = interface_addresses
      this.host_candidates = host_candidates
      if (host && this.host !== host) {
        if (this.host) {
          this.peers.delete(this.host)
        }
        this.host = host
      } else if (!this.host) {
        this.host = host
      }
      if (this.host) {
        this.peers.add(this.host)
      }
      return this.host
    } catch (err) {
      console.error('peer refreshLocalAddress error', err)
      if (!this.host) {
        this.host = null
      }
      return this.host
    }
  }
  async _getLocalIPAddress() {
    const interface_addresses = await this._collectInterfaceAddresses()
    const shareable = interface_addresses.filter((entry) => entry.shareable)
    const host_candidates = shareable.map((entry) => ({
      address: entry.address,
      netmask: entry.netmask,
      interface: entry.interface,
      scope: entry.scope,
      shareable: entry.shareable,
      type: entry.type || null,
      operstate: entry.operstate || null,
      virtual: entry.virtual || false,
      default: entry.default || false,
      prefixLength: entry.prefixLength,
      mac: entry.mac || null,
      score: this._scoreCandidate(entry)
    }))
    let selectedHost = null
    let bestScore = -Infinity
    host_candidates.forEach((candidate, index) => {
      const score = typeof candidate.score === 'number' ? candidate.score : -Infinity
      if (score > bestScore) {
        bestScore = score
        selectedHost = candidate.address
      } else if (score === bestScore && selectedHost === null) {
        selectedHost = candidate.address
      }
    })
    if (!selectedHost && shareable.length > 0) {
      selectedHost = shareable[0].address
    }
    if (!selectedHost && interface_addresses.length > 0) {
      selectedHost = interface_addresses[0].address
    }
    if (!selectedHost) {
      selectedHost = '127.0.0.1'
    }
    return { host: selectedHost, host_candidates, interface_addresses }
  }
  isPrivateOrCGNAT(ip) {
    return this.isRFC1918(ip) || this.isCGNAT(ip)
  }
  isRFC1918(ip) {
    if (!ip || typeof ip !== 'string') {
      return false
    }
    const octets = ip.split('.').map(Number)
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return false
    }
    if (octets[0] === 10) return true
    if (octets[0] === 172 && this.is172Private(octets[1])) return true
    if (octets[0] === 192 && octets[1] === 168) return true
    return false
  }
  isCGNAT(ip) {
    if (!ip || typeof ip !== 'string') {
      return false
    }
    const octets = ip.split('.').map(Number)
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return false
    }
    return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
  }
  is172Private(secondOctet) {
    if (typeof secondOctet !== 'number' || Number.isNaN(secondOctet)) {
      return false
    }
    return secondOctet >= 16 && secondOctet <= 31
  }
  _collectInterfaceAddressesSync() {
    const interfaces = os.networkInterfaces()
    const results = []
    const seen = new Set()
    for (const [ifaceName, ifaceList] of Object.entries(interfaces)) {
      if (!Array.isArray(ifaceList)) {
        continue
      }
      for (const iface of ifaceList) {
        if (!iface || iface.family !== 'IPv4') {
          continue
        }
        const address = String(iface.address || '').trim()
        if (!address) {
          continue
        }
        if (seen.has(address)) {
          continue
        }
        seen.add(address)
        const classification = this.classifyAddress(address, Boolean(iface.internal))
        results.push({
          address,
          netmask: String(iface.netmask || '').trim() || null,
          interface: ifaceName,
          internal: Boolean(iface.internal),
          scope: classification.scope,
          shareable: classification.shareable,
          mac: typeof iface.mac === 'string' ? iface.mac : null
        })
      }
    }
    return results
  }
  async _collectInterfaceAddresses() {
    const baseEntries = this._collectInterfaceAddressesSync()
    let metadata = []
    try {
      metadata = await systeminformation.networkInterfaces()
    } catch (err) {
      metadata = []
    }
    const metadataMap = new Map()
    if (Array.isArray(metadata)) {
      metadata.forEach((entry) => {
        if (entry && typeof entry.iface === 'string') {
          metadataMap.set(this._normalizeInterfaceName(entry.iface), entry)
        }
      })
    }
    return baseEntries.map((entry) => {
      const key = this._normalizeInterfaceName(entry.interface)
      const meta = key ? metadataMap.get(key) : null
      const prefixLength = this._prefixLengthFromNetmask(entry.netmask)
      return {
        ...entry,
        prefixLength,
        type: meta && meta.type ? meta.type : null,
        operstate: meta && meta.operstate ? meta.operstate : null,
        speed: typeof meta?.speed === 'number' ? meta.speed : null,
        virtual: Boolean(meta && meta.virtual),
        default: Boolean(meta && meta.default),
        mac: entry.mac || (meta && meta.mac) || null
      }
    })
  }
  _normalizeInterfaceName(name) {
    if (!name || typeof name !== 'string') {
      return ''
    }
    return name.trim().toLowerCase()
  }
  classifyAddress(address, isInternal = false) {
    if (!address || typeof address !== 'string') {
      return { scope: 'unknown', shareable: false }
    }
    if (isInternal || address.startsWith('127.')) {
      return { scope: 'loopback', shareable: false }
    }
    if (this.isRFC1918(address)) {
      return { scope: 'lan', shareable: true }
    }
    if (this.isCGNAT(address)) {
      return { scope: 'cgnat', shareable: true }
    }
    if (address.startsWith('169.254.')) {
      return { scope: 'linklocal', shareable: false }
    }
    const octets = address.split('.').map(Number)
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return { scope: 'unknown', shareable: false }
    }
    if (octets[0] === 0) {
      return { scope: 'unspecified', shareable: false }
    }
    return { scope: 'public', shareable: true }
  }
  _prefixLengthFromNetmask(netmask) {
    if (!netmask || typeof netmask !== 'string') {
      return null
    }
    const octets = this._parseIPv4(netmask)
    if (!octets) {
      return null
    }
    let bits = 0
    for (const octet of octets) {
      bits += this._countBits(octet)
    }
    return bits
  }
  _countBits(value) {
    let count = 0
    let v = value & 255
    while (v) {
      count += v & 1
      v >>= 1
    }
    return count
  }
  // Heuristically rank interface candidates so physical LAN adapters win over VPN/tunnels
  _scoreCandidate(entry) {
    if (!entry || !entry.shareable) {
      return -Infinity
    }
    let score = 0
    switch (entry.scope) {
      case 'lan':
        score += 100
        break
      case 'cgnat':
        score += 60
        break
      case 'public':
        score += 40
        break
      default:
        score -= 50
        break
    }
    if (entry.default) {
      score += 20
    }
    const type = entry.type ? entry.type.toLowerCase() : ''
    if (type === 'wired') {
      score += 25
    } else if (type === 'wireless') {
      score += 18
    } else if (type === 'vpn') {
      score -= 40
    } else if (type === 'cellular') {
      score += 5
    }
    if (entry.virtual) {
      score -= 25
    }
    if (entry.operstate && entry.operstate.toLowerCase() === 'up') {
      score += 5
    } else if (entry.operstate) {
      score -= 10
    }
    if (typeof entry.prefixLength === 'number') {
      if (entry.prefixLength <= 24) {
        score += 5
      }
      if (entry.prefixLength >= 30) {
        score -= 20
      }
    }
    return score
  }
  _buildExternalHostEntries(externalPort) {
    if (!externalPort && externalPort !== 0) {
      return []
    }
    const normalizedPort = parseInt(externalPort, 10)
    if (!Number.isFinite(normalizedPort) || normalizedPort <= 0) {
      return []
    }
    const prioritize = []
    const pushCandidate = (candidate) => {
      if (!candidate || !candidate.shareable || !candidate.address) {
        return
      }
      if (prioritize.some((entry) => entry.address === candidate.address)) {
        return
      }
      prioritize.push(candidate)
    }
    if (this.host && Array.isArray(this.host_candidates)) {
      const primary = this.host_candidates.find((candidate) => candidate.address === this.host)
      if (primary) {
        pushCandidate(primary)
      }
    }
    if (Array.isArray(this.host_candidates)) {
      this.host_candidates.forEach((candidate) => pushCandidate(candidate))
    }
    if (prioritize.length === 0 && this.host) {
      pushCandidate({
        address: this.host,
        scope: this.classifyAddress(this.host, false).scope,
        shareable: true
      })
    }
    const seen = new Set()
    const entries = []
    for (const candidate of prioritize) {
      const host = candidate.address
      if (!host) {
        continue
      }
      const url = `${host}:${normalizedPort}`
      if (seen.has(url)) {
        continue
      }
      seen.add(url)
      entries.push({
        host,
        port: normalizedPort,
        scope: candidate.scope,
        interface: candidate.interface || null,
        url
      })
    }
    return entries
  }
  _broadcastTargets() {
    const addresses = this._collectInterfaceAddressesSync()
    this.interface_addresses = addresses
    const targets = new Set()
    for (const entry of addresses) {
      if (!entry || !entry.shareable) {
        continue
      }
      const broadcast = this._deriveBroadcastAddress(entry.address, entry.netmask)
      if (broadcast) {
        targets.add(broadcast)
      }
    }
    targets.add('255.255.255.255')
    return Array.from(targets)
  }
  _deriveBroadcastAddress(address, netmask) {
    const addrOctets = this._parseIPv4(address)
    if (!addrOctets) {
      return null
    }
    let maskOctets = this._parseIPv4(netmask)
    if (!maskOctets) {
      maskOctets = [255, 255, 255, 0]
    }
    const broadcastOctets = addrOctets.map((octet, idx) => {
      const mask = maskOctets[idx]
      return ((octet & mask) | (~mask & 255)) & 255
    })
    const candidate = broadcastOctets.join('.')
    if (candidate.startsWith('127.') || candidate.startsWith('169.254.') || candidate === '0.0.0.0') {
      return null
    }
    return candidate
  }
  _parseIPv4(value) {
    if (!value || typeof value !== 'string') {
      return null
    }
    const octets = value.split('.').map(Number)
    if (octets.length !== 4 || octets.some((val) => Number.isNaN(val) || val < 0 || val > 255)) {
      return null
    }
    return octets
  }
}

module.exports = PeerDiscovery;
