const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const sidebarFile = path.resolve(__dirname, '..', 'server', 'views', 'partials', 'main_sidebar.ejs')

test('main sidebar moves Home Server under Configure', async () => {
  const source = await fs.readFile(sidebarFile, 'utf8')

  const manageIndex = source.indexOf('aria-label="Manage"')
  const configureIndex = source.indexOf('aria-label="Configure"')
  const homeServerIndex = source.indexOf('Home Server')
  const autolaunchIndex = source.indexOf('Autolaunch')

  assert.notEqual(manageIndex, -1)
  assert.notEqual(configureIndex, -1)
  assert.notEqual(homeServerIndex, -1)
  assert.notEqual(autolaunchIndex, -1)
  assert.ok(manageIndex < configureIndex)
  assert.ok(configureIndex < homeServerIndex)
  assert.ok(homeServerIndex < autolaunchIndex)
  assert.match(source, /href="\/network"[\s\S]*Home Server/)
  assert.doesNotMatch(source, /aria-label="Computer"/)
  assert.doesNotMatch(source, />This machine</)
  assert.doesNotMatch(source, />Local network</)
})

test('main sidebar no longer renders peer rows or phone access modal', async () => {
  const source = await fs.readFile(sidebarFile, 'utf8')
  const style = await fs.readFile(path.resolve(__dirname, '..', 'server', 'public', 'style.css'), 'utf8')

  assert.doesNotMatch(source, /sidebarList\.forEach/)
  assert.doesNotMatch(source, /href="\/net\//)
  assert.doesNotMatch(source, /main-sidebar-phone-trigger/)
  assert.doesNotMatch(source, /data-peer-access-open/)
  assert.doesNotMatch(source, /data-peer-access-modal/)
  assert.doesNotMatch(source, /sidebarPhoneAccessNeedsSetup/)
  assert.doesNotMatch(source, /peer_access_router_installed/)
  assert.doesNotMatch(style, /main-sidebar-peer/)
})
