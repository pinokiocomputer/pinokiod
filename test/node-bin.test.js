const assert = require('node:assert/strict')
const test = require('node:test')

const Node = require('../kernel/bin/node')

function createNode({ nodeVersion = '24.18.0', pnpmVersion = '11.9.0', hasNode = true, hasPnpm = true } = {}) {
  const node = new Node()
  const conda = new Set()
  if (hasNode) conda.add('nodejs')
  if (hasPnpm) conda.add('pnpm')
  node.kernel = {
    bin: {
      installed: {
        conda,
        conda_versions: {
          nodejs: nodeVersion,
          pnpm: pnpmVersion,
        },
      },
    },
  }
  return node
}

test('Node bin pins Node.js 24 LTS and matching pnpm', () => {
  assert.equal(createNode().cmd(), 'nodejs=24.18.0 pnpm=11.9.0')
})

test('Node.installed accepts exactly the pinned Node.js and pnpm versions', async () => {
  assert.equal(await createNode().installed(), true)
  assert.equal(await createNode({ nodeVersion: '24.18.0-h654b19f_0' }).installed(), true)
  assert.equal(await createNode({ pnpmVersion: '11.9.0-h7c87c79_0' }).installed(), true)
  assert.equal(await createNode({ nodeVersion: '22.21.1' }).installed(), false)
  assert.equal(await createNode({ nodeVersion: '26.4.0' }).installed(), false)
  assert.equal(await createNode({ pnpmVersion: '10.29.3' }).installed(), false)
  assert.equal(await createNode({ pnpmVersion: '11.8.0' }).installed(), false)
  assert.equal(await createNode({ hasNode: false }).installed(), false)
  assert.equal(await createNode({ hasPnpm: false }).installed(), false)
})
