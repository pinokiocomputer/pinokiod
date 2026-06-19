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
      this.clients[name] = new Backend(kernel, name, this.config[name])
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
  async login(provider, req) {
    let res = await this.clients[provider].login(req)
    return res
  }
  async logout(provider, req) {
    let res = await this.clients[provider].logout(req)
    return res
  }
  async keys(provider) {
    let res = await this.clients[provider].keys()
    return res
  }
}
module.exports = Connect
