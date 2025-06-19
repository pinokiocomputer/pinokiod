module.exports = async (req, ondata, kernel) => {
  // send "input" type event so the frontend triggers a modal
  ondata(req.params, "input")
  // then, wait until the frontend responds
  let id = req.parent.id || req.parent.path
  let response = await kernel.api.wait(id)
  return response
}
