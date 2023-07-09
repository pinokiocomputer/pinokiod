module.exports = async (req, ondata, kernel) => {
  /*
    req := {
      method: "goto",
      params: {
        index: 0,
        input: <any value that will be passed int as "input">
      }
    }
  */
  if (req.params && typeof req.params.index !== "undefined") {
    req.next = req.params.index
    return req.params.input
  }
}
