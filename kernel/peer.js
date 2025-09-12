const dgram = require('dgram');
const axios = require('axios');
const os = require('os')
const Environment = require("./environment")
class PeerDiscovery {
  constructor(kernel, port = 41234, message = 'ping', interval = 1000) {
    this.kernel = kernel
    this.port = port;
    this.message = Buffer.from(message);
    this.kill_message = Buffer.from("kill")
    this.interval = interval;
    this.peers = new Set();
    this.host = this._getLocalIPAddress()
    this.default_port = 42000
    this.peers.add(this.host)
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
    for(let host of Array.from(this.peers)) {
      if (this.host !== host) {
        let result = await this._refresh(host)
        if (!result) {
          this.peers.delete(host)
          delete this.info[host]
        }
      }
    }
  }
  announce() {
    if (this.socket) {
      this.socket.send(this.message, 0, this.message.length, this.port, '192.168.1.255');
    }
  }
  async check(kernel) {
    let env = await Environment.get(kernel.homedir, kernel)
    let peer_active = true
    //let peer_active = false
    if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="1" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="true")) {
    //if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="0" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="false")) {
      peer_active = true
    }
    //let https_active = true
    let https_active = false
    if (env && env.PINOKIO_HTTPS_ACTIVE && (env.PINOKIO_HTTPS_ACTIVE==="1" || env.PINOKIO_HTTPS_ACTIVE.toLowerCase()==="true")) {
    //if (env && env.PINOKIO_HTTPS_ACTIVE && (env.PINOKIO_HTTPS_ACTIVE==="0" || env.PINOKIO_HTTPS_ACTIVE.toLowerCase()==="false")) {
      https_active = true
      //https_active = false 
    }
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
  async start(kernel) {
    let env = await Environment.get(kernel.homedir, kernel)

    // by default expose to the local network
    //this.active = true
    // if PINOKIO_NETWORK_SHARE is 0 or false, turn it off
//    if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="0" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="false")) {
    await this.check(kernel)
//    if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="1" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="true")) {
////      this.active = false
//      this.active = true
//    }

    //if (this.active) {
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
      console.log("_refresh error", { host , e })
      return null
    }
  }
  async notify_refresh() {
    // notify all peers of the current host info
    if (this.info) {
      let info = this.info[this.host]
      for(let host of Array.from(this.peers)) {
        if (this.host !== host) {
          try {
            let endpoint = `http://${host}:${this.default_port}/pinokio/peer/refresh`
            let res = await axios.post(endpoint, info, {
              timeout: 2000
            })
            return res.data
          } catch (e) {
            return null
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
      let res = await Promise.all(Array.from(this.peers).map((host) => {
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
      if (this.info[this.host]) {
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
          let external_ip
          if (external_port) {
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
            external_ip,
            external_port: parseInt(external_port),
            internal_port: parseInt(internal_port),
            ...proc,
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
      let http_href = null
      let https_href = null
      let app_href = null
      if (meta && !meta.init_required) {
        if (meta.title) {
          if (meta.icon) {
            http_icon = `http://${this.host}:42000${meta.icon}`;
            //https_icon = `https://${folder}.${this.name}.localhost/${meta.iconpath}?raw=true`
            https_icon = `https://pinokio.${this.name}.localhost/asset/api/${folder}/${meta.iconpath}`
          }
          //https_href = `https://${folder}.${this.name}.localhost`
          https_href = `https://pinokio.${this.name}.localhost/p/${folder}`
          http_href = `http://${this.host}:42000/p/${folder}`
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
        }
      }
    }
    return installed
  }
  async current_host() {
    let d = Date.now()
    let router_info = await this.router_info()
    let installed = await this.installed()
    let peers = Object.values(this.info).filter((info) => {
      return info.host !== this.host
    }).map((info) => {
      return {
        name: info.name,
        host: info.host
      }
    })
    return {
      version: this.kernel.version,
      home: this.kernel.homedir,
      arch: this.kernel.arch,
      platform: this.kernel.platform,
      gpu: this.kernel.gpu,
      gpus: this.kernel.gpus,
      name: this.name,
      host: this.host,
      peers: peers,
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
    return ip.startsWith('192.168.') || ip.startsWith('10.') || (ip.startsWith('172.') && is172Private(ip));
  }
  _getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const ifaceList of Object.values(interfaces)) {
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const ip = iface.address;
          if (this.isPrivateOrCGNAT(ip)) {
            return ip;
          }
        }
      }
    }
    return null;
  }
  isPrivateOrCGNAT(ip) {
    const octets = ip.split('.').map(Number);
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true; // CGNAT
    return false;
  }
}

module.exports = PeerDiscovery;
