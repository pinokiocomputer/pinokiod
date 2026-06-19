const assert = require('node:assert/strict')
const test = require('node:test')

const URI = require('../kernel/api/uri')
const Util = require('../kernel/util')

test('uri.open builds URIs with query params without corrupting schemes', () => {
  const api = new URI()

  assert.equal(
    api.build({ uri: 'https://example.test/path' }),
    'https://example.test/path'
  )
  assert.equal(
    api.build({
      uri: 'https://example.test/path',
      params: {
        q: 'hello world',
        tag: ['one', 'two'],
        meta: { nested: true },
        skip: null
      }
    }),
    'https://example.test/path?q=hello%20world&tag=one&tag=two&meta=%7B%22nested%22%3Atrue%7D'
  )
  assert.equal(
    api.build({
      uri: 'https://example.test/path#section',
      params: { q: 'x' }
    }),
    'https://example.test/path?q=x#section'
  )
  assert.equal(
    api.build({
      uri: 'vscode://file/tmp/test.js',
      params: { line: 12 }
    }),
    'vscode://file/tmp/test.js?line=12'
  )
  assert.equal(
    api.build({
      uri: 'cursor://file/tmp/test.js',
      params: { line: 12 }
    }),
    'cursor://file/tmp/test.js?line=12'
  )
  assert.equal(
    api.build({
      uri: 'obsidian://open?vault=test',
      params: { file: 'Daily Note' }
    }),
    'obsidian://open?vault=test&file=Daily%20Note'
  )
  assert.equal(
    api.build({
      uri: 'mailto:test@example.com',
      params: { subject: 'Pinokio test' }
    }),
    'mailto:test@example.com?subject=Pinokio%20test'
  )
  assert.equal(
    api.build({ uri: 'file:///tmp/pinokio-uri-open-test.txt' }),
    'file:///tmp/pinokio-uri-open-test.txt'
  )
  assert.throws(
    () => api.build({}),
    /uri\.open requires params\.uri/
  )
})

test('uri.open dispatches the exact built URI to Util.openURI', async () => {
  const api = new URI()
  const originalOpenURI = Util.openURI
  const opened = []

  Util.openURI = async (uri) => {
    opened.push(uri)
    return { ok: true, status: 'stubbed' }
  }

  try {
    const response = await api.open({
      params: {
        uri: 'cursor://file/tmp/test.js',
        params: {
          line: 42,
          column: 7
        }
      }
    }, () => {})

    assert.deepEqual(opened, ['cursor://file/tmp/test.js?line=42&column=7'])
    assert.deepEqual(response, {
      uri: 'cursor://file/tmp/test.js?line=42&column=7',
      result: { ok: true, status: 'stubbed' }
    })
  } finally {
    Util.openURI = originalOpenURI
  }
})
