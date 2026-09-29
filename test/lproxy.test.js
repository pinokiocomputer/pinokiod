const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')

const Lproxy = require('../kernel/lproxy')

const listen = async (server) => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

const freePort = async () => {
  const server = net.createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  return port
}

const startProxy = async (t, target) => {
  const lproxy = new Lproxy()
  const port = await freePort()
  await lproxy.start(target, { port })
  const server = lproxy.proxies[target]._server
  if (!server.listening) {
    await once(server, 'listening')
  }
  t.after(() => {
    server.closeAllConnections()
    lproxy.stop(target)
  })
  return port
}

const startUpstream = async (t, handler) => {
  const server = http.createServer(handler)
  const port = await listen(server)
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${port}`
}

const withTimeout = (promise, ms) => Promise.race([promise, delay(ms).then(() => 'timeout')])

test('lproxy releases the upstream response when the client disconnects mid-stream', async (t) => {
  let upstreamClosed
  const upstreamDone = new Promise((resolve) => { upstreamClosed = resolve })
  // An endless body, like a large video: the upstream only stops writing when
  // its response closes.
  const target = await startUpstream(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    const chunk = Buffer.alloc(64 * 1024)
    const pump = () => {
      while (!res.destroyed && res.write(chunk)) {}
    }
    res.on('drain', pump)
    res.on('close', () => upstreamClosed({ finished: res.writableFinished }))
    pump()
  })
  const proxyPort = await startProxy(t, target)

  const req = http.get({ host: '127.0.0.1', port: proxyPort, path: '/clip.mp4', agent: false })
  const [res] = await once(req, 'response')
  assert.equal(res.statusCode, 200)
  await once(res, 'data')
  req.destroy()

  assert.deepEqual(await withTimeout(upstreamDone, 3000), { finished: false })
})

test('lproxy still proxies complete responses', async (t) => {
  let upstreamClosed
  const upstreamDone = new Promise((resolve) => { upstreamClosed = resolve })
  const target = await startUpstream(t, (req, res) => {
    res.on('close', () => upstreamClosed({ finished: res.writableFinished }))
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('hello from upstream')
  })
  const proxyPort = await startProxy(t, target)

  const res = await fetch(`http://127.0.0.1:${proxyPort}/`)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'hello from upstream')
  assert.deepEqual(await withTimeout(upstreamDone, 3000), { finished: true })
})

test('lproxy survives an upstream reset after the response has started', async (t) => {
  const target = await startUpstream(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    res.write(Buffer.alloc(1024), () => {
      setTimeout(() => res.socket.resetAndDestroy(), 50)
    })
  })
  const proxyPort = await startProxy(t, target)

  const req = http.get({ host: '127.0.0.1', port: proxyPort, path: '/clip.mp4', agent: false })
  req.on('error', () => {})
  const [res] = await once(req, 'response')
  assert.equal(res.statusCode, 200)
  let clientError = null
  res.on('error', (err) => { clientError = err })
  const closed = new Promise((resolve) => res.on('close', resolve))
  res.resume()

  // The proxy has to drop the client connection (a 500 can no longer be sent)
  // instead of throwing ERR_HTTP_HEADERS_SENT.
  assert.notEqual(await withTimeout(closed, 3000), 'timeout')
  assert.equal(res.complete, false)
  assert.equal(clientError?.code, 'ECONNRESET')
})

test('lproxy answers CORS preflights with 200', async (t) => {
  const target = await startUpstream(t, (req, res) => {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
  })
  const proxyPort = await startProxy(t, target)

  const res = await fetch(`http://127.0.0.1:${proxyPort}/api`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://192.168.1.20:3000',
      'access-control-request-method': 'POST'
    }
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://192.168.1.20:3000')
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST')
  await res.arrayBuffer()
})

test('lproxy survives a websocket upgrade to an unreachable upstream', async (t) => {
  const target = `http://127.0.0.1:${await freePort()}`
  const proxyPort = await startProxy(t, target)

  const socket = net.connect(proxyPort, '127.0.0.1')
  socket.on('error', () => {})
  await once(socket, 'connect')
  socket.end([
    'GET /socket HTTP/1.1',
    `Host: 127.0.0.1:${proxyPort}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '',
    ''
  ].join('\r\n'))
  socket.resume()

  // `res` is the client socket for upgrades; the error handler must close it
  // rather than call writeHead on it.
  assert.notEqual(await withTimeout(once(socket, 'close'), 3000), 'timeout')
})
