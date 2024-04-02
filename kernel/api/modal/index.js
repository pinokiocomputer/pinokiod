module.exports = async (req, ondata, kernel) => {
  ondata(req.params, "modal")
  let response = await kernel.api.wait(req.parent.path)
  return response
}
