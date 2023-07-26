const WebSocket = require('ws');
class Socket {
  constructor(parent) {
    this.buffer = {}
    this.connected = {}
    this.server = parent.server
    this.kernel = parent.kernel
    const wss = new WebSocket.Server({ server: this.server })
    this.subscriptions = new Map(); // Initialize a Map to store the WebSocket connections interested in each event
    this.kernel.api.listen("server.socket", this.trigger.bind(this))
    wss.on('connection', (ws, request) => {
      ws.on('close', () => {
        this.subscriptions.forEach((set, eventName) => {
          set.delete(ws);
        });
      });
      ws.on('message', async (message) => {
        const req = JSON.parse(message);
        if (req.response) {
          this.kernel.api.respond(req)
        } else {
          // link git every time before processing
          await this.kernel.api.init()
          // look for repos that match

          if (req.uri) {
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
            let id = this.kernel.api.filePath(req.uri)

            console.log("socket ID", { id, req })

  //          if (req.mode !== "listen") {
  //            // since the event came from the client, connect the buffer
  //            this.buffer[id] = []
  //          }
            if (req.status) {
              ws.send(JSON.stringify({
                data: this.kernel.api.running[id] ? true : false
              }))
            } else if (req.stop) {
              this.kernel.api.stop({ params: req })
            } else {
              this.subscribe(ws, id)

              if (req.mode !== "listen") {
                // Run only if currently not running
                if (!this.kernel.api.running[id]) {
                  this.kernel.api.process(req)
                }
              }
            }

          } else if (req.method) {
            this.subscribe(ws, req.method)
            if (req.mode !== "listen") {
              this.kernel.api.process(req)
            }
          }
        }

      })
    });
    wss.on('headers', (headers, req) => {
      headers.push('Access-Control-Allow-Origin: *');
      headers.push('Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept');
    });
  }
  subscribe(ws, id) {

    if (this.kernel.api.running[id]) {
      ws.send(JSON.stringify({
        type: "connect"
      }))
    }

    if (!this.subscriptions.has(id)) {
      this.subscriptions.set(id, new Set());
    }
    this.subscriptions.get(id).add(ws);
  }
  trigger(e) {
    let id
    if (e.kernel) {
      id = e.id
    } else {
      id = this.kernel.api.filePath(e.id)
    }

    const subscribers = this.subscriptions.get(id) || new Set();
    if (subscribers.size > 0) {
      //const subscribers = this.subscriptions.get(e.id) || new Set();
      subscribers.forEach((subscriber) => {
        if (subscriber.readyState === WebSocket.OPEN) {
          delete e.rpc
          delete e.rawrpc
          subscriber.send(JSON.stringify(e))
        }
      });
    } else {
//      if (!this.buffer[id]) {
//        this.buffer[id] = []
//      }
//      this.buffer[id].push(e)
    }
  }
}
module.exports = Socket
