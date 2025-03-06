const WebSocket = require('ws');
const Util = require("../kernel/util")
class Socket {
  constructor(parent) {
    this.buffer = {}
    this.connected = {}
    this.active_shell = {}
    this.parent = parent
    this.server = parent.server
//    this.kernel = parent.kernel
    const wss = new WebSocket.Server({ server: this.parent.server })
    this.subscriptions = new Map(); // Initialize a Map to store the WebSocket connections interested in each event
    this.parent.kernel.api.listen("server.socket", this.trigger.bind(this))
    wss.on('connection', (ws, request) => {
      ws.on('close', () => {
        this.subscriptions.forEach((set, eventName) => {
          set.delete(ws);
        });
      });
      ws.on('message', async (message) => {
        const req = JSON.parse(message);
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
                console.log({ id, default_url })
                ws.send(JSON.stringify({
                  data: {
                    uri: default_url 
                  }
                }))
              } catch (e) {
                console.log(e)
              }
            } else {
              console.log("REQ.URI", req.uri)
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
                let id = this.parent.kernel.api.filePath(req.uri)

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
            this.subscribe(ws, req.method)
            if (req.mode !== "listen") {
              this.parent.kernel.api.process(req)
            }
          } else if (req.emit) {
            this.parent.kernel.shell.emit(req)
          } else if (req.key && req.id) {
            this.parent.kernel.shell.emit({
              id: req.id,
              emit: req.key
            })
          }
        }

      })
    });
    wss.on('headers', (headers, req) => {
      headers.push('Access-Control-Allow-Origin: *');
      headers.push('Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept');
    });
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

    if (!this.buffer[id]) {
      this.buffer[id] = ""
    }
    if (e.data && e.data.raw) this.buffer[id] += e.data.raw

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
      if (e.data.raw) this.buffer[caller] += e.data.raw

      if (e.data && e.data.shell_id) {
        this.active_shell[caller] = e.data.shell_id
      }
    }
  }
}
module.exports = Socket
