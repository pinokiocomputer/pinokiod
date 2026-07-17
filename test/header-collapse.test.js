const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('header collapse preserves expanded and legacy minimized header styles', async () => {
  const style = await fs.readFile(path.join(root, 'server/public/style.css'), 'utf8')
  const expanded = style.match(/body\.header-collapse-enabled > header\.navheader:not\(\.minimized\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const collapsed = style.match(/body\.header-collapsed > header\.navheader:not\(\.minimized\) \{[\s\S]*?\n  \}/)?.[0] || ''

  assert.match(expanded, /grid-template-rows: minmax\(0, 1fr\)/)
  assert.doesNotMatch(expanded, /(?:height|padding|border): .*!important/)
  assert.match(collapsed, /grid-template-rows: minmax\(0, 0fr\)/)
  assert.match(collapsed, /padding-top: 0 !important/)
  assert.match(collapsed, /padding-bottom: 0 !important/)
})

test('collapse-only script includes do not activate legacy navigation behavior', async () => {
  const [nav, connect, create, common] = await Promise.all([
    fs.readFile(path.join(root, 'server/public/nav.js'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/connect/x.ejs'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/create.ejs'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/partials/app_common_scripts.ejs'), 'utf8')
  ])
  const controller = nav.slice(nav.indexOf('(() => {'), nav.indexOf('if (headerCollapseOnly) return;'))

  assert.ok([connect, create, common].every((source) => /nav\.js" data-header-collapse-only/.test(source)))
  assert.match(nav, /document\.currentScript\?\.hasAttribute\("data-header-collapse-only"\)/)
  assert.match(nav, /if \(headerCollapseOnly\) return;/)
  assert.doesNotMatch(controller, /localStorage|sessionStorage/)
})
