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
    let timeout = 1000
    // An HTTP status line is the FIRST thing a server sends and is far under
    // 8 KiB. Bytes past this point can never turn a non-match into a match, so
    // there is no reason to keep them. Unbounded accumulation here is what
    // allowed a single chatty non-HTTP port to build a >0.5 GiB string.
    const MAX_SNIFF = 8192
    // Total elapsed budget. `socket.setTimeout()` is an IDLE timer — verified:
    // a peer that streams continuously never goes idle, so it can never fire.
    // This deadline is the only thing that bounds a continuously-streaming peer.
    const MAX_ELAPSED = 3000
    let response = await new Promise(resolve => {
      const socket = new net.Socket();
      let response = '';
      let resolved = false;
      let deadline = null;
      // Single exit path: idempotent, always clears the timer and the socket.
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        if (deadline) { clearTimeout(deadline); deadline = null; }
        try { socket.destroy(); } catch (e) {}
        resolve(value);
      };
      deadline = setTimeout(() => finish(false), MAX_ELAPSED);
      if (deadline.unref) deadline.unref();
      socket.setTimeout(timeout);
      socket.connect(port, host, () => {
        // Use a nonsense method to trigger a 400/405/501 from real HTTP servers
        try {
          socket.write(`FOO / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        } catch (e) { finish(false); }
      });
      socket.on('data', chunk => {
        // This handler MUST NOT throw. An exception raised inside a socket
        // 'data' callback does not reject the enclosing Promise — it escapes as
        // an uncaughtException (verified empirically). Pinokio's crash handler
        // then logs it, the next chunk throws again, and the loop writes the
        // error to disk forever. On 2026-08-19 that produced a 329 GB log and
        // took a 4 TB volume to 0 bytes free, killing Docker and WSL with it.
        try {
          if (resolved) return;
          if (response.length < MAX_SNIFF) {
            // latin1 keeps this byte-exact and cannot throw on split multi-byte
            // sequences; we only ever match ASCII against it.
            response += chunk.toString('latin1', 0, Math.min(chunk.length, MAX_SNIFF - response.length));
          }
          if (/^HTTP\/\d+\.\d+ \d+/.test(response)) {
            finish(true); // Valid HTTP response detected
            return;
          }
          // Every HTTP response begins with "HTTP/". The original regex was
          // already anchored at the start, so once the first 5 bytes are known
          // and differ, no amount of further data can ever match. This is what
          // makes a NATS/Postgres/bolt port cost 5 bytes instead of a gigabyte.
          if (response.length >= 5 && response.slice(0, 5) !== 'HTTP/') {
            finish(false);
            return;
          }
          if (response.length >= MAX_SNIFF) {
            finish(false);
          }
        } catch (e) {
          finish(false);
        }
      });
      socket.on('error', () => {
        finish(false);
      });
      socket.on('timeout', () => {
        finish(false);
      });
      socket.on('close', () => {
        finish(false);
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
    const listeningForeignAddresses = new Set(['0.0.0.0:0', '[::]:0', '*:*', '*:0'])
    for(let line of lines) {
      if (isWin) {
        // Skip headers
        try {
          if (!line.startsWith('  TCP')) continue;
          const parts = line.trim().split(/\s+/);
          const [ , localAddress, foreignAddress ] = parts;
          const pid = parts[parts.length - 1]

          let pid_int = parseInt(pid)
          if (pid_int === 0 || pid_int === 4) {
            // pid 0 => killed processes => irrelevant
            // pid 4 => system process => irrelevant
            continue
          }

          if (!listeningForeignAddresses.has(foreignAddress)) continue;
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
