module.exports = async (req, ondata, kernel) => {
  /*
    req := {
      method: "jump",
      params: {
        index: 0,
        input: <any value that will be passed int as "input">
      }
    }
  */
  if (req.params.hasOwnProperty("index")) {
    req.next = req.params.index
  } else if (req.params.hasOwnProperty("id")) {
    // find the req.next
    let run = req.parent.body.run
    for(let i=0; i<run.length; i++) {
      let step = run[i]
      if (step && step.id === req.params.id) {
        req.next = i
      }
    }
  }
  return req.params.params || req.params.input
}
