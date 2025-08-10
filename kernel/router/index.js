const axios = require('axios')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const Util = require('../util')
const LocalhostHomeRouter = require('./localhost_home_router')
const LocalhostVariableRouter = require('./localhost_variable_router')
const LocalhostPortRouter = require('./localhost_port_router')
const PeerHomeRouter = require('./peer_home_router')
const PeerVariableRouter = require('./peer_variable_router')
const PeerPortRouter = require('./peer_port_router')
const PeerPeerRouter = require('./peer_peer_router')
const CustomDomainRouter = require('./custom_domain_router')
const Environment = require("../environment")
class Router {
  constructor(kernel) {
    this.kernel = kernel
    this.localhost_home_router = new LocalhostHomeRouter(this)
    this.localhost_variable_router = new LocalhostVariableRouter(this)
    this.localhost_port_router = new LocalhostPortRouter(this)
    this.peer_home_router = new PeerHomeRouter(this)
    this.peer_variable_router = new PeerVariableRouter(this)
    this.peer_port_router = new PeerPortRouter(this)
    this.peer_peer_router = new PeerPeerRouter(this)
    this.custom_domain_router = new CustomDomainRouter(this)
    this.default_prefix = "pinokio"
    this.default_suffix = "localhost"
    this.default_match = this.default_prefix + "." + this.default_suffix
    this.default_port = "42000"
    this.default_host = "127.0.0.1"

    this.info = {}
    this.mapping = {}
    this.port_mapping = {}   // 127.0.0.1 => 192.168,..
    this.local_network_mapping = {}
    this.custom_routers = {}
  }
  async init() {
    // if ~/pinokio/network doesn't exist, clone
    let exists = await this.kernel.exists("network/system")
    if (!exists) {
      console.log("network doesn't exist. cloning...")
      await fs.promises.mkdir(this.kernel.path("network"), { recursive: true }).catch((e) => { })
      await this.kernel.exec({
        //message: "git clone https://github.com/peanutcocktail/network system",
        message: "git clone https://github.com/pinokiocomputer/network system",
        path: this.kernel.path("network")
      }, (e) => {
        process.stdout.write(e.raw)
      })
    }


    let cwd = path.resolve(this.kernel.homedir, "network")
    let router_paths = (await glob('**/*.json', { cwd }))
    let router_dir = path.resolve(this.kernel.homedir, "network")


    // create a custom_map that maps port to custom router declarations
    /*

      custom_routers = {
        ports: {
          PORT1: <caddy handler>,
          PORT2: <caddy handler>,
        }
        ...
      }

      custom_domains = {
        domains: {
          NAME1: PORT1,
          NAME2: PORT2,
          ...
        }
        ...
      }

    */
    this.custom_routers = {}
    this.custom_domains = {}
    for(let router_path of router_paths) {
      let router_abs_path = this.kernel.path("network", router_path)
      let config = await this.kernel.require(router_abs_path)
      if (config.ports) {
        let ports = config.ports
        for(let key in ports) {
          this.custom_routers[key] = ports[key]
        }
      }
      if (config.domains) {
        let domains = config.domains
        for(let key in domains) {
          this.custom_domains[key] = domains[key]
        }
      }
    }

    let env = await Environment.get(this.kernel.homedir)
    this.active = false
    if (env && env.PINOKIO_HTTPS_ACTIVE && (env.PINOKIO_HTTPS_ACTIVE==="1" || env.PINOKIO_HTTPS_ACTIVE.toLowerCase()==="true")) {
      this.active = true
    }


  }
  async add({ host, match, dial }) {
    if (!this._mapping[host]) {
      this._mapping[host] = {}
    }
    if (!this._mapping[host][dial]) {
      this._mapping[host][dial] = new Set()
    }
    this._mapping[host][dial].add(match)
  }
  _info() {
    let mapping = {}
    for(let host in this.mapping) {
      let internal_maps = this.mapping[host]
      if (!mapping[host]) {
        mapping[host] = {}
      }
      for(let url in internal_maps) {
        mapping[host][url] = Array.from(internal_maps[url])
      }
    }
    let host_mapping = mapping[this.kernel.peer.host]
    if (host_mapping) {
      for(let key in host_mapping) {
        for(let cache_key in this.port_cache) {
          if (key.endsWith(cache_key)) {
            let transformed = key.replace(":" + cache_key, '')
            let port = this.port_cache[cache_key]
            host_mapping[transformed + ":" + port] = host_mapping[key]
            delete host_mapping[key]
          }
        }
      }
      mapping[this.kernel.peer.host] = host_mapping
    }
    return mapping
  }
  /*
    returns only the published peer info
    {
      <peer1 host>: {
        <dial1>: [<match1>, <match2>, ..],
        <dial2>: [<match1>, <match2>, ..],
      },
      <peer2 host>: {
        <dial1>: [<match1>, <match2>, ..],
        <dial2>: [<match1>, <match2>, ..],
      },
    }
  */
  published() {
    let pub = {}
    if (this.info) {
      let routes = this.info[this.kernel.peer.host]
      for(let dial in routes) {
        let matches = routes[dial]
        pub[dial] = matches
      }
    }
    return pub
  }
  async fill() {
    const jsonString = JSON.stringify(this.config)
    // find all PORT_PLACEHOLDER patterns
    const matches = jsonString.match(/:PORT_PLACEHOLDER_[0-9.:]+/g)

    // iterate through them and see if the port already exists
    let count = matches ? new Set(matches).size : 0
    let new_config
    if (count > 0) {
      let ports = await this.kernel.ports(count)
      let response = Util.fill_object(this.config, /PORT_PLACEHOLDER_.+/, ports, this.port_cache)
      this.config = response.result
      let replaced_map = response.replaced_map
      for(let key in replaced_map) {
        // local_share_ip :- 192.168....
        let local_share_key = key.replace("PORT_PLACEHOLDER_", "")
        let chunks = local_share_key.split(":")
        let original_port = chunks[chunks.length-1]
        let local_share_ip = chunks.slice(0, chunks.length-1).join(":")
        let local_share_port = replaced_map[key]
        if (!this.local_network_mapping[local_share_ip]) {
          this.local_network_mapping[local_share_ip] = {}
        }
        this.local_network_mapping[local_share_ip][original_port] = local_share_port
        //let original_port = key.replace("PORT_PLACEHOLDER_", "")
        this.port_mapping[original_port] = replaced_map[key]
      }
      this.port_cache = replaced_map
    }
  }


  // set local config
  async local() {
    this._mapping = {}
    this.localhost_home_router.handle()
    this.localhost_variable_router.handle(this.kernel.memory.local)
    if (this.kernel.processes && this.kernel.processes.info) {
      for(let proc of this.kernel.processes.info) {
        this.localhost_port_router.handle(proc)
      }
      if (this.kernel.peer.active) {
        for(let host in this.kernel.peer.info) {
          let peer = this.kernel.peer.info[host]
          if (peer.host === this.kernel.peer.host) {
            this.peer_home_router.handle(peer)
            this.peer_variable_router.handle(peer)
            this.peer_port_router.handle(peer)
          }
        }
        await this.fill()
      }
    }
    let host_peer = this.kernel.peer.info[this.kernel.peer.host]
    console.log({ host_peer })
    this.config.apps.http.servers.main.routes.push({
      "handle": [
        {
          "handler": "static_response",
          "status_code": 302,
          "headers": {
            "Location": [
              `https://${this.default_match}/launch?url={http.request.scheme}://{http.request.host}{http.request.uri}`
              //`http://${host_peer.host}:${this.default_port}/launch?url={http.request.scheme}://{http.request.host}{http.request.uri}`
            ]
          }
        }
      ]
    })
    this.mapping = this._mapping
  }

  // set remote config
  async remote() {
    for(let host in this.kernel.peer.info) {
      let peer = this.kernel.peer.info[host]
      if (peer.host !== this.kernel.peer.host) {
        this.peer_peer_router.handle(peer)
      }
    }
    //await this.fill()
    this.mapping = this._mapping
    this.info = this._info()
  }
  async custom_domain() {
    for(let host in this.kernel.peer.info) {
      let peer = this.kernel.peer.info[host]
      this.custom_domain_router.handle(peer)
    }
    //await this.fill()
    this.mapping = this._mapping
  }

  // update caddy config
  async update() {
    console.log("Router.update")
    if (JSON.stringify(this.config) === JSON.stringify(this.old_config)) {
      console.log("######### config hasn't updated")
    } else {
      console.log("######### caddy config has updated. refresh")
//      console.log("Old", JSON.stringify(this.old_config, null, 2))
//      console.log("New", JSON.stringify(this.config, null, 2))
      try {
        console.log("Try loading caddy config") 
        let response = await axios.post('http://127.0.0.1:2019/load', this.config, {
          headers: { 'Content-Type': 'application/json' }
        })
//        console.log("Caddy Response", { response })
        this.old_config = this.config
      } catch (e) {
        console.log("Caddy Request Failed", e.cause)
      }
    }
  }
  async check() {
    try {
      let res = await axios.get(`http://localhost:2019/config/`, {
        timeout: 2000
      })
      return res.data
    } catch (e) {
      return null
    }
  }
}
module.exports = Router
