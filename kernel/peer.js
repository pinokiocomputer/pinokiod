const dgram = require('dgram');
const axios = require('axios');
const os = require('os')
const Environment = require("./environment")
class PeerDiscovery {
  constructor(port = 41234, message = 'ping', interval = 1000) {
    this.port = port;
    this.message = Buffer.from(message);
    this.interval = interval;
    this.peers = new Set();
    this.host = this._getLocalIPAddress()
    this.default_port = 42000
    this.peers.add(this.host)
//    this.start();
  }
  stop() {
    if (this.socket) {
      clearInterval(this.interval_handle)
      this.socket.close()
    }
  }
  announce() {
    if (this.socket) {
      this.socket.send(this.message, 0, this.message.length, this.port, '192.168.1.255');
    }
  }
  async check(kernel) {
    let env = await Environment.get(kernel.homedir)
    //let peer_active = true
    let peer_active = false
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
    this.name = os.userInfo().username
    if (env && env.PINOKIO_NETWORK_NAME && env.PINOKIO_NETWORK_NAME.length > 0) {
      this.name = env.PINOKIO_NETWORK_NAME
    }
    if (peer_active && https_active) {
      this.active = true
    } else {
      this.active = false
    }
  }
  async start(kernel) {
    let env = await Environment.get(kernel.homedir)

    // by default expose to the local network
    //this.active = true
    // if PINOKIO_NETWORK_SHARE is 0 or false, turn it off
//    if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="0" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="false")) {
    await this.check(kernel)
//    if (env && env.PINOKIO_NETWORK_ACTIVE && (env.PINOKIO_NETWORK_ACTIVE==="1" || env.PINOKIO_NETWORK_ACTIVE.toLowerCase()==="true")) {
////      this.active = false
//      this.active = true
//    }

    if (this.active) {
      // Listen for incoming pings
      this.socket = dgram.createSocket('udp4');
      this.socket.on('message', (msg, rinfo) => {
        const ip = rinfo.address;
        if (msg.toString() === this.message.toString() && this._isLocalLAN(ip)) {
          if (!this.peers.has(ip)) {
            console.log(`Discovered peer: ${ip}`);
            this.peers.add(ip);
            this.refresh()
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
      let res = await axios.get(`http://${host}:${this.default_port}/pinokio/peer`, {
        timeout: 2000
      })
      return res.data
    } catch (e) {
      console.log("_refresh error", { host , e })
      return null
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
  // refresh peer info
  async refresh(peers) {
//    if (this.active) {
      this.refreshing = true
      let refresh_peers
      if (peers) {
        refresh_peers = peers
      } else {
        this.info = {}
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
        }
      }
      this.refreshing = false
      return this.info
//    }
  }
  _isLocalLAN(ip) {
    return ip.startsWith('192.168.') || ip.startsWith('10.') || (ip.startsWith('172.') && is172Private(ip));
  }
  //_getLocalIPAddress() {
  //  const interfaces = os.networkInterfaces();
  //  for (const ifaceList of Object.values(interfaces)) {
  //    for (const iface of ifaceList) {
  //      console.log({ iface })
  //      if (iface.family === 'IPv4' && !iface.internal) {
  //        const ip = iface.address;
  //        if (
  //          ip.startsWith('10.') ||
  //          ip.startsWith('192.168.') ||
  //          (ip.startsWith('172.') && is172Private(ip))
  //        ) {
  //          return ip;
  //        }
  //      }
  //    }
  //  }
  //  return null;
  //  function is172Private(ip) {
  //    const secondOctet = parseInt(ip.split('.')[1], 10);
  //    return secondOctet >= 16 && secondOctet <= 31;
  //  }
  //}
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
