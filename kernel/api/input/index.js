module.exports = async (req, ondata, kernel) => {
  ondata(req.params, "input")
  let response = await kernel.api.wait(req.parent.path)
  return response
}
