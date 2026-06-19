const fs = require('fs')
const path = require('path')
const fetch = require('cross-fetch')
const FormData = require('form-data');
const marked = require('marked')
const { TwitterApi } = require('twitter-api-v2')
class X {
  id = 'd2FQZ0U4NXpzYnRyS1hZeHBvbUc6MTpjaQ'
  constructor(kernel) {
    this.kernel = kernel
  }
  async readme() {
    let md = await fs.promises.readFile(path.resolve(__dirname, "README.md"), "utf8")
    return marked.parse(md, {
      //baseUrl: req._parsedUrl.pathname.replace(/^\/_api/, "/raw/") + "/"
      //baseUrl: req.originalUrl + "/"
    })
  }
  async persist(auth) {
    this.auth = auth
    this.auth.expires_at = Date.now() + this.auth.expires_in * 1000
    let authPath = this.kernel.path('connect/x.json')
    await fs.promises.mkdir(this.kernel.path("connect"), { recursive: true }).catch((e) => { })
    await fs.promises.writeFile(authPath, JSON.stringify(this.auth, null, 2))
  }
  async destroy() {
    await fs.promises.rm(this.kernel.path("connect/x.json"))
    this.auth = null
  }
  async sync() {
    // check if auth exists
    //  if not, throw error
    let authPath = this.kernel.path('connect/x.json')
    this.auth = (await this.kernel.loader.load(authPath)).resolved
    if (!this.auth) {
      throw new Error("not authenticated")
      return
    }
    if (!this.auth.refresh_token) {
      throw new Error("no refresh token")
      return
    }

    // check if auth has expired
    //  if expired, refresh and return
    if (Date.now() < this.auth.expires_at) {
      return
    }


    console.log("auth expired. refresh....", JSON.stringify({ auth: this.auth, id: this.id }, null, 2))
    // expired — refresh
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.auth.refresh_token,
        client_id: this.id
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
  async request(method, req) {
    /*
      method := "uploadMedia"
      params := {
        "value.0", val1,
        "type.0": "String",
        "value.1": val2,
        "type.1": "Blob"
      }

      uploadMedia(
        val1,
        {
          key2: val2,
          key3: val3
        }
      )
    */
    await this.sync()
    const contentType = req.headers['content-type'];
    let args
    if (contentType.toLowerCase() === "application/json") {
      // don't transform
      args = req.body
      let response = await this.client.v2[method](...args)
      return response
    } else {
      args = []
      let body = Object.assign({}, req.body)
      if (req.files) {
        for (const file of req.files) {
          body[file.fieldname] = file.buffer
        }
      }
      let types = []
      for(let key in body) {
        let chunks = key.split(".")
        let index = parseInt(chunks[1])
        if (chunks[0] === "type") {
          types[index] = body[key]
        }
      }
      for(let key in body) {
        let chunks = key.split(".")
        let index = parseInt(chunks[1])
        if (chunks[0] === "value") {
          let type = types[index]
          if (type === "Object") {
            args[index] = JSON.parse(body[key])
          } else {
            args[index] = body[key]
          }
        }
      }
      console.log({ args, method })

      this.client = new TwitterApi(this.auth.access_token);
      let response = await this.client.v2[method](...args)
      return response
    }
  }
  async login (req) {
    const authHeader = 'Basic ' + Buffer.from(`${this.id}:`).toString('base64');
    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
//        'Authorization': authHeader
      },
      body: JSON.stringify(req.payload)
    }).then((res) => {
      return res.json()
    });
    await this.persist(response)
    return this.auth
  }
  async logout (req) {
    await this.destroy() 
  }
}
module.exports = X
