/*
info.local(...args)
info.running(...args)
info.exists(...args)
info.path(...args)
*/
const path = require('path')
const fs = require("fs")
const Util = require('./util')
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
  async venv(_cwd) {
    let cwd = _cwd || this.cwd()
    let venv = await Util.find_venv(cwd)
    return venv
  }
  cwd() {
    return path.dirname(this.caller())
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
    return this.kernel.status(resolved_path)
  }
  exists(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    let exists = fs.existsSync(resolved_path)
    return exists ? exists: false
  }
  local(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return this.kernel.scopedMemoryEntry(this.kernel.memory.local, resolved_path) || {}
  }
  global(...args) {
    let cwd = path.dirname(this.caller())
    let resolved_path = path.resolve(cwd, ...args)
    return this.kernel.scopedMemoryEntry(this.kernel.memory.global, resolved_path) || {}
  }
  scriptsByApi() {
    if (!this.kernel || !this.kernel.memory || !this.kernel.memory.local) {
      return {}
    }

    const apiRoot = this.kernel.path("api")
    const scriptsByApi = {}

    for (const [id, localVariables] of Object.entries(this.kernel.memory.local)) {
      if (!id) continue

      const scriptPath = id.split("?")[0]
      if (!scriptPath || !this.isSubpath(apiRoot, scriptPath)) continue

      const apiName = Util.api_name(scriptPath, this.kernel)
      if (!apiName || apiName === '.' || apiName.startsWith('..')) continue

      if (!scriptsByApi[apiName]) {
        scriptsByApi[apiName] = []
      }

      scriptsByApi[apiName].push({
        uri: scriptPath,
        local: localVariables || {}
      })
    }

    return scriptsByApi
  }
  isSubpath(parent, child) {
    if (!parent || !child) {
      return false
    }
    const relative = path.relative(parent, child)
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
}

module.exports = Info
