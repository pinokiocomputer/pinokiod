const assert = require('node:assert/strict')
const test = require('node:test')

const Huggingface = require('../kernel/bin/huggingface')

function createHuggingface(version) {
  const huggingface = new Huggingface()
  huggingface.kernel = {
    bin: {
      installed: {
        conda: new Set(version ? ['huggingface_hub'] : []),
        conda_versions: version ? { huggingface_hub: version } : {},
      },
    },
  }
  return huggingface
}

test('Huggingface.installed accepts exactly huggingface_hub 1.0.1', async () => {
  assert.equal(await createHuggingface('1.0.1').installed(), true)
  assert.equal(await createHuggingface('1.0.1-pyhd8ed1ab_0').installed(), true)
  assert.equal(await createHuggingface('1.0.2').installed(), false)
  assert.equal(await createHuggingface('0.35.3').installed(), false)
  assert.equal(await createHuggingface(null).installed(), false)
})
