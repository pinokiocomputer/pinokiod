const fetch = require('cross-fetch')
const fs = require('fs')
const path = require('path')
class Huggingface {
  CLIENT_ID = 'e90d4a4d-68a6-4c12-ae71-64756b5918de'
  REDIRECT_URI = 'https://pinokio.localhost/connect/huggingface'
  HF_OAUTH_URL = 'https://huggingface.co/oauth/authorize'
  HF_TOKEN_URL = 'https://huggingface.co/oauth/token'
  HF_API_URL = 'https://huggingface.co/api/whoami-v2'
  constructor(kernel) {
    this.kernel = kernel
  }
  async readme() {
    return ""
  }
  async persist(auth) {
    console.log("PERSIST", auth)
    this.auth = auth
    this.auth.expires_at = Date.now() + (this.auth.expires_in * 1000);
    let authPath = this.kernel.path('connect/huggingface.json')
    await fs.promises.mkdir(this.kernel.path("connect"), { recursive: true }).catch((e) => { })
    await fs.promises.writeFile(authPath, JSON.stringify(this.auth, null, 2))

    // huggingface-cli login
    await this.kernel.exec({
      message: `hf auth login --token ${this.auth.access_token} --add-to-git-credential`
    }, (stream) => {
      process.stdout.write(stream.raw)
    })
  }
  async destroy() {
    await fs.promises.rm(this.kernel.path("connect/huggingface.json"))
    this.auth = null
  }
  async sync() {
    // check if auth exists
    //  if not, throw error
    let authPath = this.kernel.path('connect/huggingface.json')
    this.auth = (await this.kernel.loader.load(authPath)).resolved
    if (!this.auth) {
      return null
    }
    if (!this.auth.refresh_token) {
      console.log("no refresh token")
      return null
    }

    // check if auth has expired
    //  if expired, refresh and return
    if (Date.now() < this.auth.expires_at) {
      return
    }
    console.log("auth expired. refresh....", JSON.stringify({ auth: this.auth, id: this.CLIENT_ID }, null, 2))
    // expired — refresh
    const response = await fetch(this.HF_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.auth.refresh_token,
        client_id: this.CLIENT_ID,
      })
    }).then((res) => {
      return res.json()
    });
    await this.persist(response)
    return this.auth
  }
  async keys() {
    await this.sync()
    return this.auth
  }
  async login(req) {
    console.log("huggingface login", req)
    await this.persist(req)
    return this.auth
  }
//  async login (req) {
//    const authHeader = 'Basic ' + Buffer.from(`${this.id}:`).toString('base64');
//    const response = await fetch('https://api.x.com/2/oauth2/token', {
//      method: 'POST',
//      headers: {
//        'Content-Type': 'application/json',
////        'Authorization': authHeader
//      },
//      body: JSON.stringify(req.payload)
//    }).then((res) => {
//      return res.json()
//    });
//    await this.persist(response)
//    return this.auth
//  }
  async logout (req) {
    await this.destroy() 
  }
}
module.exports = Huggingface
