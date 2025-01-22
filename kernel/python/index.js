const path = require('path')
const fetch = require('cross-fetch')
class Python {
  constructor(kernel) {
    this.kernel = kernel
  }
  async call(modname, modpath, method, args, ondata) {
    console.log("CALL", { modname, modpath, method, args })
    let res
    for(let i=0; i<5; i++) {
      console.log(`call attempt: ${i}`)
      ondata({
        raw: `\r\ncall attempt: ${i}\r\n`
      })
      res = await this._call(modname, modpath, method, args, ondata)
      if (res) {
        console.log("request successful")
        ondata({
          raw: "\r\nrequest successful\r\n"
        })
        break
      } else {
        console.log("request unsuccessful. retrying in 3 seconds...")
        ondata({
          raw: "\r\nrequest unsuccessful. retrying in 3 seconds...\r\n"
        })
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            resolve() 
          }, 3000)
        })
      }
    }
    return res
  }
  async _call(modname, modpath, method, args, ondata) {
    // if this.proc doesn't exist, create
    if (!this.proc) {
      console.log("python rpc server not running. starting...")
      ondata({
        raw: "\r\npython rpc server not running. starting...\r\n"
      })
      await new Promise((resolve, reject) => {
        this.kernel.exec({
          venv: "env",
          message: "uvicorn --port 42001 server:app",
          path: modpath,
        }, (s) => {
  //        process.stdout.write(s)
          ondata(s)
          if (/Uvicorn running on/i.test(s.cleaned)) {
            resolve()
          }
        })
      })
      await new Promise((resolve, reject) => {
        setTimeout(() => {
          resolve() 
        }, 3000)
      })
    }

    try {
      let res = await fetch("http://127.0.0.1:42001/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: modname,
          path: modpath,
          method,
          params: args
        })
      }).then((res) => {
        return res.json()
      })
      this.proc = true
      return res
    } catch (e) {
      console.log("FETCH ERROR", e)
      this.proc = false
    }
  }
}
module.exports = Python
