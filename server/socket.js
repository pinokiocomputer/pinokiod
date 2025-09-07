const WebSocket = require('ws');
const path = require('path')
const Util = require("../kernel/util")
const Environment = require("../kernel/environment")
class Socket {
  constructor(parent) {
    this.buffer = {}
    this.old_buffer = {}
    this.sessions = {}
    this.connected = {}
    this.active_shell = {}
    this.parent = parent
    this.server = parent.server
//    this.kernel = parent.kernel
    const wss = new WebSocket.Server({ server: this.parent.server })
    this.subscriptions = new Map(); // Initialize a Map to store the WebSocket connections interested in each event
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
          set.delete(ws);
        });
      });
      ws.on('message', async (message, isBinary) => {
        let req
        if (isBinary) {
          const buffer = Buffer.from(message);
          const sepIndex = buffer.indexOf(0);
          if (sepIndex === -1) throw new Error("Missing metadata separator");
          const metaStr = buffer.slice(0, sepIndex).toString('utf-8');
          const meta = JSON.parse(metaStr);
          const bufferKeys = meta.buffer_keys;
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
          // Now you can save files
          for (const [key, buf] of Object.entries(resultBuffers)) {
            meta.response[key] = buf
          }
          req = meta
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


                      this.parent.kernel.api.process(req)
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
                  this.parent.kernel.api.process(req)
                }
                // if it's not killed, don't do anything
              } else {
                this.parent.kernel.api.process(req)
              }
            } else {
              this.subscribe(ws, req.method)
              if (req.mode !== "listen") {
                this.parent.kernel.api.process(req)
              }
            }
          } else if (req.emit) {
            this.parent.kernel.shell.emit(req)
          } else if (req.key && req.id) {
            this.parent.kernel.shell.emit({
              id: req.id,
              emit: req.key,
              paste: req.paste
            })
          } else if (req.resize && req.id) {
            this.parent.kernel.shell.resize({
              id: req.id,
              resize: req.resize
            })
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
          this.log_buffer(key, buf)
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
    this.subscriptions.get(id).add(ws);
  }
  trigger(e) {
    // send to id session
    let id
    if (e.kernel) {
      id = e.id
    } else {
      id = this.parent.kernel.api.filePath(e.id)
    }

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
      this.log_buffer(id, this.buffer[id]).then(() => {
        // when shell is killed, reset the buffer
        delete this.buffer[id]
        delete this.sessions[id]
      })
    }

    if (!this.buffer[id]) {
      this.buffer[id] = ""
      if (!this.sessions[id]) {
        this.sessions[id] = "" + Date.now()
      }
    }
    //if (e.data && e.data.raw) this.buffer[id] += e.data.raw
    if (e.data && e.data.buf) this.buffer[id] = e.data.buf

    if (e.data && e.data.shell_id) {
      this.active_shell[id] = e.data.shell_id
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
  async log_buffer(key, buf) {

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
          let logpath = path.resolve(cwd, "logs/dev", path.parse(relative).base)
          await Util.log(logpath, buf, session)
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
        await Util.log(logpath, buf, session)
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
          await Util.log(logpath, buf, session)
        }
      }
    }
  }
}
module.exports = Socket
