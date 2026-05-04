const path = require("path")
const WatchContext = require("./context")

class WatchManager {
  constructor(kernel) {
    this.kernel = kernel
    this.handlers = new Map()
    this.sessions = new Map()
  }

  registerHandler(name, handler) {
    const normalized = typeof name === "string" ? name.trim() : ""
    if (!normalized) {
      throw new Error("watch handler name is required")
    }
    this.handlers.set(normalized, handler)
  }

  hasHandler(script, handlerName) {
    const watches = script && Array.isArray(script.watch) ? script.watch : []
    return watches.some((watch) => {
      const resolved = this.resolveHandlerMethod(watch)
      return resolved.handlerName === handlerName
    })
  }

  resolveHandlerMethod(declaration) {
    if (!declaration || typeof declaration !== "object") {
      return { handlerName: "", methodName: "" }
    }
    const method = typeof declaration.method === "string" ? declaration.method.trim() : ""
    if (declaration.handler) {
      return {
        handlerName: String(declaration.handler).trim(),
        methodName: method
      }
    }
    if (!declaration.uri && method.includes(".")) {
      const parts = method.split(".")
      return {
        handlerName: parts.slice(0, -1).join(".").trim(),
        methodName: parts[parts.length - 1].trim()
      }
    }
    return {
      handlerName: "",
      methodName: method
    }
  }

  renderDeclaration(raw, memory) {
    let rendered = raw
    let pass = 0
    while (true) {
      rendered = this.kernel.template.render(rendered, memory)
      if (this.kernel.template.istemplate(rendered)) {
        pass += 1
        if (pass >= 4) break
      } else {
        break
      }
    }
    return this.kernel.template.flatten(rendered)
  }

  buildMemory({ request, script, cwd, dirname, input, args }) {
    return {
      script: this.kernel.script,
      input,
      args,
      cwd,
      dirname,
      uri: request.uri,
      self: script,
      kernel: this.kernel,
      ...this.kernel.vars
    }
  }

  async resolveExternalHandler(ctx, uri) {
    const modpath = ctx.resolveModule(uri)
    const loaded = await this.kernel.loader.load(modpath)
    let handler = loaded && loaded.resolved
    if (typeof handler === "function") {
      handler = new handler()
    }
    return handler
  }

  async startForScript(options = {}) {
    const script = options.script
    const declarations = script && Array.isArray(script.watch) ? script.watch : []
    if (declarations.length === 0) {
      return
    }

    const id = options.id
    if (!id) {
      return
    }
    await this.stop(id)

    const input = options.input || {}
    const args = options.args || input
    const cwd = path.resolve(options.cwd)
    const dirname = path.resolve(options.dirname || options.cwd)
    const memory = this.buildMemory({
      request: options.request || {},
      script,
      cwd,
      dirname,
      input,
      args
    })
    const disposers = []

    for (const rawDeclaration of declarations) {
      if (!rawDeclaration || typeof rawDeclaration !== "object") {
        continue
      }
      try {
        const declaration = this.renderDeclaration(rawDeclaration, memory)
        const ctx = new WatchContext({
          kernel: this.kernel,
          manager: this,
          id,
          cwd,
          dirname,
          request: options.request,
          script,
          declaration,
          input,
          args
        })
        const { handlerName, methodName } = this.resolveHandlerMethod(declaration)
        let handler = null
        if (handlerName) {
          handler = this.handlers.get(handlerName)
        } else if (declaration.uri) {
          handler = await this.resolveExternalHandler(ctx, declaration.uri)
        }
        if (!handler || !methodName || typeof handler[methodName] !== "function") {
          console.warn("[watch] handler not found", declaration)
          continue
        }
        const cleanup = await handler[methodName](ctx, declaration.params || {})
        if (cleanup) {
          disposers.push(cleanup)
        }
      } catch (error) {
        console.warn("[watch] failed to start", error && error.message ? error.message : error)
      }
    }

    if (disposers.length > 0) {
      this.sessions.set(id, disposers)
    }
  }

  async stop(id) {
    const normalized = typeof id === "string" ? id : ""
    if (!normalized || !this.sessions.has(normalized)) {
      return
    }
    const disposers = this.sessions.get(normalized) || []
    this.sessions.delete(normalized)
    for (const disposer of disposers.reverse()) {
      try {
        if (typeof disposer === "function") {
          await disposer()
        } else if (disposer && typeof disposer.stop === "function") {
          await disposer.stop()
        } else if (disposer && typeof disposer.dispose === "function") {
          await disposer.dispose()
        } else if (disposer && typeof disposer.unsubscribe === "function") {
          await disposer.unsubscribe()
        }
      } catch (error) {
        console.warn("[watch] cleanup failed", error && error.message ? error.message : error)
      }
    }
  }
}

module.exports = WatchManager
