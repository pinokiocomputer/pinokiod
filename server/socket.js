const querystring = require("querystring");
const WebSocket = require('ws');
const path = require('path')
const os = require('os')
const fs = require('fs')
const Util = require("../kernel/util")
const Environment = require("../kernel/environment")
const NOTIFICATION_CHANNEL = 'kernel.notifications'
class Socket {
  constructor(parent) {
    this.buffer = {}
    this.old_buffer = {}
    this.rawLog = {}
    this.logMeta = {}
    this.sessions = {}
    this.connected = {}
    this.active_shell = {}
    this.shell_to_path = {}
    this.parent = parent
    this.server = parent.server
//    this.kernel = parent.kernel
    const wss = new WebSocket.Server({ server: this.parent.server })
    this.localDeviceIds = new Set()
    this.localAddresses = new Set()
    try {
      const ifaces = os.networkInterfaces() || {}
      Object.values(ifaces).forEach((arr) => {
        (arr || []).forEach((info) => {
          if (info && info.address) {
            this.localAddresses.add(info.address)
          }
        })
      })
      this.localAddresses.add('127.0.0.1')
      this.localAddresses.add('::1')
    } catch (_) {}
    this.subscriptions = new Map(); // Initialize a Map to store the WebSocket connections interested in each event
    this.notificationChannel = NOTIFICATION_CHANNEL
    this.notificationBridgeDispose = null
    this.parent.kernel.api.listen("server.socket", this.trigger.bind(this))
    wss.on('connection', (ws, request) => {
      ws._headers = request.headers;
      ws._ip = request.socket.remoteAddress;
      ws._boundUrl = (request.headers['x-forwarded-proto'] || 'ws') + '://' +
                    (request.headers['x-forwarded-host'] || request.headers.host) +
                    request.url;
      ws._origin = request.headers.origin;
      ws.on('close', () => {
        this.subscriptions.forEach((set, eventName) => {
          if (!set) {
            return;
          }
          set.delete(ws);
          if (set.size === 0) {
            this.subscriptions.delete(eventName);
          }
        });
        // Cleanup device tracking
        try {
          if (ws._isLocalClient && ws._deviceId) {
            this.localDeviceIds.delete(ws._deviceId)
          }
        } catch (_) {}
        this.checkNotificationBridge();
      });
      ws.on('message', async (message, isBinary) => {
        let req
        if (isBinary) {
          const buffer = Buffer.from(message);
          const sepIndex = buffer.indexOf(0);
          if (sepIndex === -1) throw new Error("Missing metadata separator");
          const metaStr = buffer.slice(0, sepIndex).toString('utf-8');
          const meta = JSON.parse(metaStr);
          const bufferKeys = meta.buffer_keys || [];
          const resultBuffers = {};
          let offset = sepIndex + 1;
          for (const key of bufferKeys) {
            if (offset + 4 > buffer.length) throw new Error("Unexpected EOF while reading buffer length");
            const len = buffer.readUInt32BE(offset);
            offset += 4;
            if (offset + len > buffer.length) throw new Error("Unexpected EOF while reading buffer data");
            const fileBuf = buffer.slice(offset, offset + len);
            resultBuffers[key] = fileBuf;
            offset += len;
          }
          if (meta.rpc) {
            req = meta.rpc
            if (!req.params) {
              req.params = {}
            }
            if (!req.params.buffers) {
              req.params.buffers = {}
            }
            for (const [key, buf] of Object.entries(resultBuffers)) {
              req.params.buffers[key] = buf
            }
          } else {
            // legacy path keeps response semantics
            if (!meta.response) {
              meta.response = {}
            }
            for (const [key, buf] of Object.entries(resultBuffers)) {
              meta.response[key] = buf
            }
            req = meta
          }
        } else {
          req = JSON.parse(message)
        }
        req.origin = ws._origin
        if (req.response) {
          this.parent.kernel.api.respond(req)
        } else {
          // link git every time before processing
          await this.parent.kernel.api.init()
          // look for repos that match
          if (req.uri) {
            if (req.mode === "open") {
              // get the default script and respond
              let id = this.parent.kernel.api.filePath(req.uri)
              try {
                let default_url = await this.parent.kernel.api.get_default(id)
                ws.send(JSON.stringify({
                  data: {
                    uri: default_url 
                  }
                }))
              } catch (e) {
                console.log(e)
              }
            } else {
              if (req.uri.startsWith("http")) {
                // open
                Util.openfs(req.uri, { mode: "open" })
              } else {
                /******************************************************************
                *
                *  req.uri is ALWAYS either of the two:
                *  1. ~/...
                *  2. https://github.com/...
                *
                *  Need to turn it into absolute file path before subscribing
                *
                ******************************************************************/

                // req.uri is always http or absolute path
                let id
                if (req.id) {
                  id = req.id
                } else {
                  id = this.parent.kernel.api.filePath(req.uri)
                }

                if (req.status) {
                  ws.send(JSON.stringify({
                    data: this.parent.kernel.api.running[id] ? true : false
                  }))
                } else if (req.stop) {
                  this.parent.kernel.api.stop({ params: req })
                } else {
                  let buf = this.buffer[id]
                  let sh = this.active_shell[id]
                  this.subscribe(ws, id, buf, sh)
                  if (req.mode !== "listen") {
                    // Run only if currently not running
                    if (!this.parent.kernel.api.running[id]) {

                      // clear the log first

                      await this.parent.kernel.clearLog(id)


                      this.parent.kernel.api.process(req).catch((err) => {
                        console.error('[socket] api.process failed (uri):', (err && err.stack) ? err.stack : err)
                      })
                    }
                  }
                }
              }

            }
          } else if (req.method) {
            if (req.id) {
              let buf = this.buffer[req.id]
              let sh = this.active_shell[req.id]
              this.subscribe(ws, req.id, buf, sh)
              if (sh) {
                // if the active shell exists, check if it's killed
                // if the shell is running, don't do anything
                // if the shell is not running, run the request
                let shell = this.parent.kernel.shell.get(sh)
                if (!shell) {
                  await this.parent.kernel.clearLog(req.id)
                  this.parent.kernel.api.process(req).catch((err) => {
                    console.error('[socket] api.process failed (method/id):', (err && err.stack) ? err.stack : err)
                  })
                }
                // if it's not killed, don't do anything
              } else {
                this.parent.kernel.api.process(req).catch((err) => {
                  console.error('[socket] api.process failed (method):', (err && err.stack) ? err.stack : err)
                })
              }
            } else {
              if (req.method === this.notificationChannel) {
                if (typeof req.device_id === 'string' && req.device_id.trim()) {
                  ws._deviceId = req.device_id.trim()
                }
                // Mark local client sockets by IP matching any local address
                try {
                  const ip = ws._ip || ''
                  const isLocal = (addr) => {
                    if (!addr || typeof addr !== 'string') return false
                    if (this.localAddresses.has(addr)) return true
                    const v = addr.trim().toLowerCase()
                    return v.startsWith('::ffff:127.') || v.startsWith('127.')
                  }
                  ws._isLocalClient = isLocal(ip)
                  if (ws._isLocalClient && ws._deviceId) {
                    this.localDeviceIds.add(ws._deviceId)
                  }
                } catch (_) {}
              }
              this.subscribe(ws, req.method)
              if (req.mode !== "listen") {
                this.parent.kernel.api.process(req).catch((err) => {
                  console.error('[socket] api.process failed (notification):', (err && err.stack) ? err.stack : err)
                })
              }
            }
          } else if (req.emit) {
            if (req.id) {
              const shell = this.parent.kernel.shell.get(req.id)
              if (shell) {
                shell.setUserActive(true)
              }
            }
            this.parent.kernel.shell.emit(req)
          } else if (req.key && req.id) {
            const shell = this.parent.kernel.shell.get(req.id)
            if (shell) {
              shell.setUserActive(true)
            }
            this.parent.kernel.shell.emit({
              id: req.id,
              emit: req.key,
              paste: req.paste
            })
          } else if (req.resize && req.id) {
            const targetId = this.shell_to_path[req.id] || req.id
            this.parent.kernel.shell.resize({
              id: req.id,
              resize: req.resize
            })
            const subscribers = this.subscriptions.get(targetId)
            if (subscribers && subscribers.size > 0) {
              const payload = JSON.stringify({
                type: 'resize',
                data: {
                  id: req.id,
                  cols: req.resize.cols,
                  rows: req.resize.rows
                }
              })
              subscribers.forEach((subscriber) => {
                if (subscriber !== ws && subscriber.readyState === WebSocket.OPEN) {
                  subscriber.send(payload)
                }
              })
            }
          }
        }

      })
    });
    wss.on('headers', (headers, req) => {
      headers.push('Access-Control-Allow-Origin: *');
      headers.push('Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept');
    });

    this.interval = setInterval(async () => {
      for(let key in this.buffer) {
        let buf = this.buffer[key]
        if (this.old_buffer[key] !== buf) {
          this.log_buffer(key, buf, this.logMeta[key])
        } else {
//          console.log(`State hasn't changed: ${key}`)
        }
      }
      this.old_buffer = structuredClone(this.buffer)
    }, 5000)
  }
  subscribe(ws, id, buf, sh) {

    if (this.parent.kernel.api.running[id]) {
      ws.send(JSON.stringify({
        type: "connect",
        data: {
          id,
          state: buf,
          shell: sh
        }
      }))
    }

    if (!this.subscriptions.has(id)) {
      this.subscriptions.set(id, new Set());
    }
    const set = this.subscriptions.get(id)
    set.add(ws);
    if (set.size === 1 && id === this.notificationChannel) {
      this.ensureNotificationBridge();
    }
  }
  trigger(e) {
    // send to id session
    let id
    if (typeof e.id === "string") {
      if (e.id.includes("session=")) {
        id = e.id
      } else if (e.id.startsWith("shell/")) {
        id = e.id
      } else if (e.kernel && !(e.id.startsWith("~/") || e.id.startsWith("/") || e.id.startsWith("http"))) {
        // kernel method ids such as "kernel.api.stop" are not paths
        id = e.id
      } else {
        try {
          id = this.parent.kernel.api.filePath(e.id)
        } catch (error) {
          id = e.id
        }
      }
    } else {
      id = e.id
    }

    const meta = this.extractMeta(e)
    this.logMeta[id] = meta

    const subscribers = this.subscriptions.get(id) || new Set();
    if (subscribers.size > 0) {
      //const subscribers = this.subscriptions.get(e.id) || new Set();
      subscribers.forEach((subscriber) => {
        if (subscriber.readyState === WebSocket.OPEN) {
          let res = Object.assign({}, e)
          delete res.rpc
          delete res.rawrpc
          if (res.data && res.data.id && res.data.raw) {
            res.data = {
              id: res.data.id,
              raw: res.data.raw
            }
          }
          subscriber.send(JSON.stringify(res))
        }
      });
    }

    if (e.data && e.data.type === "shell.kill") {
      this.log_buffer(id, this.buffer[id], meta).then(() => {
        // when shell is killed, reset the buffer
        delete this.buffer[id]
        delete this.sessions[id]
        delete this.rawLog[id]
        delete this.logMeta[id]
      })
    }

    if (!this.buffer[id]) {
      this.buffer[id] = ""
      if (!this.sessions[id]) {
        this.sessions[id] = "" + Date.now()
      }
    }
    if (e.data && e.data.raw) {
      const isShell = this.isShellLog(id, meta)
      const isShellRun = meta && meta.method === 'shell.run'
      if (meta.memory) {
        this.appendEventLog(id, meta, e.data.raw)
      } else if (meta.source === 'api' && !isShellRun) {
        this.appendEventLog(id, meta, e.data.raw)
      }
      if (!isShell) {
        const tagged = this.tagLines(meta, e.data.raw)
        this.rawLog[id] = (this.rawLog[id] || "") + (this.rawLog[id] ? "\n" : "") + tagged
        this.log_buffer(id, this.buffer[id], meta)
      } else {
        delete this.rawLog[id]
      }
    }
    //if (e.data && e.data.raw) this.buffer[id] += e.data.raw
    if (e.data && e.data.buf) this.buffer[id] = e.data.buf

    if (e.data && e.data.shell_id) {
      this.active_shell[id] = e.data.shell_id
      this.shell_to_path[e.data.shell_id] = id
    }

    // send to caller session
    if (e.caller) {
      let caller
      if (e.kernel) {
        caller = e.caller
      } else {
        caller = this.parent.kernel.api.filePath(e.caller)
      }

      const subscribers = this.subscriptions.get(caller) || new Set();
      if (subscribers.size > 0) {
        subscribers.forEach((subscriber) => {
          if (subscriber.readyState === WebSocket.OPEN) {

            let res = Object.assign({}, e)
            delete res.rpc
            delete res.rawrpc
            if (res.data && res.data.id && res.data.raw) {
              res.data = {
                id: res.data.id,
                raw: res.data.raw
              }
            }
            subscriber.send(JSON.stringify(res))

          }
        });
      }

      if (!this.buffer[caller]) {
        this.buffer[caller] = ""
      }
      //if (e.data.raw) this.buffer[caller] += e.data.raw
      if (e.data.buf) this.buffer[caller] = e.data.buf

      if (e.data && e.data.shell_id) {
        this.active_shell[caller] = e.data.shell_id
      }
    }
  }

  broadcastNotification(payload) {
    if (!payload) {
      return
    }
    const subscribers = this.subscriptions.get(this.notificationChannel)
    if (!subscribers || subscribers.size === 0) {
      return
    }
    const envelope = {
      id: this.notificationChannel,
      type: 'notification',
      data: payload,
    }
    const frame = JSON.stringify(envelope)
    const targetId = (payload && typeof payload.device_id === 'string' && payload.device_id.trim()) ? payload.device_id.trim() : null
    const audience = (payload && typeof payload.audience === 'string' && payload.audience.trim()) ? payload.audience.trim() : null
    if (audience === 'device' && targetId) {
      let delivered = false
      subscribers.forEach((subscriber) => {
        if (subscriber.readyState !== WebSocket.OPEN) {
          return
        }
        if (subscriber._deviceId && subscriber._deviceId === targetId) {
          try { subscriber.send(frame); delivered = true } catch (_) {}
        }
      })
      if (!delivered) {
        // Fallback: broadcast if no matching device subscriber is available
        subscribers.forEach((subscriber) => {
          if (subscriber.readyState === WebSocket.OPEN) {
            try { subscriber.send(frame) } catch (_) {}
          }
        })
      }
    } else {
      subscribers.forEach((subscriber) => {
        if (subscriber.readyState === WebSocket.OPEN) {
          try { subscriber.send(frame) } catch (_) {}
        }
      })
    }
  }

  isLocalDevice(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') return false
    return this.localDeviceIds.has(deviceId)
  }

  ensureNotificationBridge() {
    if (this.notificationBridgeDispose) {
      return
    }
    this.notificationBridgeDispose = Util.registerPushListener((payload) => {
      this.broadcastNotification(payload)
    })
  }

  checkNotificationBridge() {
    const subscribers = this.subscriptions.get(this.notificationChannel)
    if ((!subscribers || subscribers.size === 0) && this.notificationBridgeDispose) {
      try {
        this.notificationBridgeDispose()
      } catch (err) {
        console.error('Failed to dispose notification bridge:', err)
      }
      this.notificationBridgeDispose = null
    }
  }

  isShellLog(id, meta) {
    const idStr = (typeof id === 'string') ? id : ''
    if (meta && meta.method === 'shell.run') return true
    if (idStr.startsWith('shell/')) return true
    if (!path.isAbsolute(idStr) && !idStr.startsWith('http')) return true
    return false
  }

  async resolveLogDir(key) {
    if (path.isAbsolute(key)) {
      let p = key.replace(/\?.*$/, '')
      let relative = path.relative(this.parent.kernel.homedir, p)
      if (relative.startsWith("plugin")) {
        let m = /\?.*$/.exec(key)
        if (m && m.length > 0) {
          let paramStr = m[0]
          let cwd = new URL("http://localhost" + paramStr).searchParams.get("cwd")
          let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
          cwd = root.root
          return path.resolve(cwd, "logs/dev", relative)
        }
      } else if (relative.startsWith("api")) {
        let filepath_chunks = relative.split(path.sep).slice(2)
        let cwd = this.parent.kernel.path(...relative.split(path.sep).slice(0, 2))
        let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
        cwd = root.root
        return path.resolve(cwd, "logs/api", ...filepath_chunks)
      }
    } else {
      if (typeof key === 'string' && key.startsWith("shell/")) {
        let unix_id = key.slice(6)
        let unix_path = unix_id.split("_")[0]
        let native_path = Util.u2p(unix_path)
        let native_path_exists = await new Promise(r=>fs.access(native_path, fs.constants.F_OK, e => r(!e)))
        if (native_path_exists) {
          let cwd = native_path
          let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
          cwd = root.root
          return path.resolve(cwd, "logs/shell")
        }
      }
    }
    return null
  }

  async appendEventLog(key, meta, text) {
    const dir = await this.resolveLogDir(key)
    if (!dir || !text) return
    try {
      await fs.promises.mkdir(dir, { recursive: true })
      const tag = this.logTag(meta)
      const ts = new Date().toISOString()
      const lines = String(text || '').split(/\r?\n/).map((line) => `${ts} ${tag} ${line}`).join("\n")
      const eventPath = path.resolve(dir, "events")
      await fs.promises.appendFile(eventPath, lines + "\n")
    } catch (_) {}
  }

  logTag(meta) {
    if (meta && meta.memory) {
      return `[memory]`
    }
    const source = (meta && meta.source) ? meta.source : 'shell'
    const method = (meta && meta.method) ? meta.method : (source === 'shell' ? 'shell' : '')
    return `[${source}${method ? ' ' + method : ''}]`
  }

  tagLines(meta, text) {
    const tag = this.logTag(meta)
    const message = String(text || '')
    if (!message) {
      return tag
    }
    return `${tag}\n${message}`
  }

  extractMeta(e) {
    const meta = { source: 'shell', method: 'shell' }
    if (e && e.type === "memory") {
      meta.memory = true
    }
    if (e && e.kernel) {
      meta.source = 'kernel'
      meta.method = 'kernel'
    }
    if (e && (e.rpc || e.rawrpc)) {
      meta.source = 'api'
      const method = (e.rpc && e.rpc.method) || (e.rawrpc && e.rawrpc.method)
      if (method) {
        meta.method = method
      } else {
        meta.method = 'api'
      }
    }
    return meta
  }

  async log_buffer(key, buf, meta) {
    const resolvedMeta = meta || this.logMeta[key] || { source: 'shell', method: 'shell' }

    /*
      
      dev
        /Users/x/pinokio/plugin/dev/claude.json?cwd=/Users/x/pinokio/api/audioplay
        /Users/x/pinokio/plugin/dev/gemini.json?cwd=/Users/x/pinokio/api/audioplay

      api 
        /Users/x/pinokio/api/audioplay/start.json

      shell
        facefusion-pinokio.git_0.0_a56eb7d48c9e96d8a5217d625d83d204
        facefusion-pinokio.git_0.0_a56eb7d48c9e96d8a5217d625d83d204
        audioplay_0.0_a56eb7d48c9e96d8a5217d625d83d204
    */

    // 1. dev
    if (path.isAbsolute(key)) {
      let p = key.replace(/\?.*$/, '')
      let relative = path.relative(this.parent.kernel.homedir, p)
      if (relative.startsWith("plugin")) {
        // dev
        let m = /\?.*$/.exec(key)
        if (m && m.length > 0) {
          /*
          DEV Changed {
            cwd: '/Users/x/pinokio/api/audioplay',
            relative: 'plugin/dev/claude.json'
          }
          */
          let paramStr = m[0]
          let cwd = new URL("http://localhost" + paramStr).searchParams.get("cwd")
          let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
          cwd = root.root
          let session = this.sessions[key]
          //let logpath = path.resolve(cwd, "logs/dev", path.parse(relative).base)
          let logpath = path.resolve(cwd, "logs/dev", relative)
          const raw = this.rawLog[key] || ""
          const tagged = buf ? this.tagLines(resolvedMeta, buf) : ""
          const content = [raw, tagged].filter(Boolean).join("\n")
          await Util.log(logpath, content, session)
        }
      } else if (relative.startsWith("api")) {
        // api
        /*
        API Changed {
          cwd: '/Users/x/pinokio/api/audioplay/start.json',
          filepath: [ 'start.json' ]
        }
        */
        let filepath_chunks = relative.split(path.sep).slice(2)
        let cwd = this.parent.kernel.path(...relative.split(path.sep).slice(0, 2))
        let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
        cwd = root.root
        let session = this.sessions[key]
        let logpath = path.resolve(cwd, "logs/api", ...filepath_chunks)
        const raw = this.rawLog[key] || ""
        const tagged = buf ? this.tagLines(resolvedMeta, buf) : ""
        const content = [raw, tagged].filter(Boolean).join("\n")
        await Util.log(logpath, content, session)
      }
    } else {
      // Only log SHELL
      /*
        examples:
          key: facefusion-pinokio.git_0.0_a56eb7d48c9e96d8a5217d625d83d204
          key: facefusion-pinokio.git_0.0_a56eb7d48c9e96d8a5217d625d83d204
          key: audioplay_0.0_a56eb7d48c9e96d8a5217d625d83d204

          key: shell:/Users/x/pinokio/api/comfy.git_0.0.0_session_6e89dd5ef73b94e728634729d08a3cf1

      */

      if (key.startsWith("shell/")) {
        let unix_id = key.slice(6)
        let unix_path = unix_id.split("_")[0]
        let native_path = Util.u2p(unix_path)
        let native_path_exists = await new Promise(r=>fs.access(native_path, fs.constants.F_OK, e => r(!e)))
        if (native_path_exists) {
          let cwd = native_path
          let root = await Environment.get_root({ path: cwd }, this.parent.kernel)
          cwd = root.root
          let session = this.sessions[key]
          let logpath = path.resolve(cwd, "logs/shell")
          const content = buf || ""
          await Util.log(logpath, content, session)
        }
      }
    }
  }
}
module.exports = Socket
