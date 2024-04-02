module.exports = async (req, ondata, kernel) => {
  /*
    req := {
      "method": "import",
      "params": {
        <name>: <uri>|<relative_filepath>|<absolute_filepath>,
        <name>: <uri>|<relative_filepath>|<absolute_filepath>,
      }
    }
  */
  let imported = kernel.import(req.params, req.cwd)
  return imported
}
