const fetch = require('cross-fetch')
const X = require('./providers/x')
const Huggingface = require('./providers/huggingface')
const config = require('./config')
const Backend = require('./backend')
class Connect {
  constructor(kernel) {
    this.kernel = kernel
    this.config = config
    this.clients = {}
    for(let name in this.config) {
      if (name === "huggingface") {
        this.clients[name] = new Huggingface(kernel, this.config[name])
      } else {
        this.clients[name] = new Backend(kernel, name, this.config[name])
      }
    }
  }
  async profile(provider, req) {
    if (this.clients[provider] && this.clients[provider].profile) {
      let res = await this.clients[provider].profile()
      return res
    } else {
      return null
    }
  }
  async login(provider, params, context) {
    let res = await this.clients[provider].login(params, context)
    return res
  }
  async logout(provider, params, context) {
    let res = await this.clients[provider].logout(params, context)
    return res
  }
  async cancelLogin(provider, req) {
    if (this.clients[provider] && this.clients[provider].cancelLogin) {
      return await this.clients[provider].cancelLogin(req)
    }
    return null
  }
  async keys(provider, context) {
    let res = await this.clients[provider].keys(context)
    return res
  }
  async connected(provider, options) {
    if (this.clients[provider] && this.clients[provider].connected) {
      return await this.clients[provider].connected(options)
    }
    return false
  }
}
module.exports = Connect
