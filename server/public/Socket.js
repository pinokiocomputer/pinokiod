/******************************************************************************

    // 1. streaming data
    packet = {
      id,
      type: “stream”,
      index: <current task index>,
      data: <streaming data returned from the module>
    }

    // 2. triggered once at the end of every step
    packet = {
      id,
      type: “result”,
      index: <current task index>,
      data: <final returned result from the module>
    }

    // 3. triggered at the end of an entire run loop
    packet = {
      id,
      type: “event”,
      data: “stop”
    }

    // 4. info
    packet = {
      id,
      type: “info”,
      data: data
    }

    // 5. error
    packet = {
      id,
      type: “error”,
      data: data
    }


    socket.send({
      cmd
    }, (packet) => {
      // do something
      socket.close()
    })


******************************************************************************/


//const WebSocket = require('isomorphic-ws');
class Socket {
  constructor(url) {
    if (url) {
      this.url = url
    } else if (location.protocol) {
      let protocol = (location.protocol === "https:" ? "wss" : "ws")
      this.url = `${protocol}://${location.host}`
    }
  }
  close() {
    if (this.ws) {
      this.ws.close()
      delete this.ws
    }
  }
  respond(response) {
    if (this.ws) {
      this.ws.send(JSON.stringify(response))
    } else {
      throw new Error("socket not connected")
    }
  }
  run (rpc, ondata, options) {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.send(JSON.stringify(rpc))
      } else {
        this.ws = new WebSocket(this.url)
        this.ws.addEventListener('open', () => {
          this.ws.send(JSON.stringify(rpc))
        });
        this.ws.addEventListener('message', (message) => {
          const packet = JSON.parse(message.data);
          ondata(packet)
        });
        this.ws.addEventListener('close', () => {
          console.log('Disconnected from WebSocket endpoint', { error: this.error, result: this.result });
          resolve()
        });
      }

    })
  }
  emit(e) {
    this.ws.send(JSON.stringify(e))
  }
}
