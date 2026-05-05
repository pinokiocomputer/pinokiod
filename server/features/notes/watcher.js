const path = require("path")

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

class NoteWatcher {
  constructor(options = {}) {
    this.notes = options.notes
  }

  async watch(ctx, params = {}) {
    if (!this.notes || typeof this.notes.inspectWorkspace !== "function") {
      throw new Error("note service is unavailable")
    }

    const noteDir = ctx.resolve(params.path || ".pinokio/notes")
    const noteConfig = {
      path: params.path || ".pinokio/notes",
      description: params.description,
      publish: params.publish
    }
    let timer = null
    let disposed = false

    const inspect = async () => {
      if (disposed) return
      await this.notes.inspectWorkspace({ cwd: ctx.cwd, note: noteConfig })
    }

    const scheduleInspect = () => {
      if (disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        inspect().catch((error) => {
          console.warn("[notes] failed to inspect workspace", error && error.message ? error.message : error)
        })
      }, 250)
    }

    await inspect()
    const stopPoll = ctx.poll(params.interval || 1500, inspect, {
      immediate: false,
      onError: (error) => {
        console.warn("[notes] poll failed", error && error.message ? error.message : error)
      }
    })
    const unsubscribe = await ctx.watch.fs(ctx.cwd, (events) => {
      if (!Array.isArray(events)) return
      if (events.some((event) => event && event.path && isInside(path.resolve(event.path), noteDir))) {
        scheduleInspect()
      }
    })

    return async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await this.notes.inspectWorkspace({ cwd: ctx.cwd, note: noteConfig }).catch(() => {})
      disposed = true
      if (typeof stopPoll === "function") {
        await stopPoll()
      }
      if (typeof unsubscribe === "function") {
        await unsubscribe()
      }
    }
  }
}

module.exports = NoteWatcher
