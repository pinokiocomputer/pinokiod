const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const Environment = require("../kernel/environment")
const ServerAutolaunch = require("../server/autolaunch")
const Util = require("../kernel/util")

const pathExists = async (target) => {
  try {
    await fs.stat(target)
    return true
  } catch (_) {
    return false
  }
}

const isSubpath = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

test("autolaunch route preserves configured script when startup is disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch"](
        { body: { app: "target", script: "start.js", enabled: false } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.app.autolaunch, "start.js")
    assert.equal(payload.app.autolaunch_startup, "")
    assert.equal(payload.app.autolaunch_enabled, false)
    assert.equal(env.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(env[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "false")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch route rejects script save without explicit startup enabled state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      ""
    ].join("\n"), "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch"](
        { body: { app: "target", script: "start.js" } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /enabled/i)
    assert.equal(env.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(env[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "false")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch route rejects clearing launch script while requirements exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch"](
        { body: { app: "target", clear_script: true } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /Remove requirements before clearing/)
    assert.equal(env.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(env[Environment.SCRIPT_REQUIREMENTS_KEY], "helper")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch route rejects empty script without explicit clear action", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      ""
    ].join("\n"), "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch"](
        { body: { app: "target", script: "", enabled: false } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /clear_script/i)
    assert.equal(env.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(env[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "false")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("home startup display graph skips cancelled startup roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const targetRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(targetRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=true",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      ""
    ].join("\n"), "utf8")

    const kernel = {
      homedir: root,
      launch_complete: false,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      launchRequirements: {
        isCancelled: (appId) => appId === "target"
      },
      api: {
        userdir: apiRoot,
        listApps: async () => [
          { id: "target", title: "Target" },
          { id: "helper", title: "Helper" }
        ]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: { get: () => {}, post: () => {} }
    }
    const graph = await new ServerAutolaunch(server).buildHomeStartupDisplayGraph()

    assert.equal(graph.has("target"), false)
    assert.equal(graph.has("helper"), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch dependencies route rejects invalid dependency ids atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const targetRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    const existingRoot = path.resolve(apiRoot, "existing")
    const targetEnv = path.resolve(targetRoot, "ENVIRONMENT")
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.mkdir(existingRoot, { recursive: true })
    await fs.writeFile(path.resolve(targetRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(existingRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(targetEnv, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=existing",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")
    await fs.writeFile(path.resolve(existingRoot, "ENVIRONMENT"), "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [
          { id: "target", title: "Target" },
          { id: "helper", title: "Helper" },
          { id: "existing", title: "Existing" }
        ]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch/dependencies"](
        { body: { app: "target", dependencies: ["helper", "missing"] } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(targetEnv)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /missing|invalid|installed/i)
    assert.equal(env[Environment.SCRIPT_REQUIREMENTS_KEY], "existing")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch route clears launch script when requirements are empty", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=",
      ""
    ].join("\n"), "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch"](
        { body: { app: "target", clear_script: true } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.app.autolaunch, "")
    assert.equal(payload.app.autolaunch_enabled, false)
    assert.equal(env.PINOKIO_SCRIPT_AUTOLAUNCH, "")
    assert.equal(env[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "")
    assert.equal(env[Environment.SCRIPT_REQUIREMENTS_KEY], "")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("disable all startup launch preserves configured scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const targetRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    const targetEnv = path.resolve(targetRoot, "ENVIRONMENT")
    const helperEnv = path.resolve(helperRoot, "ENVIRONMENT")
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(targetRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(targetEnv, "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")
    await fs.writeFile(helperEnv, [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      ""
    ].join("\n"), "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch/disable-all"](
        {},
        {
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const target = await Util.parse_env(targetEnv)
    const helper = await Util.parse_env(helperEnv)
    assert.equal(payload.ok, true)
    assert.equal(payload.disabled, 1)
    assert.equal(target.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(target[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "false")
    assert.equal(helper.PINOKIO_SCRIPT_AUTOLAUNCH, "start.js")
    assert.equal(helper[Environment.SCRIPT_AUTOLAUNCH_ENABLED_KEY], "false")
    const targetState = payload.apps.find((app) => app.id === "target")
    assert.equal(targetState.autolaunch, "start.js")
    assert.equal(targetState.autolaunch_enabled, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch dependencies route rejects requirements without owning launch script", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, "PINOKIO_SCRIPT_AUTOLAUNCH=\n", "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch/dependencies"](
        { body: { app: "target", dependencies: ["helper"] } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /Choose this app's launch script/)
    assert.equal(env[Environment.SCRIPT_REQUIREMENTS_KEY], undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch dependencies route rejects requirements whose app has no launch script", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), "PINOKIO_SCRIPT_AUTOLAUNCH=\n", "utf8")

    const routes = {}
    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: (route, handler) => {
          routes[route] = handler
        }
      }
    }
    new ServerAutolaunch(server).registerRoutes()

    let statusCode = 200
    let payload = null
    await new Promise((resolve, reject) => {
      routes["/autolaunch/dependencies"](
        { body: { app: "target", dependencies: ["helper"] } },
        {
          status(code) {
            statusCode = code
            return this
          },
          json(body) {
            payload = body
            resolve()
          }
        },
        (error) => {
          if (error) reject(error)
        }
      )
    })

    const env = await Util.parse_env(envPath)
    assert.equal(statusCode, 400)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /Choose Helper's launch script/)
    assert.equal(env[Environment.SCRIPT_REQUIREMENTS_KEY], undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("autolaunch candidate state does not migrate startup script to a second launch key", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const appRoot = path.resolve(apiRoot, "target")
    const envPath = path.resolve(appRoot, "ENVIRONMENT")
    await fs.mkdir(appRoot, { recursive: true })
    await fs.writeFile(path.resolve(appRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(envPath, "PINOKIO_SCRIPT_AUTOLAUNCH=start.js\n", "utf8")

    const kernel = {
      homedir: root,
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }]
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: () => {}
      }
    }
    const autolaunch = new ServerAutolaunch(server)
    const state = await autolaunch.buildAppState({ id: "target", title: "Target" })
    const env = await Util.parse_env(envPath)

    assert.equal(state.autolaunch, "start.js")
    assert.equal(state.autolaunch_startup, "start.js")
    assert.equal(state.autolaunch_enabled, true)
    const forbiddenKey = "PINOKIO" + "_SCRIPT" + "_LAUNCH"
    assert.equal(Object.prototype.hasOwnProperty.call(env, forbiddenKey), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("home startup state renders configured requirement waiting before runtime status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const targetRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(targetRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(targetRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      ""
    ].join("\n"), "utf8")

    const kernel = {
      homedir: root,
      launch_complete: false,
      autolaunch_status: { running: true, apps: {} },
      exists: pathExists,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }],
        launcher: async (id) => ({ script: { title: id === "helper" ? "Helper" : "Target" } })
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: () => {}
      }
    }
    const autolaunch = new ServerAutolaunch(server)
    const item = {
      name: "Target",
      uri: "target",
      filepath: targetRoot,
      path: "target"
    }

    const applied = await autolaunch.applyHomeStartingState(item, 0)

    assert.equal(applied, true)
    assert.equal(item.running, true)
    assert.equal(item.autolaunch_starting, true)
    assert.equal(item.autolaunch_waiting, true)
    assert.equal(item.autolaunch_script, "start.js")
    assert.equal(item.autolaunch_status_label, "Waiting for Helper")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("home startup state renders recursive requirement-only rows before runtime status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const rootAppRoot = path.resolve(apiRoot, "root-app")
    const middleAppRoot = path.resolve(apiRoot, "middle-app")
    const leafAppRoot = path.resolve(apiRoot, "leaf-app")
    await fs.mkdir(rootAppRoot, { recursive: true })
    await fs.mkdir(middleAppRoot, { recursive: true })
    await fs.mkdir(leafAppRoot, { recursive: true })
    await fs.writeFile(path.resolve(rootAppRoot, "root.custom.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(middleAppRoot, "middle.custom.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(leafAppRoot, "leaf.custom.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(rootAppRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=root.custom.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=true",
      "PINOKIO_SCRIPT_REQUIRES=middle-app",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(middleAppRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=middle.custom.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      "PINOKIO_SCRIPT_REQUIRES=leaf-app",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(leafAppRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=leaf.custom.js",
      "PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=false",
      ""
    ].join("\n"), "utf8")

    const titles = {
      "root-app": "Root App",
      "middle-app": "Middle App",
      "leaf-app": "Leaf App"
    }
    const kernel = {
      homedir: root,
      launch_complete: false,
      autolaunch_status: { running: true, apps: {} },
      exists: pathExists,
      getScriptProgress: () => null,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [
          { id: "root-app", title: titles["root-app"] },
          { id: "middle-app", title: titles["middle-app"] },
          { id: "leaf-app", title: titles["leaf-app"] }
        ],
        launcher: async (id) => ({ script: { title: titles[id] || id } })
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: () => {}
      }
    }
    const autolaunch = new ServerAutolaunch(server)
    const items = [
      { name: "Root App", uri: "root-app", filepath: rootAppRoot, path: "root-app" },
      { name: "Middle App", uri: "middle-app", filepath: middleAppRoot, path: "middle-app" },
      { name: "Leaf App", uri: "leaf-app", filepath: leafAppRoot, path: "leaf-app" }
    ]

    const applied = []
    for (const [index, item] of items.entries()) {
      applied.push(await autolaunch.applyHomeStartingState(item, index))
    }

    assert.deepEqual(applied, [true, true, true])
    assert.equal(items[0].autolaunch_status_label, "Waiting for Middle App")
    assert.equal(items[1].autolaunch_status_label, "Waiting for Leaf App")
    assert.equal(items[2].autolaunch_status_label, "Starting leaf.custom.js")
    assert.equal(items[0].autolaunch_script, "root.custom.js")
    assert.equal(items[1].autolaunch_script, "middle.custom.js")
    assert.equal(items[2].autolaunch_script, "leaf.custom.js")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("home startup state renders requirement-only startup rows from runtime status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const helperRoot = path.resolve(apiRoot, "helper")
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      ""
    ].join("\n"), "utf8")

    const launchPath = path.resolve(helperRoot, "start.js")
    const kernel = {
      homedir: root,
      launch_complete: false,
      autolaunch_status: {
        running: true,
        apps: {
          helper: {
            id: "helper",
            title: "Helper",
            script: "start.js",
            launch_path: launchPath,
            state: "pending",
            dependencies: [],
            waiting_for: [],
            startup_root: false
          }
        }
      },
      exists: pathExists,
      getScriptProgress: () => null,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "helper", title: "Helper" }],
        launcher: async () => ({ script: { title: "Helper" } })
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: () => {}
      }
    }
    const autolaunch = new ServerAutolaunch(server)
    const item = {
      name: "helper",
      uri: "helper",
      filepath: helperRoot,
      path: "helper"
    }

    const applied = await autolaunch.applyHomeStartingState(item, 0)

    assert.equal(applied, true)
    assert.equal(item.running, true)
    assert.equal(item.autolaunch_starting, true)
    assert.equal(item.autolaunch_script, "start.js")
    assert.equal(item.autolaunch_status_label, "Starting start.js")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("home startup state renders active runtime status after launch_complete flips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinokio-server-autolaunch-"))
  try {
    const apiRoot = path.resolve(root, "api")
    const targetRoot = path.resolve(apiRoot, "target")
    const helperRoot = path.resolve(apiRoot, "helper")
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(helperRoot, { recursive: true })
    await fs.writeFile(path.resolve(targetRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(helperRoot, "start.js"), "module.exports = { run: [] }\n", "utf8")
    await fs.writeFile(path.resolve(targetRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      "PINOKIO_SCRIPT_REQUIRES=helper",
      ""
    ].join("\n"), "utf8")
    await fs.writeFile(path.resolve(helperRoot, "ENVIRONMENT"), [
      "PINOKIO_SCRIPT_AUTOLAUNCH=start.js",
      ""
    ].join("\n"), "utf8")

    const kernel = {
      homedir: root,
      launch_complete: true,
      autolaunch_status: {
        running: false,
        apps: {
          target: {
            id: "target",
            title: "Target",
            script: "start.js",
            launch_path: path.resolve(targetRoot, "start.js"),
            state: "waiting",
            dependencies: ["helper"],
            waiting_for: ["helper"],
            startup_root: true
          },
          helper: {
            id: "helper",
            title: "Helper",
            script: "start.js",
            launch_path: path.resolve(helperRoot, "start.js"),
            state: "starting",
            dependencies: [],
            waiting_for: [],
            startup_root: false
          }
        }
      },
      exists: pathExists,
      getScriptProgress: () => null,
      path: (name, ...chunks) => path.resolve(root, name, ...chunks),
      api: {
        userdir: apiRoot,
        listApps: async () => [{ id: "target", title: "Target" }, { id: "helper", title: "Helper" }],
        launcher: async (id) => ({ script: { title: id === "helper" ? "Helper" : "Target" } })
      }
    }
    const server = {
      kernel,
      exists: pathExists,
      is_subpath: isSubpath,
      app: {
        get: () => {},
        post: () => {}
      }
    }
    const autolaunch = new ServerAutolaunch(server)
    const item = {
      name: "target",
      uri: "target",
      filepath: targetRoot,
      path: "target"
    }

    const applied = await autolaunch.applyHomeStartingState(item, 0)

    assert.equal(applied, true)
    assert.equal(item.running, true)
    assert.equal(item.autolaunch_waiting, true)
    assert.equal(item.autolaunch_status_label, "Waiting for Helper")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
