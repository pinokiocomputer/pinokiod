/*
info.local(...args)
info.running(...args)
info.exists(...args)
info.path(...args)
*/
const path = require('path')
const fs = require("fs")
class Info {
  constructor(kernel) {
    this.kernel = kernel
  }
  callsites () {
    const _prepareStackTrace = Error.prepareStackTrace;
    try {
      let result = [];
      Error.prepareStackTrace = (_, callSites) => {
        const callSitesWithoutCurrent = callSites.slice(1);
        result = callSitesWithoutCurrent;
        return callSitesWithoutCurrent;
      };

      new Error().stack; // eslint-disable-line unicorn/error-message, no-unused-expressions
      return result;
    } finally {
      Error.prepareStackTrace = _prepareStackTrace;
    }
  }
  caller () {
    return this.callsites()[2].getFileName()
  }
  // get the app path
  app_path(...args) {
  }
  // get full path of the relative path
  path(...args) {
    let cwd = path.dirname(this.caller())
    return path.resolve(cwd, ...args)
  }
  running(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return this.kernel.api.running[resolved_path]
  }
  exists(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return fs.existsSync(resolved_path)
  }
  local(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return this.kernel.memory.local[resolved_path] || {}
  }
  global(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return this.kernel.memory.global[resolved_path] || {}
  }
}

module.exports = Info
