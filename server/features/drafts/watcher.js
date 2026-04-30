const path = require("path")

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

class DraftWatcher {
  constructor(options = {}) {
    this.drafts = options.drafts
  }

  async ready(ctx, params = {}) {
    if (!this.drafts || typeof this.drafts.inspectWorkspace !== "function") {
      throw new Error("draft service is unavailable")
    }

    const draftDir = ctx.resolve(params.path || ".pinokio/draft")
    const draftConfig = {
      path: params.path || ".pinokio/draft",
      content: params.content,
      ready: params.ready,
      description: params.description,
      publish: params.publish
    }
    let timer = null
    let disposed = false

    const inspect = async () => {
      if (disposed) return
      await this.drafts.inspectWorkspace({ cwd: ctx.cwd, draft: draftConfig })
    }

    const scheduleInspect = () => {
      if (disposed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        inspect().catch((error) => {
          console.warn("[drafts] failed to inspect workspace", error && error.message ? error.message : error)
        })
      }, 250)
    }

    await inspect()
    const stopPoll = ctx.poll(params.interval || 1500, inspect, {
      immediate: false,
      onError: (error) => {
        console.warn("[drafts] poll failed", error && error.message ? error.message : error)
      }
    })
    const unsubscribe = await ctx.watch.fs(ctx.cwd, (events) => {
      if (!Array.isArray(events)) return
      if (events.some((event) => event && event.path && isInside(path.resolve(event.path), draftDir))) {
        scheduleInspect()
      }
    })

    return async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await this.drafts.inspectWorkspace({ cwd: ctx.cwd, draft: draftConfig }).catch(() => {})
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

module.exports = DraftWatcher
