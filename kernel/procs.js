const os = require('os')
const path = require('path')
const { fork, exec } = require('child_process');
const platform = os.platform();
class Procs {
  constructor () {
    console.log("Initializing procs")
  }
  getPortPidList(callback) {
    const isWin = platform === 'win32';
    const cmd = isWin ? 'netstat -ano -p tcp' : 'lsof -nP -iTCP -sTCP:LISTEN';
    exec(cmd, (err, stdout) => {
      if (err) return callback(err);

      const results = [];
      let pids = new Set()
      const lines = stdout.trim().split('\n');

      lines.forEach(line => {
        if (isWin) {
          // Skip headers
          if (!line.startsWith('  TCP')) return;
          const parts = line.trim().split(/\s+/);
          const [ , localAddress, , state, pid ] = parts;
          if (state !== 'LISTENING') return;
          const chunks = localAddress.split(":")
          const port = chunks.pop()
          let ip = chunks.pop()
          if (!ip || ip === "*") {
            ip = "127.0.0.1:" + port
          } else {
            ip = localAddress
          }
          if (pids.has(pid+"/"+port)) return;
          pids.add(pid+"/"+port)
          results.push({ port, pid, ip });
        } else {
          if (!/LISTEN/.test(line)) return;
          const parts = line.trim().split(/\s+/);
          const pid = parts[1];

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
          //const portMatch = line.match(/:(\d+)\s/);
          //const port = portMatch?.[1];
          if (pids.has(pid+"/"+port)) return;
          pids.add(pid+"/"+port)
          if (pid && port) results.push({ port, pid, ip });
        }
      });

      callback(null, results);
    });
  }
  getPidToNameMap(callback) {
    const isWin = platform === 'win32';
    const cmd = isWin ? 'tasklist /fo csv /nh' : 'ps -Ao pid,comm';
    exec(cmd, (err, stdout) => {
      if (err) return callback(err);
      const lines = stdout.trim().split('\n');
      const map = {};
      lines.forEach(line => {
        if (isWin) {
          const [name, pid] = line.split('","').map(s => s.replace(/(^"|"$)/g, ''));
          map[pid] = name;
        } else {
          const [pid, ...nameParts] = line.trim().split(/\s+/);
          map[pid] = nameParts.join(' ');
        }
      });
      callback(null, map);
    });
  }
  async refresh() {
    let map = {}
    let list = await new Promise((resolve, reject) => {
      this.getPortPidList((err, portPidList) => {
        if (err) {
          reject(err)
          return
        }

        this.getPidToNameMap((err, pidToName) => {
          if (err) {
            reject(err)
            return
          }

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
        });
      });      
    })
    this.info = list
    this.map = map
  }
}
module.exports = Procs
