const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')
const express = require('express')
const registerConnectRoutes = require('../server/routes/connect')

const viewsPath = path.resolve(__dirname, '..', 'server', 'views')

async function startConnectServer(options = {}) {
  const app = express()
  app.set('views', viewsPath)
  app.set('view engine', 'ejs')
  registerConnectRoutes(app, {
    getPageContext: () => ({
      portal: '',
      logo: '',
      theme: 'light',
      agent: 'test'
    }),
    getGithubConnection: options.getGithubConnection,
    getProviderConnection: options.getProviderConnection,
    statusTimeoutMs: options.statusTimeoutMs
  })
  app.use((error, req, res, next) => {
    res.status(500).send(error.message)
  })

  const server = http.createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function fetchWithin(url, timeoutMs = 500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

test('/connect renders without invoking provider status checks', async () => {
  let githubCalls = 0
  let huggingfaceCalls = 0
  const fixture = await startConnectServer({
    getGithubConnection: async () => {
      githubCalls += 1
      return await new Promise(() => {})
    },
    getProviderConnection: async () => {
      huggingfaceCalls += 1
      return await new Promise(() => {})
    }
  })

  try {
    const response = await fetchWithin(`${fixture.baseUrl}/connect`)
    const html = await response.text()

    assert.equal(response.status, 200)
    assert.equal(githubCalls, 0)
    assert.equal(huggingfaceCalls, 0)
    assert.match(html, /data-connect-provider="huggingface"/)
    assert.match(html, /data-connect-provider="github"/)
    assert.match(html, /Checking\.\.\./)
  } finally {
    await fixture.close()
  }
})

test('/connect status endpoints check providers independently with bounded options', async () => {
  const calls = []
  const fixture = await startConnectServer({
    statusTimeoutMs: 75,
    getGithubConnection: async (options) => {
      calls.push({ provider: 'github', options })
      return { connected: true }
    },
    getProviderConnection: async (provider, options) => {
      calls.push({ provider, options })
      return false
    }
  })

  try {
    const [githubResponse, huggingfaceResponse] = await Promise.all([
      fetch(`${fixture.baseUrl}/connect/status/github`),
      fetch(`${fixture.baseUrl}/connect/status/huggingface`)
    ])
    const github = await githubResponse.json()
    const huggingface = await huggingfaceResponse.json()

    assert.deepEqual(github, { provider: 'github', connected: true })
    assert.deepEqual(huggingface, { provider: 'huggingface', connected: false })
    assert.deepEqual(calls, [{
      provider: 'github',
      options: { timeout: 75 }
    }, {
      provider: 'huggingface',
      options: { timeout: 75 }
    }])
    assert.match(githubResponse.headers.get('cache-control'), /no-store/)
  } finally {
    await fixture.close()
  }
})

test('/connect status endpoints degrade provider errors to disconnected', async () => {
  const fixture = await startConnectServer({
    statusTimeoutMs: 30,
    getGithubConnection: async () => {
      throw new Error('github unavailable')
    },
    getProviderConnection: async () => {
      throw new Error('huggingface unavailable')
    }
  })

  try {
    const [githubResponse, huggingfaceResponse] = await Promise.all([
      fetch(`${fixture.baseUrl}/connect/status/github`),
      fetch(`${fixture.baseUrl}/connect/status/huggingface`)
    ])

    assert.equal(githubResponse.status, 200)
    assert.equal(huggingfaceResponse.status, 200)
    assert.deepEqual(await githubResponse.json(), { provider: 'github', connected: false })
    assert.deepEqual(await huggingfaceResponse.json(), { provider: 'huggingface', connected: false })
  } finally {
    await fixture.close()
  }
})
