const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Kernel = require('../kernel')
const LocalhostStaticRouter = require('../kernel/router/localhost_static_router')

async function createDnsHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-dns-routes-'))
  const apiRoot = path.join(root, 'api')
  await fs.mkdir(apiRoot, { recursive: true })

  const scripts = new Map()
  const kernel = Object.create(Kernel.prototype)
  kernel.pinokio_configs = {}
  kernel.path = (...parts) => path.join(root, ...parts)
  kernel.exists = async (...parts) => {
    const target = parts.length === 1 ? parts[0] : path.join(...parts)
    try {
      await fs.access(target)
      return true
    } catch (_) {
      return false
    }
  }
  kernel.api = {
    launcher: async (name) => {
      return {
        script: scripts.get(name) || null,
        root: path.join(apiRoot, name),
      }
    },
  }

  const addApp = async (name, { index = false, script = null } = {}) => {
    const appRoot = path.join(apiRoot, name)
    await fs.mkdir(appRoot, { recursive: true })
    if (index) {
      await fs.writeFile(path.join(appRoot, 'index.html'), '<!doctype html>')
    }
    if (script) {
      scripts.set(name, script)
    }
    return appRoot
  }

  const buildStaticRoutes = () => {
    const router = {
      default_host: '127.0.0.1',
      default_port: 42000,
      rewrite_mapping: {},
      custom_routers: {},
      config: {
        apps: {
          http: {
            servers: {
              main: {
                routes: [],
              },
            },
          },
        },
      },
      kernel: {
        path: kernel.path,
        pinokio_configs: kernel.pinokio_configs,
        peer: {
          host: '192.168.1.10',
          name: 'peer1',
        },
      },
    }
    new LocalhostStaticRouter(router).handle()
    return router.rewrite_mapping
  }

  return { root, apiRoot, kernel, addApp, buildStaticRoutes }
}

test('dns does not synthesize static routes for folders without root index.html', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  await harness.addApp('notes-only')
  await harness.kernel.dns({ path: path.join(harness.apiRoot, 'notes-only') })

  assert.deepEqual(harness.kernel.pinokio_configs['notes-only'].dns['@'], [])
  assert.equal(harness.buildStaticRoutes()['notes-only'], undefined)
})

test('static router skips stale folder routes without root index.html', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  await harness.addApp('stale-route')
  harness.kernel.pinokio_configs['stale-route'] = {
    dns: {
      '@': ['.'],
    },
  }

  assert.equal(harness.buildStaticRoutes()['stale-route'], undefined)
})

test('dns keeps root static routes when index.html exists', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  await harness.addApp('static-site', { index: true })
  await harness.kernel.dns({ path: path.join(harness.apiRoot, 'static-site') })

  assert.deepEqual(harness.kernel.pinokio_configs['static-site'].dns['@'], ['.'])
  const rewrite = harness.buildStaticRoutes()['static-site']
  assert.ok(rewrite)
  assert.deepEqual(rewrite.file_server_options, { index_names: ['index.html'] })
})

test('dns keeps dynamic local and port routes without adding a static folder route', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  await harness.addApp('dynamic-app', {
    script: {
      dns: {
        '@': [':7860'],
      },
    },
  })
  await harness.kernel.dns({ path: path.join(harness.apiRoot, 'dynamic-app') })

  assert.deepEqual(harness.kernel.pinokio_configs['dynamic-app'].dns['@'], [
    ':7860',
    '$local.url@start',
  ])
  assert.equal(harness.buildStaticRoutes()['dynamic-app'], undefined)
})

test('dns derives routes without mutating a frozen launcher config', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  const config = Object.freeze({ title: 'Frozen app' })
  await harness.addApp('frozen-app', { script: config })

  await harness.kernel.dns({ path: path.join(harness.apiRoot, 'frozen-app') })

  assert.equal(Object.hasOwn(config, 'dns'), false)
  assert.equal(harness.kernel.pinokio_configs['frozen-app'].title, 'Frozen app')
  assert.deepEqual(harness.kernel.pinokio_configs['frozen-app'].dns['@'], [
    '$local.url@start',
  ])
})

test('dns derives routes from a frozen dns map', async (t) => {
  const harness = await createDnsHarness()
  t.after(async () => {
    await fs.rm(harness.root, { recursive: true, force: true })
  })

  const configuredRoutes = Object.freeze([':7860'])
  const configuredDns = Object.freeze({ '@': configuredRoutes })
  const config = Object.freeze({ dns: configuredDns })
  await harness.addApp('frozen-dns-app', { script: config })

  await harness.kernel.dns({ path: path.join(harness.apiRoot, 'frozen-dns-app') })

  assert.equal(config.dns, configuredDns)
  assert.deepEqual(configuredRoutes, [':7860'])
  assert.deepEqual(harness.kernel.pinokio_configs['frozen-dns-app'].dns['@'], [
    ':7860',
    '$local.url@start',
  ])
})
