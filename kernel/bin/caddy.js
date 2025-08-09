const axios = require('axios')
const path = require('path')
const fs = require('fs')
const semver = require('semver')
const Util = require('../util')

class Caddy {
  cmd() {
    if (this.kernel.platform === "win32") {
      return "caddy=2.9.1"
    } else {
      return "caddy=2.9.1 nss"
    }
  }
  async running() {
    console.log("caddy running check")
    console.log("stack", new Error().stack)
    try {
      let response = await axios.get('http://127.0.0.1:2019/config/')
      return true
    } catch (e) {
      console.log(e.message)
      return false
    }
  }
  async start() {
//    console.log(">> proc", this.kernel.processes.caddy_pid, this.kernel.processes.info)
//    let running = await this.running()
//    console.log("Running", running)
//    if (running) {
//      // kill first
//      return
//    } 
    let installed = await this.installed()
    console.log("Caddy Installed?", installed)
    if (installed) {
      let resolved
      await new Promise((resolve, reject) => {
        this.kernel.exec({
          message: `caddy run --watch`,
          path: this.kernel.homedir,
        }, (e) => {
          process.stdout.write(e.raw)
          if (!resolved) {
            if (/endpoint started/i.test(e.cleaned)) {
              resolved = true
              resolve()
            }
          }
        })
      })
      console.log("kernel.refresh bin.caddy.start")
      this.kernel.peer.announce()
      console.log("announced to peers")
//      this.kernel.refresh(true)
    }
  }
  async install(req, ondata, kernel, id) {
//    let fullpath = path.resolve(kernel.homedir, "ENVIRONMENT")
//    await Util.update_env(fullpath, {
//      PINOKIO_NETWORK_ACTIVE: "1",
//      PINOKIO_HTTPS_ACTIVE: "1"
//    })
    await this.kernel.bin.exec({
      message: [
        "conda clean -y --all",
        `conda install -y -c conda-forge ${this.cmd()}`
      ]
    }, ondata)
    let resolved
    await new Promise((resolve, reject) => {
      this.kernel.exec({
        message: `caddy run --watch`,
        path: this.kernel.homedir,
      }, (e) => {
        resolve()
        if (!resolved) {
          if (/endpoint started/i.test(e.cleaned)) {
            resolved = true
            resolve()
          }
        }
      })
    })
    if (this.kernel.platform === "win32") {
      await this.kernel.exec({
        message: `caddy trust`,
        path: this.kernel.homedir
      }, (e) => {
        ondata(e)
      })
    } else {
//      ondata({
//        title: "Password",
//        description: "Enter your system password to add the HTTPS certificate",
//        form: [{
//          type: "password",
//          autofocus: true,
//          key: "password",
//          placeholder: "System password",
//        }]
//      }, "input")
//      let response = await this.kernel.api.wait(id)
//      await this.kernel.exec({
//        message: `echo ${response.password} | sudo -S caddy trust`,
//        path: this.kernel.homedir
//      }, (e) => {
//  //        ondata(e)
//  //      console.log(e)
//  //        if (/Caddy Local Authority/i.test(e.cleaned)) {
//  //          trusted = true
//  //        }
//      })

      //let response = await this.kernel.api.wait(id)
      console.log("ondata", ondata.toString())
      setTimeout(() => {
        ondata({ html: `<b><i class="fa-solid fa-keyboard"></i> Enter the system password to generate an HTTPS certificate</b>` }, "notify3")
      }, 2000)
      await this.kernel.exec({
        input: true,
        //message: "sudo -s && caddy trust",
        //message: "sudo -s",
        message: "caddy trust",
        onprompt: (shell) => {
          shell.kill("Done")
        },
        path: this.kernel.homedir
      }, (e) => {
        ondata(e)
      })
      ondata({ html: `<b><i class="fa-solid fa-check"></i> HTTPS certificate create step finished</b>` }, "notify3")
    }
  }
  async installed() {
    try {
      let version = this.kernel.bin.installed.conda_versions.caddy
      let coerced = semver.coerce(version)
      let requirement = "<2.10.0"
      let satisfied = semver.satisfies(coerced, requirement)
      if (!satisfied) {
        return false 
      }
      let e = await this.kernel.exists(this.kernel.path("cache/XDG_DATA_HOME/caddy/pki/authorities/local/root.crt"))
      if (e) {
        if (this.kernel.platform === "win32") {
          return this.kernel.bin.installed.conda.has("caddy")
        } else {
          return this.kernel.bin.installed.conda.has("caddy") && this.kernel.bin.installed.conda.has("nss")
        }
      } else {
        return false
      }
    } catch (e) {
      return false
    }
  }
  async uninstall(req, ondata) {
    ondata({ raw: "cleaning up\r\n" })
    await this.kernel.bin.exec({
      message: `conda remove ${this.cmd()}`,
    }, ondata)
    const folder = this.kernel.path("cache/XDG_DATA_HOME/caddy")
    await rimraf(folder)
    ondata({ raw: "finished cleaning up\r\n" })
  }
}
module.exports = Caddy
