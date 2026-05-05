const { createNoteService } = require("./service")
const registerNoteRoutes = require("./routes")
const NoteWatcher = require("./watcher")

function createNoteFeature(options = {}) {
  const { app, kernel } = options
  if (!app) {
    throw new Error("app is required")
  }
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const service = createNoteService({
    kernel,
    taskWorkspaceLinks: options.taskWorkspaceLinks
  })

  registerNoteRoutes(app, {
    ...options,
    notes: service
  })

  if (kernel.watch && typeof kernel.watch.registerHandler === "function") {
    kernel.watch.registerHandler("note", new NoteWatcher({ notes: service }))
  }

  return {
    service,
    async start() {
      await service.start()
    },
    async stop() {
      await service.stop()
    }
  }
}

module.exports = {
  createNoteFeature
}
