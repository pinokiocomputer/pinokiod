const express = require("express")

function registerWorkspacesRoutes(app, options = {}) {
  const {
    workspaceCatalog,
    composePeerAccessPayload,
    getTheme,
    getPeers,
    getCurrentHost,
    getPortal,
  } = options

  if (!workspaceCatalog) {
    throw new Error("workspaceCatalog is required")
  }

  const router = express.Router()

  router.get("/workspaces", async (req, res, next) => {
    try {
      const catalog = await workspaceCatalog.list({ sort: req.query.sort })
      res.render("workspaces", {
        title: "Workspaces",
        sidebarSelected: "workspaces",
        workspaceCatalog: catalog,
        theme: getTheme ? getTheme(req) : null,
        peers: getPeers ? getPeers() : [],
        currentHost: getCurrentHost ? getCurrentHost(req) : null,
        portal: getPortal ? getPortal(req) : null,
        peerAccess: composePeerAccessPayload ? composePeerAccessPayload(req) : null,
      })
    } catch (err) {
      next(err)
    }
  })

  router.get("/activity", (req, res) => {
    res.redirect("/workspaces")
  })

  app.use(router)
}

module.exports = registerWorkspacesRoutes
