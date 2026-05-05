const express = require("express")
const fs = require("fs")
const path = require("path")
const axios = require("axios")
const FormData = require("form-data")
const mime = require("mime-types")
const {
  describeMediaRefs,
  extractTitleAndBody,
  normalizeTitle
} = require("./parser")

const DEFAULT_MAX_FILES = 10
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")

function renderMessage(res, status, title, message) {
  res.status(status).send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #111827; }
    .box { max-width: 680px; border: 1px solid #d1d5db; border-radius: 8px; padding: 18px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0; color: #4b5563; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`)
}

function renderImportLauncher(res, { authorizeUrl, autoOpen }) {
  res.status(200).send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Import draft</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #111827; background: #f8fafc; }
    .box { max-width: 680px; border: 1px solid #d1d5db; border-radius: 8px; padding: 18px; background: white; box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 14px; color: #4b5563; line-height: 1.5; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; border: 1px solid #111827; border-radius: 6px; background: #111827; color: white; padding: 7px 12px; font-weight: 700; text-decoration: none; cursor: pointer; }
    .muted { color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Import draft</h1>
    <p id="status">${autoOpen ? "Opening the registry authorization page in your browser..." : "Click Open registry to authorize the import."}</p>
    <button id="open" type="button">Open registry</button>
    <div class="muted" style="margin-top:12px;">The registry will return to Pinokio after authorization.</div>
  </div>
  <script>
    window.__PINOKIO_DRAFT_IMPORT_VERSION = "metadata-b64";
    const authorizeUrl = ${JSON.stringify(authorizeUrl)};
    const autoOpen = ${JSON.stringify(Boolean(autoOpen))};
    const statusEl = document.getElementById("status");
    const openButton = document.getElementById("open");

    function setStatus(message) {
      statusEl.textContent = message;
    }

    async function openRegistry() {
      setStatus("Opening registry in your browser...");
      const response = await fetch("/pinokio/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: authorizeUrl,
          surface: "browser"
        })
      });
      if (!response.ok) {
        throw new Error("Unable to open registry.");
      }
      setStatus("Authorize the import in your browser.");
    }

    openButton.addEventListener("click", () => {
      openRegistry().catch((error) => {
        setStatus(error && error.message ? error.message : "Unable to open registry.");
      });
    });
    if (autoOpen) {
      window.setTimeout(() => {
        openRegistry().catch((error) => {
          setStatus(error && error.message ? error.message : "Unable to open registry.");
        });
      }, 100);
    }
  </script>
</body>
</html>`)
}

function normalizeRegistryBase(raw, fallback) {
  const value = String(raw || fallback || "").trim()
  if (!value) return ""
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch (_) {
    return ""
  }
}

function requestOrigin(req) {
  const host = req.get("host") || "localhost:42000"
  return `${req.protocol || "http"}://${host}`
}

function buildDraftImportReturnUrl(req, item, bundle) {
  const returnUrl = new URL("/registry/draft-import/callback", requestOrigin(req))
  returnUrl.searchParams.set("draft", item.id)
  if (bundle.appSlug) returnUrl.searchParams.set("app", bundle.appSlug)
  return returnUrl.toString()
}

function buildAuthorizeUrl(req, registryBase, item, bundle) {
  const authorizeUrl = new URL("/draft-import/authorize", registryBase)
  authorizeUrl.searchParams.set("handoff", "callback")
  authorizeUrl.searchParams.set("return", buildDraftImportReturnUrl(req, item, bundle))
  if (bundle.appSlug) authorizeUrl.searchParams.set("app", bundle.appSlug)
  return authorizeUrl
}

async function findNoteById(notes, id) {
  const normalized = String(id || "").trim()
  if (!normalized) return null
  const items = await notes.listPending({})
  return (items || []).find((item) => item && item.id === normalized) || null
}

function isRegistryPostPublish(publish) {
  if (!publish || typeof publish !== "object") return false
  const target = String(publish.target || "").trim().toLowerCase()
  const type = String(publish.type || "post").trim().toLowerCase()
  return target === "registry" && type === "post"
}

function normalizeParent(parent) {
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null
  const type = String(parent.type || "").trim().toLowerCase()
  const url = String(parent.url || parent.repoUrl || "").trim()
  if (type !== "app" || !url) return null
  return { type: "app", url }
}

async function buildDraftBundle(item, query = {}) {
  const markdown = await fs.promises.readFile(item.notePath, "utf8")
  const resultDir = path.dirname(item.notePath)
  const titleFallback = item.title || (item.workspaceName ? `Note for ${item.workspaceName}` : "Note")
  const extracted = extractTitleAndBody(markdown, titleFallback)
  const metadataTitle = item.metadata && typeof item.metadata.title === "string"
    ? normalizeTitle(item.metadata.title)
    : ""
  const title = metadataTitle || extracted.title
  const body = metadataTitle && extracted.title && normalizeTitle(extracted.title) === metadataTitle
    ? extracted.body
    : (!metadataTitle ? extracted.body : String(markdown || "").trim())
  const publish = item.publish && typeof item.publish === "object" ? item.publish : null
  const media = await describeMediaRefs(markdown, resultDir, { mediaOnly: false })
  return {
    title,
    body,
    publish,
    parent: normalizeParent(publish && publish.parent),
    appSlug: String(query.app || "").trim(),
    media
  }
}

function preflightBundle(bundle, options = {}) {
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES)
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES)
  if (!bundle.title) {
    return "Note title is missing."
  }
  if (!isRegistryPostPublish(bundle.publish)) {
    return "This note is not configured for registry publishing."
  }
  if (bundle.media.length > maxFiles) {
    return `Note has ${bundle.media.length} media files. The registry limit is ${maxFiles}.`
  }
  const missing = bundle.media.filter((item) => !item.exists)
  if (missing.length > 0) {
    return `Note references missing media: ${missing.map((item) => item.ref).join(", ")}`
  }
  const oversized = bundle.media.find((item) => item.bytes > maxFileBytes)
  if (oversized) {
    return `Media file is too large: ${oversized.ref}. The per-file limit is ${Math.round(maxFileBytes / 1024 / 1024)} MB.`
  }
  return ""
}

async function uploadBundle(registryBase, token, bundle) {
  const form = new FormData()
  const metadata = JSON.stringify({
    title: bundle.title,
    body: bundle.body,
    app: bundle.appSlug || "",
    parent: bundle.parent || null,
    media: bundle.media.map((item) => ({ path: item.ref }))
  })
  form.append("metadata_b64", Buffer.from(metadata, "utf8").toString("base64"))
  for (const item of bundle.media) {
    form.append("files", fs.createReadStream(item.path), {
      filename: path.basename(item.ref),
      contentType: mime.lookup(item.path) || "application/octet-stream",
      knownLength: item.bytes
    })
  }
  const endpoint = `${registryBase}/registry-bridge/draft-imports`
  const headers = {
    Authorization: `Bearer ${token}`,
    ...form.getHeaders()
  }
  const contentLength = await new Promise((resolve) => {
    form.getLength((error, length) => resolve(error ? null : length))
  })
  if (Number.isFinite(contentLength)) {
    headers["Content-Length"] = contentLength
  }
  console.log("[draft-import] request", {
    endpoint,
    media: bundle.media.length,
    contentLength: Number.isFinite(contentLength) ? contentLength : null
  })
  const response = await axios.post(endpoint, form, {
    timeout: 180000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
    headers
  })
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(
      response.data && response.data.error
        ? String(response.data.error)
        : `Registry upload failed with status ${response.status}.`
    )
    error.status = response.status
    error.registryEndpoint = endpoint
    error.responseData = response.data
    throw error
  }
  return response.data || {}
}

async function uploadDraftFromRequest(notes, query, token, registryBase, options = {}) {
  const item = await findNoteById(notes, query.draft)
  if (!item) {
    const error = new Error("The local note is no longer available.")
    error.status = 404
    throw error
  }
  const bundle = await buildDraftBundle(item, query)
  const problem = preflightBundle(bundle, options)
  if (problem) {
    const error = new Error(problem)
    error.status = 400
    throw error
  }
  return uploadBundle(registryBase, token, bundle)
}

function registerDraftImportRoutes(app, options = {}) {
  const notes = options.notes
  if (!notes) {
    throw new Error("notes is required")
  }
  const defaultRegistryUrl = options.defaultRegistryUrl || "https://beta.pinokio.co"
  const router = express.Router()

  router.get("/registry/draft-import/authorize-url", asyncHandler(async (req, res) => {
    const item = await findNoteById(notes, req.query.draft)
    if (!item) {
      return res.status(404).json({ error: "The local note is no longer available." })
    }
    const bundle = await buildDraftBundle(item, req.query)
    const problem = preflightBundle(bundle, options)
    if (problem) {
      return res.status(400).json({ error: problem })
    }
    const registryBase = normalizeRegistryBase(req.query.registry, defaultRegistryUrl)
    if (!registryBase) {
      return res.status(400).json({ error: "The registry URL is invalid." })
    }
    const authorizeUrl = buildAuthorizeUrl(req, registryBase, item, bundle)
    res.setHeader("Cache-Control", "no-store")
    return res.json({
      draftId: item.id,
      authorizeUrl: authorizeUrl.toString()
    })
  }))

  router.get("/registry/draft-import/start", asyncHandler(async (req, res) => {
    const item = await findNoteById(notes, req.query.draft)
    if (!item) {
      return renderMessage(res, 404, "Note not found", "The local note is no longer available.")
    }
    const bundle = await buildDraftBundle(item, req.query)
    const problem = preflightBundle(bundle, options)
    if (problem) {
      return renderMessage(res, 400, "Note is not ready", problem)
    }
    const registryBase = normalizeRegistryBase(req.query.registry, defaultRegistryUrl)
    if (!registryBase) {
      return renderMessage(res, 400, "Registry unavailable", "The registry URL is invalid.")
    }
    const authorizeUrl = buildAuthorizeUrl(req, registryBase, item, bundle)
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none")
    return renderImportLauncher(res, {
      authorizeUrl: authorizeUrl.toString(),
      autoOpen: req.query.auto === "1"
    })
  }))

  router.post("/registry/draft-import/complete", asyncHandler(async (req, res) => {
    const token = String(req.body && req.body.token || "").trim()
    if (!token) {
      return res.status(400).json({ error: "Missing registry token." })
    }
    const registryBase = normalizeRegistryBase(req.body && req.body.registry, defaultRegistryUrl)
    if (!registryBase) {
      return res.status(400).json({ error: "The registry URL is invalid." })
    }
    try {
      console.log("[draft-import] uploading", {
        draft: req.body && req.body.draft,
        registry: registryBase,
        app: req.body && req.body.app ? String(req.body.app) : ""
      })
      const result = await uploadDraftFromRequest(
        notes,
        { draft: req.body && req.body.draft, app: req.body && req.body.app },
        token,
        registryBase,
        options
      )
      if (result && result.editUrl) {
        return res.json({ ok: true, editUrl: String(result.editUrl) })
      }
      return res.json({ ok: true, editUrl: registryBase })
    } catch (error) {
      const response = error && error.response
      const status = response && response.status ? response.status : (error && error.status ? error.status : 500)
      const endpoint = error && error.registryEndpoint ? error.registryEndpoint : `${registryBase}/registry-bridge/draft-imports`
      const responseData = response && response.data ? response.data : (error && error.responseData ? error.responseData : null)
      console.warn("[draft-import] upload failed", {
        status,
        endpoint,
        error: error && error.message ? error.message : "Upload failed.",
        response: typeof responseData === "string" ? responseData.slice(0, 500) : responseData
      })
      const message = response && response.data && response.data.error
        ? response.data.error
        : (error && error.message ? error.message : "Upload failed.")
      return res.status(status).json({ error: message, status, endpoint })
    }
  }))

  router.get("/registry/draft-import/callback", asyncHandler(async (req, res) => {
    const token = String(req.query.token || "").trim()
    if (!token) {
      return renderMessage(res, 400, "Missing token", "The registry did not return an import token.")
    }
    const registryBase = normalizeRegistryBase(req.query.registry, defaultRegistryUrl)
    if (!registryBase) {
      return renderMessage(res, 400, "Registry unavailable", "The registry URL is invalid.")
    }
    try {
      const result = await uploadDraftFromRequest(notes, req.query, token, registryBase, options)
      if (result && result.editUrl) {
        return res.redirect(String(result.editUrl))
      }
      return renderMessage(res, 200, "Draft imported", "The registry accepted the draft.")
    } catch (error) {
      const response = error && error.response
      const message = response && response.data && response.data.error
        ? response.data.error
        : (error && error.message ? error.message : "Upload failed.")
      return renderMessage(res, response && response.status ? response.status : 500, "Import failed", message)
    }
  }))

  app.use(router)
}

module.exports = registerDraftImportRoutes
