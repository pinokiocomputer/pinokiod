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
  assert.match(source, /data-main-sidebar-home-server-tab/)
  assert.match(source, /data-main-sidebar-home-server-status/)
  assert.match(source, /fetch\("\/info\/home-server", \{ cache: "no-store" \}\)/)
  assert.match(source, /status === "on" \? "on" : "off"/)
  assert.doesNotMatch(source, /aria-label="Computer"/)
  assert.doesNotMatch(source, />This machine</)
  assert.doesNotMatch(source, />Local network</)
})

test('main sidebar styles the Home Server ON/OFF badge in the tab status column', async () => {
  const style = await fs.readFile(path.resolve(__dirname, '..', 'server', 'public', 'style.css'), 'utf8')
  const badgeRule = style.match(/\.main-sidebar \.main-sidebar-status-badge \{[\s\S]*?\n\}/)?.[0] || ''
  const darkBadgeRule = style.match(/body\.dark \.main-sidebar \.main-sidebar-status-badge \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(style, /\.main-sidebar \.main-sidebar-status-badge \{/)
  assert.match(style, /grid-column:\s*3/)
  assert.match(style, /\.main-sidebar \.main-sidebar-status-badge\[hidden\]/)
  assert.match(style, /\.main-sidebar \.main-sidebar-status-badge\[data-state="on"\]/)
  assert.match(style, /body\.dark \.main-sidebar \.main-sidebar-status-badge\[data-state="on"\]/)
  assert.match(badgeRule, /background:\s*rgba\(15,\s*23,\s*42,\s*0\.07\)/)
  assert.match(darkBadgeRule, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\)/)
  assert.doesNotMatch(`${badgeRule}\n${darkBadgeRule}`, /rgba\(207,\s*69,\s*69,\s*0\.12\)/)
  assert.doesNotMatch(`${badgeRule}\n${darkBadgeRule}`, /#fca5a5/)
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

test('main sidebar renders external community links as a footer cluster', async () => {
  const source = await fs.readFile(sidebarFile, 'utf8')
  const style = await fs.readFile(path.resolve(__dirname, '..', 'server', 'public', 'style.css'), 'utf8')

  const configureIndex = source.indexOf('aria-label="Configure"')
  const connectedIndex = source.indexOf('aria-label="Community links"')

  assert.notEqual(configureIndex, -1)
  assert.notEqual(connectedIndex, -1)
  assert.ok(configureIndex < connectedIndex)
  assert.match(source, /main-sidebar-section-connect/)
  assert.doesNotMatch(source, /main-sidebar-section-connect[\s\S]*main-sidebar-section-title/)
  assert.doesNotMatch(source, />Stay Connected</)
  assert.match(source, /href="https:\/\/x\.com\/cocktailpeanut"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*data-main-sidebar-browser-link[\s\S]*fa-brands fa-x-twitter[\s\S]*Updates/)
  assert.match(source, /href="https:\/\/discord\.gg\/TQdNwadtE4"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*data-main-sidebar-browser-link[\s\S]*fa-brands fa-discord[\s\S]*Discord/)
  assert.match(source, /href="https:\/\/pinokiocomputer\.substack\.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*data-main-sidebar-browser-link[\s\S]*fa-solid fa-newspaper[\s\S]*Newsletter/)
  assert.doesNotMatch(source, /main-sidebar-section-connect[\s\S]*features="browser"/)
  assert.match(source, /window\.open\(href, "_blank", "browser"\)/)
  assert.match(source, /window\.open\(href, "_blank"\)/)
  assert.match(style, /\.main-sidebar \.main-sidebar-section-connect \{[\s\S]*margin-top:\s*auto/)
  assert.match(style, /\.main-sidebar \.main-sidebar-section-connect::before \{[\s\S]*background:\s*var\(--pinokio-sidebar-separator\)/)
})
