const { createDraftService } = require("./service")
const registerDraftRoutes = require("./routes")
const DraftWatcher = require("./watcher")

function createDraftFeature(options = {}) {
  const { app, kernel } = options
  if (!app) {
    throw new Error("app is required")
  }
  if (!kernel) {
    throw new Error("kernel is required")
  }

  const service = createDraftService({
    kernel,
    taskWorkspaceLinks: options.taskWorkspaceLinks
  })

  registerDraftRoutes(app, {
    ...options,
    drafts: service
  })

  if (kernel.watch && typeof kernel.watch.registerHandler === "function") {
    kernel.watch.registerHandler("draft", new DraftWatcher({ drafts: service }))
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
  createDraftFeature
}
