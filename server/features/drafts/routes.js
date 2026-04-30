const express = require("express")
const path = require("path")
const registerDraftImportRoutes = require("./registry_import")

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

function registerDraftRoutes(app, options = {}) {
  const drafts = options.drafts
  if (!drafts) {
    throw new Error("drafts is required")
  }

  const router = express.Router()
  router.get("/drafts", asyncHandler(async (req, res) => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : ""
    const items = await drafts.listPending({ cwd })
    res.json({
      ok: true,
      items
    })
  }))

  router.post("/drafts/:id/dismiss", asyncHandler(async (req, res) => {
    const ok = await drafts.dismiss(req.params.id, req.body && req.body.revision)
    res.json({ ok })
  }))

  router.get("/drafts/:id/media/:index", asyncHandler(async (req, res) => {
    const item = typeof drafts.getPendingById === "function"
      ? await drafts.getPendingById(req.params.id)
      : null
    if (!item) {
      res.status(404).send("Draft not found")
      return
    }
    const index = Number(req.params.index)
    const media = Array.isArray(item.media) && Number.isInteger(index)
      ? item.media[index]
      : null
    if (!media || !media.exists || !media.path) {
      res.status(404).send("Media not found")
      return
    }
    const filePath = path.resolve(media.path)
    const basePath = path.resolve(item.resultDir)
    const relative = path.relative(basePath, filePath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      res.status(403).send("Media path is outside the draft")
      return
    }
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(filePath)
  }))

  router.get("/drafts.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(path.resolve(__dirname, "public", "drafts.js"))
  })

  app.use(router)
  registerDraftImportRoutes(app, options)
}

module.exports = registerDraftRoutes
