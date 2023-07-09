module.exports = async (req, ondata, kernel) => {
  /*
    req := {
      method: "log",
      params: {
        raw: <raw string (including ANSI)>,
        json: <object>,   // single line
        json2: <object>   // multiline
      }
    }
  */
  if (req.params) {
    if (typeof req.params.raw !== "undefined") {
      ondata({
        raw: String(req.params.raw).replace(/\n/g, "\r\n")
      })
    } else if (typeof req.params.text !== "undefined") {
      ondata({
        raw: String(req.params.text).replace(/\n/g, "\r\n")
      })
    } else if (typeof req.params.json !== "undefined") {
      ondata({
        raw: JSON.stringify(req.params.json).replace(/\n/g, "\r\n")
      })
    } else if (typeof req.params.json2 !== "undefined") {
      ondata({
        raw: JSON.stringify(req.params.json2, null, 2).replace(/\n/g, "\r\n")
      })
    }
    ondata({
      raw: "\r\n"
    })
  }
}
