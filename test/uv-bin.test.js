const assert = require('node:assert/strict')
const test = require('node:test')

const UV = require('../kernel/bin/uv')

function createUV(version) {
  const uv = new UV()
  uv.kernel = {
    bin: {
      installed: {
        conda: new Set(version ? ['uv'] : []),
        conda_versions: version ? { uv: version } : {},
      },
    },
  }
  return uv
}

test('UV bin pins uv to 0.11.23', () => {
  assert.equal(createUV('0.11.23').cmd(), 'uv=0.11.23')
})

test('UV.installed accepts exactly uv 0.11.23', async () => {
  assert.equal(await createUV('0.11.23').installed(), true)
  assert.equal(await createUV('0.11.23-h1234567_0').installed(), true)
  assert.equal(await createUV('0.11.22').installed(), false)
  assert.equal(await createUV('0.12.0').installed(), false)
  assert.equal(await createUV(null).installed(), false)
})
