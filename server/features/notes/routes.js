const express = require("express")
const path = require("path")
const registerDraftImportRoutes = require("./registry_import")

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function parsePublishConfig(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (_) {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }
  const target = String(parsed.target || "").trim().toLowerCase()
  const type = String(parsed.type || "post").trim().toLowerCase()
  if (target !== "registry" || type !== "post") {
    return null
  }
  const publish = { target: "registry", type: "post" }
  const parent = parsed.parent && typeof parsed.parent === "object" && !Array.isArray(parsed.parent)
    ? parsed.parent
    : null
  const parentType = parent ? String(parent.type || "").trim().toLowerCase() : ""
  const parentUrl = parent ? String(parent.url || parent.repoUrl || "").trim() : ""
  if (parentType === "app" && parentUrl) {
    publish.parent = { type: "app", url: parentUrl }
  }
  return publish
}

function registerNoteRoutes(app, options = {}) {
  const notes = options.notes
  if (!notes) {
    throw new Error("notes is required")
  }
  const kernel = options.kernel

  const router = express.Router()
  router.get("/notes", asyncHandler(async (req, res) => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : ""
    if (cwd && typeof notes.inspectWorkspace === "function") {
      const resolvedCwd = path.resolve(cwd)
      const home = kernel && kernel.homedir ? path.resolve(kernel.homedir) : ""
      if (!home || isInside(resolvedCwd, home)) {
        const publish = parsePublishConfig(req.query.publish)
        const note = publish ? { publish } : undefined
        await notes.inspectWorkspace({ cwd: resolvedCwd, note }).catch(() => null)
      }
    }
    const items = await notes.listPending({ cwd })
    res.json({
      ok: true,
      items
    })
  }))

  router.get("/notes/:id/media/:index", asyncHandler(async (req, res) => {
    const item = typeof notes.getPendingById === "function"
      ? await notes.getPendingById(req.params.id)
      : null
    if (!item) {
      res.status(404).send("Note not found")
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
      res.status(403).send("Media path is outside the note")
      return
    }
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(filePath)
  }))

  router.put("/notes/:id", express.text({ type: "*/*", limit: "6mb" }), asyncHandler(async (req, res) => {
    if (typeof notes.savePendingById !== "function") {
      res.status(501).json({ ok: false, error: "Note editing is unavailable." })
      return
    }
    const markdown = typeof req.body === "string"
      ? req.body
      : (req.body && typeof req.body.markdown === "string"
      ? req.body.markdown
      : null)
    if (markdown === null) {
      res.status(400).json({ ok: false, error: "markdown is required" })
      return
    }
    const revision = typeof req.get("x-pinokio-note-revision") === "string"
      ? req.get("x-pinokio-note-revision")
      : (req.body && typeof req.body.revision === "string"
      ? req.body.revision
      : "")
    try {
      const item = await notes.savePendingById(req.params.id, { markdown, revision })
      if (!item) {
        res.status(404).json({ ok: false, error: "Note not found" })
        return
      }
      res.json({ ok: true, item })
    } catch (error) {
      if (error && error.code === "NOTE_CONFLICT") {
        res.status(409).json({
          ok: false,
          error: error.message,
          item: error.item || null
        })
        return
      }
      if (error && (error.code === "NOTE_TOO_LARGE" || error.code === "NOTE_INVALID_PATH")) {
        res.status(400).json({ ok: false, error: error.message })
        return
      }
      throw error
    }
  }))

  router.get("/notes.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(path.resolve(__dirname, "public", "notes.js"))
  })

  router.get("/notes.css", (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.sendFile(path.resolve(__dirname, "public", "notes.css"))
  })

  app.use(router)
  registerDraftImportRoutes(app, options)
}

module.exports = registerNoteRoutes
