const path = require("path")
const { watchFs } = require("./drivers/fs")
const { poll } = require("./drivers/poll")

class WatchContext {
  constructor(options = {}) {
    this.kernel = options.kernel
    this.manager = options.manager
    this.id = options.id
    this.cwd = path.resolve(options.cwd)
    this.dirname = path.resolve(options.dirname || options.cwd)
    this.request = options.request
    this.script = options.script
    this.declaration = options.declaration
    this.input = options.input || {}
    this.args = options.args || this.input
    this.watch = {
      fs: (targetPath, callback, watchOptions = {}) => {
        return watchFs(this.resolve(targetPath), callback, {
          ...watchOptions,
          onError: watchOptions.onError || ((error) => {
            console.warn("[watch.fs]", error && error.message ? error.message : error)
          })
        })
      }
    }
  }

  resolve(targetPath) {
    return this.kernel.api.resolvePath(this.cwd, String(targetPath || "."))
  }

  resolveModule(targetPath) {
    return this.kernel.api.resolvePath(this.dirname, String(targetPath || "."))
  }

  poll(interval, callback, options = {}) {
    return poll(interval, callback, options)
  }
}

module.exports = WatchContext
