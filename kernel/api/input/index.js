module.exports = async (req, ondata, kernel) => {
  // send "input" type event so the frontend triggers a modal
  ondata(req.params, "input")
  // then, wait until the frontend responds
  let response = await kernel.api.wait(req.parent.path)
  return response
}
