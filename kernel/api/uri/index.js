const Util = require('../../util')

const appendQueryParams = (uri, params) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return uri
  }

  const entries = []
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === undefined || item === null) {
        continue
      }
      const serialized = typeof item === 'object' ? JSON.stringify(item) : String(item)
      entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(serialized)}`)
    }
  }

  if (entries.length === 0) {
    return uri
  }

  const hashIndex = uri.indexOf('#')
  const base = hashIndex === -1 ? uri : uri.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : uri.slice(hashIndex)
  const separator = base.includes('?')
    ? (base.endsWith('?') || base.endsWith('&') ? '' : '&')
    : '?'

  return `${base}${separator}${entries.join('&')}${hash}`
}

class URI {
  build(params = {}) {
    const uri = typeof params.uri === 'string' ? params.uri.trim() : ''
    if (!uri) {
      throw new Error('uri.open requires params.uri')
    }
    return appendQueryParams(uri, params.params)
  }

  async open(req, ondata, kernel) {
    const uri = this.build(req.params)
    ondata({ raw: `\r\nopening uri: ${uri}\r\n` })
    const result = await Util.openURI(uri)
    return { uri, result }
  }
}

module.exports = URI
