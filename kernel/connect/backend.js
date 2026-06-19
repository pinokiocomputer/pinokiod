const fetch = require('cross-fetch')
const fs = require('fs')
const path = require('path')
class Backend {
  constructor(kernel, name, config) {
    this.kernel = kernel
    this.name = name
    this.config = config
  }
  async profile() {
    let connectPath = this.kernel.path(`connect/${this.name}`)
    let profilePath = path.resolve(connectPath, "profile.json")
    this.profile_config = (await this.kernel.loader.load(profilePath)).resolved
    if (!this.profile_config) {
      await fs.promises.mkdir(connectPath, { recursive: true }).catch((e) => { })
      let response = await fetch(this.config.profile.url, {
        headers: {
          'Authorization': 'Bearer ' + this.auth.access_token
        }
      }).then((res) => {
        return res.json()
      })
      this.profile_config = response
      await fs.promises.writeFile(profilePath, JSON.stringify(this.profile_config, null, 2))
      let cwd = connectPath
      await this.config.profile.cache(this.profile_config, cwd)
    }
    let rendered = this.config.profile.render(this.profile_config)
    return rendered
  }
  async persist(auth) {
    console.log("PERSIST", auth)
    this.auth = auth
    this.auth.expires_at = Date.now() + (this.auth.expires_in * 1000);
    let connectPath = this.kernel.path(`connect/${this.name}`)
    let authPath = path.resolve(connectPath, "auth.json")
    await fs.promises.mkdir(connectPath, { recursive: true }).catch((e) => { })
    await fs.promises.writeFile(authPath, JSON.stringify(this.auth, null, 2))
  }
  async destroy() {
    await fs.promises.rm(this.kernel.path(`connect/${this.name}`), { recursive: true })
    this.auth = null
  }
  async sync() {
    // check if auth exists
    //  if not, throw error
    let authPath = this.kernel.path(`connect/${this.name}/auth.json`)
    this.auth = (await this.kernel.loader.load(authPath)).resolved
    if (!this.auth) {
      return null
    }
    if (!this.auth.refresh_token) {
      console.log("no refresh token")
      return null
    }
    if (!this.auth.access_token) {
      console.log("no access token")
      return null
    }

    // check if auth has expired
    //  if expired, refresh and return
    if (Date.now() < this.auth.expires_at) {
      return
    }
    console.log("auth expired. refresh....", JSON.stringify({ auth: this.auth, id: this.config.CLIENT_ID }, null, 2))
    // expired — refresh
    const response = await fetch(this.config.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': this.config.CONTENT_TYPE,
        'Accept': "application/json"
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.auth.refresh_token,
        client_id: this.config.CLIENT_ID,
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
    console.log("login", this.name, req, this.config.TOKEN_URL, this.config.TOKEN_URL)
    const response = await fetch(this.config.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': this.config.CONTENT_TYPE,
        'Accept': "application/json"
      },
      body: JSON.stringify(req)
    }).then((res) => {
      return res.json()
    });
    console.log("RESPONSE", response)
    await this.persist(response)
    return this.auth
  }
  async logout (req) {
    await this.destroy() 
  }
}
module.exports = Backend
