const fetch = require('cross-fetch')
const X = require('./providers/x')
const Huggingface = require('./providers/huggingface')
class Connect {
  constructor(kernel) {
    this.kernel = kernel
    this.x = new X(kernel)
    this.huggingface = new Huggingface(kernel)
  }
  async request(provider, method, req) {
    let res = await this[provider].request(method, req)
    return res
  }
  async login(provider, req) {
    let res = await this[provider].login(req)
    return res
  }
  async logout(provider, req) {
    let res = await this[provider].logout(req)
    return res
  }
  async keys(provider) {
    let res = await this[provider].keys()
    return res
  }
}
module.exports = Connect
