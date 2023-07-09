class Browser {
  async open(req, ondata, kernel) {
    ondata(req.params, "browser.open")
  }
  async close(req, ondata, kernel) {
    ondata(req.params, "browser.close")
  }
}
module.exports = Browser
