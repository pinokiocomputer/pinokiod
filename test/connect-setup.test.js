const assert = require('node:assert/strict')
const test = require('node:test')

const setup = require('../kernel/bin/setup')

test('connect setup requires auth tooling without requiring caddy', () => {
  const preset = setup.connect({})
  const requirementNames = preset.requirements.map((item) => item.name)

  assert.equal(requirementNames.includes('huggingface'), true)
  assert.equal(requirementNames.includes('git'), true)
  assert.equal(requirementNames.includes('caddy'), false)
  assert.equal(preset.conda_requirements.includes('huggingface'), true)
  assert.equal(preset.conda_requirements.includes('git'), true)
  assert.equal(preset.conda_requirements.includes('caddy'), false)
})
