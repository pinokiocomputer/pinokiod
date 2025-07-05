const os = require('os')
const path = require('path')
const axios = require('axios')
const { fork, exec, spawn } = require('child_process');
const pLimit = require('p-limit')
const limit = pLimit(10)
const platform = os.platform();
const isWin = platform === 'win32';
const cls = isWin ? 'cls' : 'clear'
const net = require('net');
class Procs {
  constructor (kernel) {
//    console.log("Initializing procs")
    this.kernel = kernel
    this.cache = {}
  }
  async isHttp(port) {
  //async isHttp(localAddress) {
//    if (this.cache.hasOwnProperty(localAddress)) {
////      console.log("Use cached", localAddress)
//      return this.cache[localAddress]
//    }
//    console.log("Not cached", localAddress)
    //try {
    //  //await axios.head(`http://${localAddress}`, { timeout: 3000 });
    //  await axios.get(`http://${localAddress}`, { timeout: 3000 });
    //  this.cache[localAddress] = true
    //  return true;
    //} catch (err) {
    //  console.log("HEAD ERROR",{ localAddress, err })
    //  this.cache[localAddress] = false
    //  return false;
    //}

    // ignore caddy
    if (parseInt(port) === 2019) {
      return false
    }
    if (this.cache.hasOwnProperty("" + port)) {
      return this.cache["" + port]
    }
    let ip = "127.0.0.1"
    let timeout = 1000
    let response = await new Promise(resolve => {
      const socket = new net.Socket();
      let response = '';
      let resolved = false;
      socket.setTimeout(timeout);
      socket.connect(port, ip, () => {
        // Use a nonsense method to trigger a 400/405/501 from real HTTP servers
        socket.write(`FOO / HTTP/1.1\r\nHost: ${ip}\r\nConnection: close\r\n\r\n`);
      });
      socket.on('data', chunk => {
        response += chunk.toString();
        if (/^HTTP\/\d+\.\d+ \d+/.test(response)) {
          resolved = true;
          socket.destroy();
          resolve(true); // Valid HTTP response detected
        }
      });
      socket.on('error', () => {
        if (!resolved) resolve(false);
      });
      socket.on('timeout', () => {
        if (!resolved) resolve(false);
        socket.destroy();
      });
      socket.on('close', () => {
        if (!resolved) resolve(false);
      });
    });
    this.cache["" + port] = response
    return response
  }
  newline(id) {
    this.kernel.shell.emit({
      emit: os.EOL,
      id,
    })
  }
  emit(id, cmd) {
//    console.log("emit", { id, cmd })
    setTimeout(() => {
      this.kernel.shell.emit({
        emit: cmd + "\r\n" + cls,
        id,
      })
    }, 10)
  }
  async get_pids (stdout) {
//    console.log("get_pids size", stdout.length)
    const results = [];
    let pids = new Set()
    let s = stdout.trim()
    const lines = s.split('\n');
//    console.time("###### Line parsing")
    for(let line of lines) {
      if (isWin) {
        // Skip headers
        try {
          if (!line.startsWith('  TCP')) continue;
          const parts = line.trim().split(/\s+/);
          const [ , localAddress, , state, pid ] = parts;

          let pid_int = parseInt(pid)
          if (pid_int === 0 || pid_int === 4) {
            // pid 0 => killed processes => irrelevant
            // pid 4 => system process => irrelevant
            continue
          }

          //if (state !== 'LISTENING') continue;
          const chunks = localAddress.split(":")
          const port = chunks.pop()
          let ip = chunks.pop()
          if (!ip || ip === "*") {
            ip = "127.0.0.1:" + port
          } else {
            ip = localAddress
          }

//          let isHttp = await this.isHttp(ip)
//          if (!isHttp) continue


          if (pids.has(pid+"/"+port)) continue;
          pids.add(pid+"/"+port)
          results.push({ port, pid, ip });
        } catch (e) {
//            console.log("ERROR", e)
        }
      } else {
//          if (!/LISTEN/.test(line)) continue;
        try {
          const parts = line.trim().split(/\s+/);
          const pid = parts[1];
          let pid_int = parseInt(pid)
          if (pid_int === 0 || pid_int === 4) {
            // pid 0 => killed processes => irrelevant
            // pid 4 => system process => irrelevant
            continue
          }

          const match = line.match(/([^\s]+:\d+)\s/);
          const localAddress = match?.[1];

          const chunks = localAddress.split(":")
          const port = chunks.pop()
          let ip = chunks.pop()
          if (!ip || ip === "*") {
            ip = "127.0.0.1:" + port
          } else {
            ip = localAddress
          }

//          let isHttp = await this.isHttp(ip)
//          if (!isHttp) continue;

          //const portMatch = line.match(/:(\d+)\s/);
          //const port = portMatch?.[1];
          if (pids.has(pid+"/"+port)) continue;
          pids.add(pid+"/"+port)
          if (pid && port) results.push({ port, pid, ip });
        } catch (e) {
//            console.log("Error", e)
        }
      }
    }
//    console.timeEnd("###### Line parsing")
//    console.time("########## http_check")
    const http_check = await Promise.all(results.map(({ port }) => {
      return limit(() => {
        return this.isHttp(port) 
      })
    }))
//    console.timeEnd("########## http_check")
    let filtered = []
    for(let i=0; i<http_check.length; i++) {
      if (http_check[i]) {
        filtered.push(results[i])
      }
    }
    return filtered
  }
  getPortPidList(cb) {
    const cmd = isWin ? 'netstat -ano -p tcp' : 'lsof -nP -iTCP -sTCP:LISTEN';
    /*
//    if (this.portPidList) {
//      cb(this.portPidList)
//      return
//    }
    let id = "Procs.getPortPidList"
    let sh = this.kernel.shell.get(id)
    this.port_cb = cb
    this.port_running = true
    this.d2 = Date.now()
    console.time("Shell"+this.d2)
    if (sh) {
      this.emit(id, cmd)
      console.time("lsof" + this.d2);
    } else {
      this.kernel.exec({
        id,
        conda: {
          skip: true,
        },
        onready: () => {
          this.emit(id, cmd)
        },
        input: true
      }, (e) => {
        console.log(">>>>>> all e.state", e.state)
        if (e.state && e.state.includes(cls)) {
          if (this.port_running) {
            console.timeEnd("Shell"+this.d2)
            console.log("e.state", e.state)
            this.port_running = false
            this.newline(id)
            let d = Date.now()
            console.time("get_pids" + d)
            this.get_pids(e.state).then((pids) => {
              console.timeEnd("get_pids" + d)
              this.portPidList = pids
              this.port_cb(pids)
            })
          }
        }
      }).then((result) => {
        this.port_running = false
        console.log("Exec Finished",  {result})
      })
    }
    */
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout) => {
      this.get_pids(stdout).then((pids) => {
        cb(pids)
      })
    });
  }
  get_name(stdout) {
//    console.log("get_name size", stdout.length)
    const lines = stdout.trim().split('\n');
    const map = {};
    lines.forEach(line => {
      if (isWin) {
        const [name, pid] = line.split('","').map(s => s.replace(/(^"|"$)/g, ''));
        if (/^[0-9]+$/.test(pid)) {
          // it is pid
          map[pid] = name;
        }
      } else {
        const [pid, ...nameParts] = line.trim().split(/\s+/);
        if (/^[0-9]+$/.test(pid)) {
          map[pid] = nameParts.join(' ');
        }
      }
    });
    return map
  }
  getPidToNameMap(portPidList, cb) {
    let cached = false
    if (this.port_map) {
      cached = true
      for(let { pid, port } of portPidList) {
        let exists = this.port_map["" + pid]
        if (!exists) {
          cached = false 
          console.log("Didn't exist", { pid, port, exists })
          break;
        }
      }
    }
    if (cached) {
      cb(this.port_map)
      return
    }
    const cmd = isWin ? 'tasklist /fo csv /nh' : 'ps -Ao pid,comm';
    /*
    let id = "Procs.getPidToNameMap"
    let sh = this.kernel.shell.get(id)
    this.pid_cb = cb
    this.pid_running = true
    if (sh) {
      this.emit(id, cmd)
    } else {
      this.kernel.exec({
        id,
        conda: {
          skip: true,
        },
        onready: () => {
//          console.log("ON READY")
          this.emit(id, cmd)
        },
        input: true
      }, async (e) => {
        if (e.state && e.state.includes(cls)) {
          if (this.pid_running) {
            this.pid_running = false
            this.newline(id)
//            console.log("GET MAP")
            let map = this.get_name(e.state)
            if (!this.port_map) {
              this.port_map = {}
            }
            for(let key in map) {
              this.port_map[key] = map[key]
            }
            this.pid_cb(this.port_map)
          }
        }
      }).then((result) => {
        this.pid_running = false
        console.log("Exec Finished",  {result})
      })
    }
    */
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout) => {
      let map = this.get_name(stdout)
      if (!this.port_map) {
        this.port_map = {}
      }
      for(let key in map) {
        this.port_map[key] = map[key]
      }
      cb(this.port_map)
    });
  }
  async refresh() {
    let map = {}
    this.refreshing = true
    let ts = Date.now()
    let list = await new Promise((resolve, reject) => {
//      console.time(">>>>>>>>GET PORTS " + ts)
//      console.log("get ports")
      this.getPortPidList((portPidList) => {
//        console.log("done: get ports")
//        console.log({ portPidList })
//        console.timeEnd(">>>>>>>>GET PORTS " + ts)
//        console.time(">>>>>>> GET PIDS " + ts)
        // if there's any new port, run getPidToNameMap


//        console.log("getPid")
        this.getPidToNameMap(portPidList, (pidToName) => {
//          console.log("done getPid")
          
//          console.timeEnd(">>>>>>> GET PIDS " + ts)
          let list = portPidList.map(({ port, pid, ip }) => {
            const fullname = pidToName[pid] || 'Unknown';
            const name = fullname.split(path.sep).pop()
            if (["caddy", "caddy.exe"].includes(name)) {
              this.caddy_pid = pid
              return null
            } else {
              map["" + pid] =  fullname
              return { port, pid , name, fullname, ip }
            }
          }).filter((x) => { return x })
//          console.log("LIST", JSON.stringify(list, null, 2))
          resolve(list)
        })
      })
    })
    this.info = list
    this.map = map
    this.refreshing = false
  }
}
module.exports = Procs
