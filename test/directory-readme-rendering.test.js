const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const express = require('express')
const Server = require('../server')

const viewsPath = path.resolve(__dirname, '..', 'server', 'views')

async function createDirectoryRendererFixture({ legacyCustomViews = false } = {}) {
  const homedir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pinokio-directory-readme-'))
  const apiRoot = path.resolve(homedir, 'api')
  const appRoot = path.resolve(apiRoot, 'demo')
  await fs.promises.mkdir(appRoot, { recursive: true })
  await fs.promises.writeFile(path.resolve(apiRoot, 'README.md'), '# ROOT README SENTINEL\n')
  await fs.promises.writeFile(path.resolve(appRoot, 'README.md'), '# APP README SENTINEL\n')
  await fs.promises.writeFile(path.resolve(appRoot, 'keep.txt'), 'keep\n')

  const customViewsPath = path.resolve(homedir, 'web', 'views')
  if (legacyCustomViews) {
    await fs.promises.mkdir(customViewsPath, { recursive: true })
    const legacyTemplate = [
      '<% if (readme) { %>',
      '<div class="readme markdown-body"><%- readme %></div>',
      '<% } %>',
      '<% items.forEach((item) => { %>',
      '<div data-name="<%= item.name %>"></div>',
      '<% }) %>'
    ].join('\n')
    await Promise.all([
      fs.promises.writeFile(path.resolve(customViewsPath, 'index.ejs'), legacyTemplate),
      fs.promises.writeFile(path.resolve(customViewsPath, 'file_explorer.ejs'), legacyTemplate)
    ])
  }

  const renderer = Object.create(Server.prototype)
  renderer.kernel = {
    homedir,
    path: (...segments) => path.resolve(homedir, ...segments),
    api: {
      userdir: apiRoot,
      proxies: {},
      running: {},
      launcher: async (name) => ({
        script: null,
        launcher_root: ''
      })
    },
    dns: async ({ name }) => {
      renderer.kernel.pinokio_configs[name] = { dns: { '@': [] } }
    },
    peer: {
      host: '127.0.0.1',
      check_peers: async () => {}
    },
    launch_complete: true,
    pinokio_configs: {}
  }
  renderer.autolaunch = {
    applyHomeStartingState: async () => false
  }
  renderer.portal = ''
  renderer.install = ''
  renderer.port = 0
  renderer.theme = 'light'
  renderer.logo = ''
  renderer.cloudflare_pub = null
  renderer.composePeerAccessPayload = async () => ({
    peer_access_points: [],
    peer_url: 'http://127.0.0.1:42000',
    peer_qr: null,
    peer_access_router_installed: false
  })
  renderer.current_urls = async () => ({})
  renderer.getPeers = () => []

  const app = express()
  app.set('views', [customViewsPath, viewsPath])
  app.set('view engine', 'ejs')
  app.get('/home', (req, res, next) => {
    renderer.render(req, res, [], {}).catch(next)
  })
  app.get('/_api/demo', (req, res, next) => {
    req.query.mode = 'source'
    renderer.render(req, res, ['demo']).catch(next)
  })
  app.get('/api/demo', (req, res, next) => {
    renderer.render(req, res, ['demo']).catch(next)
  })
  app.use((error, req, res, next) => {
    res.status(500).send(error.stack || error.message)
  })

  const httpServer = http.createServer(app)
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address()

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve())
      })
      await fs.promises.rm(homedir, { recursive: true, force: true })
    }
  }
}

test('directory pages list README files without auto-rendering their contents', async () => {
  const fixture = await createDirectoryRendererFixture()
  try {
    const [homeResponse, sourceResponse, runResponse] = await Promise.all([
      fetch(`${fixture.baseUrl}/home`),
      fetch(`${fixture.baseUrl}/_api/demo`),
      fetch(`${fixture.baseUrl}/api/demo`)
    ])
    const [homeHtml, sourceHtml, runHtml] = await Promise.all([
      homeResponse.text(),
      sourceResponse.text(),
      runResponse.text()
    ])

    assert.equal(homeResponse.status, 200, homeHtml)
    assert.equal(sourceResponse.status, 200, sourceHtml)
    assert.equal(runResponse.status, 200, runHtml)

    assert.doesNotMatch(homeHtml, /ROOT README SENTINEL/)
    for (const html of [sourceHtml, runHtml]) {
      assert.doesNotMatch(html, /APP README SENTINEL/)
      assert.match(html, /data-name="README\.md"/)
      assert.match(html, /data-name="keep\.txt"/)
      assert.doesNotMatch(html, /class=['"]readme markdown-body['"]/)
    }
  } finally {
    await fixture.close()
  }
})

test('legacy custom directory views can reference readme without crashing', async () => {
  const fixture = await createDirectoryRendererFixture({ legacyCustomViews: true })
  try {
    const responses = await Promise.all([
      fetch(`${fixture.baseUrl}/home`),
      fetch(`${fixture.baseUrl}/_api/demo`),
      fetch(`${fixture.baseUrl}/api/demo`)
    ])
    const html = await Promise.all(responses.map((response) => response.text()))

    responses.forEach((response, index) => {
      assert.equal(response.status, 200, html[index])
    })
    assert.doesNotMatch(html[0], /ROOT README SENTINEL/)
    for (const page of html.slice(1)) {
      assert.doesNotMatch(page, /APP README SENTINEL/)
      assert.match(page, /data-name="README\.md"/)
      assert.match(page, /data-name="keep\.txt"/)
    }
  } finally {
    await fixture.close()
  }
})
