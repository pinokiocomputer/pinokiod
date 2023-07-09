module.exports = async (req, ondata, kernel) => {
  /*
    {
      "method": "load",
      "params": {
        <key1>: <path1>,
        <key2>: <path2>
      }
    }
  */
  let o = {}
  for(let key in req.params) {
    let uri = req.params[key]
    let filepath = kernel.api.resolvePath(req.cwd, uri)
    let loaded = (await kernel.loader.load(filepath)).resolved
    o[key] = loaded
  }
  return o
}
