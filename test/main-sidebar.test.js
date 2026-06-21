const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const sidebarFile = path.resolve(__dirname, '..', 'server', 'views', 'partials', 'main_sidebar.ejs')

test('main sidebar renders local network peers before phone access', async () => {
  const source = await fs.readFile(sidebarFile, 'utf8')

  const localNetworkIndex = source.indexOf('Local network')
  const peerListIndex = source.indexOf('sidebarList.forEach')
  const phoneIndex = source.indexOf('main-sidebar-phone-trigger')

  assert.notEqual(localNetworkIndex, -1)
  assert.notEqual(peerListIndex, -1)
  assert.notEqual(phoneIndex, -1)
  assert.ok(localNetworkIndex < peerListIndex)
  assert.ok(peerListIndex < phoneIndex)
})

test('main sidebar gates phone QR behind local access setup', async () => {
  const source = await fs.readFile(sidebarFile, 'utf8')

  assert.match(source, /peer_access_router_installed/)
  assert.match(source, /sidebarPhoneAccessNeedsSetup/)
  assert.match(source, /Set up local access/)
  assert.match(source, /\/setup\/network\?callback=/)
  assert.match(source, /Scan with a device on the same local network/)
  assert.match(source, /This link is not public and will not work outside this network/)
})
