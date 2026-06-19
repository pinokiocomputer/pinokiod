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
    this.kernel = kernel
    this.cache = {}
  }
  async isHttp(host, port) {
    // ignore caddy
    if (parseInt(port) === 2019) {
      return false
    }
    if (this.cache.hasOwnProperty("" + port)) {
      return this.cache["" + port]
    }
//    let ip = "127.0.0.1"
    let timeout = 1000
    let response = await new Promise(resolve => {
      const socket = new net.Socket();
      let response = '';
      let resolved = false;
      socket.setTimeout(timeout);
      socket.connect(port, host, () => {
        // Use a nonsense method to trigger a 400/405/501 from real HTTP servers
        socket.write(`FOO / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
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
    setTimeout(() => {
      this.kernel.shell.emit({
        emit: cmd + "\r\n" + cls,
        id,
      })
    }, 10)
  }
  async get_pids (stdout) {
    const results = [];
    let pids = new Set()
    let s = stdout.trim()
    const lines = s.split('\n');
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
          const chunks = /(.+):([0-9]+)/.exec(localAddress)
          let host = chunks[1]
          let port = chunks[2]
          let ip

          if (host === "*") {
            ip = "127.0.0.1:" + port
            host = "127.0.0.1"
          } else if (host === "[::1]") {
            host = "::1"
            ip = localAddress
          } else {
            ip = localAddress
          }

//          let isHttp = await this.isHttp(ip)
//          if (!isHttp) continue


          if (pids.has(pid+"/"+port)) continue;
          pids.add(pid+"/"+port)
          results.push({ port, pid, ip, host });
        } catch (e) {
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
          const chunks = /(.+):([0-9]+)/.exec(localAddress)
          let host = chunks[1]
          let port = chunks[2]
          let ip
          if (host === "*") {
            ip = "127.0.0.1:" + port
            host = "127.0.0.1"
          } else if (host === "[::1]") {
            host = "::1"
            ip = localAddress
          } else {
            ip = localAddress
          }

          if (pids.has(pid+"/"+port)) continue;
          pids.add(pid+"/"+port)
          if (pid && port) results.push({ port, pid, ip, host });
        } catch (e) {
        }
      }
    }
    const http_check = await Promise.all(results.map(({ host, port }) => {
      return limit(() => {
        return this.isHttp(host, port)
      })
    }))
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
    try {
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout) => {
        if (err) {
          console.warn('[Procs] getPortPidList failed:', err && err.message ? err.message : err)
          cb([])
          return
        }
        try {
          this.get_pids(stdout || '').then((pids) => {
            cb(pids)
          }).catch((e) => {
            console.warn('[Procs] get_pids failed:', e && e.message ? e.message : e)
            cb([])
          })
        } catch (e) {
          console.warn('[Procs] get_pids threw:', e && e.message ? e.message : e)
          cb([])
        }
      });
    } catch (e) {
      console.warn('[Procs] spawn getPortPidList failed:', e && e.message ? e.message : e)
      cb([])
    }
  }
  get_name(stdout) {
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
          break;
        }
      }
    }
    if (cached) {
      cb(this.port_map)
      return
    }
    const cmd = isWin ? 'tasklist /fo csv /nh' : 'ps -Ao pid,comm';
    try {
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, async (err, stdout) => {
        if (err) {
          console.warn('[Procs] getPidToNameMap failed:', err && err.message ? err.message : err)
          cb(this.port_map || {})
          return
        }
        let map
        try {
          map = this.get_name(stdout || '')
        } catch (e) {
          console.warn('[Procs] get_name threw:', e && e.message ? e.message : e)
          cb(this.port_map || {})
          return
        }
        if (!this.port_map) {
          this.port_map = {}
        }
        for(let key in map) {
          this.port_map[key] = map[key]
        }
        cb(this.port_map)
      });
    } catch (e) {
      console.warn('[Procs] spawn getPidToNameMap failed:', e && e.message ? e.message : e)
      cb(this.port_map || {})
    }
  }
  async refresh() {
    if (this.kernel && typeof this.kernel.binCheckDepth === 'number' && this.kernel.binCheckDepth > 0) {
      return
    }
    let map = {}
    this.refreshing = true
    try {
      let list = await new Promise((resolve, reject) => {
        try {
          this.getPortPidList((portPidList) => {
            if (!Array.isArray(portPidList) || portPidList.length === 0) {
              resolve([])
              return
            }
            this.getPidToNameMap(portPidList, (pidToName) => {
              try {
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
                resolve(list)
              } catch (e) {
                console.warn('[Procs] refresh mapping failed:', e && e.message ? e.message : e)
                resolve([])
              }
            })
          })
        } catch (e) {
          reject(e)
        }
      })
      this.info = list
      this.map = map
    } catch (e) {
      console.warn('[Procs] refresh failed:', e && e.message ? e.message : e)
      this.info = []
      this.map = {}
    } finally {
      this.refreshing = false
    }
  }
}
module.exports = Procs
