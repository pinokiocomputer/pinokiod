class Loading {
  async start (req, ondata, kernel) {
    ondata(req.params, "loading.start")
    let response = await kernel.api.wait(req.parent.path)
    console.log("loading.start response", response)
    return response
  }
  async end (req, ondata, kernel) {
    ondata(req.params, "loading.end")
    let response = await kernel.api.wait(req.parent.path)
    console.log("loading.end response", response)
    return response
  }
}
module.exports = Loading
