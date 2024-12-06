const path = require('path')
const unparse = require('yargs-unparser-custom-flag');
const Shell = require('../shell')
class HF {
  /*
  {
    "method": "hf.download",
    "params": {
      path: <cwd>,
      env: {
        <env1>: <val1>,
        <env1>: <val1>,
        <env1>: <val1>,
      },
      _: [<command line args>'],
      <arg1>: <val1>,
      <arg2>: <val2>,
      ...
    }
  }
  */
  async download(req, ondata, kernel) {
    const shell = new Shell()
    console.log("params before", req.params)
    let params = Object.assign({}, req.params)
    delete params.env
    delete params.path
    let chunks = unparse(params)
    let message = `huggingface-cli download ${chunks.join(" ")}`
    console.log({ message, before: req.params.message })
    req.params.message = message
    console.log("params after", req.params)
    let res = await shell.run(req, ondata, kernel)
    return res
  }
}
module.exports = HF
