const Common = require('./common')
class PeerPeerRouter {
  constructor(router) {
    this.router = router
    this.common = new Common(router)
  }
  handle(peer) {
    for(let dial in peer.router) {
      if (dial.endsWith("/")) {
        dial = dial.slice(0, -1)
      }
      let matches = peer.router[dial]
      let exposed_matches = matches.filter((m) => {
        return m.endsWith(`${peer.name}.localhost`)
      })
      let chunks = dial.split(":")
      let port = chunks[chunks.length-1]
      let exposed_dial = `${peer.host}:${port}` // exposed_dial :- 192.168...
      for(let match of exposed_matches) {
        this.common.handle({
          match,
          dial: exposed_dial,
          host: peer.host
        })
      }
    }
  }
}
module.exports = PeerPeerRouter
