/*
  {
    method: "tab.open",
    params: {
      target:
      url
    }
  }
(*/
class Tab {
  async open(req, ondata, kernel) {
    ondata(req.params, "tab.open")
  }
}
module.exports = Tab
