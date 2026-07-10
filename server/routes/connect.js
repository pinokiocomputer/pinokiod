const CONNECT_STATUS_TIMEOUT_MS = 3000

const CONNECT_ITEMS = [{
  icon: "fa-brands fa-hugging-face",
  name: "huggingface",
  title: "huggingface.co",
  description: "Connect with huggingface.co",
  url: "/connect/huggingface"
}, {
  icon: "fa-brands fa-github",
  name: "github",
  title: "github.com",
  description: "Connect with GitHub.com",
  url: "/github"
}]

module.exports = function registerConnectRoutes(app, options = {}) {
  const getPageContext = options.getPageContext || (() => ({}))
  const getGithubConnection = options.getGithubConnection
  const getProviderConnection = options.getProviderConnection
  const statusTimeoutMs = Number.isFinite(options.statusTimeoutMs)
    ? options.statusTimeoutMs
    : CONNECT_STATUS_TIMEOUT_MS

  app.get("/connect", (req, res) => {
    res.render("connect", {
      ...getPageContext(req),
      items: CONNECT_ITEMS
    })
  })

  app.get("/connect/status/:provider", async (req, res) => {
    const provider = String(req.params.provider || "")
    let connected = false
    try {
      if (provider === "github" && typeof getGithubConnection === "function") {
        const connection = await getGithubConnection({ timeout: statusTimeoutMs })
        connected = Boolean(connection && connection.connected)
      } else if (provider === "huggingface" && typeof getProviderConnection === "function") {
        connected = await getProviderConnection(provider, { timeout: statusTimeoutMs })
      } else {
        res.status(404).json({ provider, error: "Unknown provider" })
        return
      }
    } catch (_) {}
    res.set("Cache-Control", "no-store")
    res.json({ provider, connected: Boolean(connected) })
  })
}
