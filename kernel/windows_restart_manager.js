const ERROR_SUCCESS = 0
const ERROR_MORE_DATA = 234
const CCH_RM_SESSION_KEY = 32

let bindings = null

const initialize = () => {
  if (bindings) {
    return bindings
  }
  if (process.platform !== "win32") {
    return null
  }

  const koffi = require("koffi")
  const library = koffi.load("rstrtmgr.dll")
  const fileTime = koffi.struct({
    dwLowDateTime: "uint32_t",
    dwHighDateTime: "uint32_t",
  })
  const uniqueProcess = koffi.struct({
    dwProcessId: "uint32_t",
    ProcessStartTime: fileTime,
  })
  const processInfo = koffi.struct({
    Process: uniqueProcess,
    strAppName: koffi.array("char16_t", 256, "String"),
    strServiceShortName: koffi.array("char16_t", 64, "String"),
    ApplicationType: "int32_t",
    AppStatus: "uint32_t",
    TSSessionId: "uint32_t",
    bRestartable: "int32_t",
  })

  bindings = {
    koffi,
    processInfo,
    startSession: library.func("uint32_t __stdcall RmStartSession(_Out_ uint32_t *session, uint32_t flags, _Out_ void *sessionKey)"),
    registerResources: library.func("uint32_t __stdcall RmRegisterResources(uint32_t session, uint32_t fileCount, const str16 *files, uint32_t applicationCount, const void *applications, uint32_t serviceCount, const str16 *services)"),
    getList: library.func("uint32_t __stdcall RmGetList(uint32_t session, _Out_ uint32_t *needed, _Inout_ uint32_t *count, _Out_ void *processes, _Out_ uint32_t *rebootReasons)"),
    endSession: library.func("uint32_t __stdcall RmEndSession(uint32_t session)"),
  }
  return bindings
}

const normalizeProcessInfo = (entry) => {
  const uniqueProcess = entry && entry.Process ? entry.Process : {}
  const pid = Number(uniqueProcess.dwProcessId) || 0
  return {
    pid,
    name: String(entry && entry.strAppName ? entry.strAppName : "").trim(),
    serviceName: String(entry && entry.strServiceShortName ? entry.strServiceShortName : "").trim(),
  }
}

const inspectWindowsFileLocks = async (files) => {
  if (process.platform !== "win32") {
    return []
  }

  const resources = Array.from(new Set((Array.isArray(files) ? files : [])
    .filter((file) => typeof file === "string" && file.length > 0)))
  if (resources.length === 0) {
    return []
  }

  const api = initialize()
  const session = [0]
  const sessionKey = Buffer.alloc((CCH_RM_SESSION_KEY + 1) * 2)
  let status = api.startSession(session, 0, sessionKey)
  if (status !== ERROR_SUCCESS) {
    throw new Error(`RmStartSession failed with Windows error ${status}`)
  }

  try {
    status = api.registerResources(session[0], resources.length, resources, 0, null, 0, null)
    if (status !== ERROR_SUCCESS) {
      throw new Error(`RmRegisterResources failed with Windows error ${status}`)
    }

    let needed = [0]
    let count = [0]
    let rebootReasons = [0]
    status = api.getList(session[0], needed, count, null, rebootReasons)
    if (status === ERROR_SUCCESS && needed[0] === 0) {
      return []
    }
    if (status !== ERROR_MORE_DATA && status !== ERROR_SUCCESS) {
      throw new Error(`RmGetList failed with Windows error ${status}`)
    }

    let capacity = Math.max(needed[0], 1)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      count = [capacity]
      needed = [capacity]
      rebootReasons = [0]
      const buffer = Buffer.alloc(api.koffi.sizeof(api.processInfo) * capacity)
      status = api.getList(session[0], needed, count, buffer, rebootReasons)
      if (status === ERROR_SUCCESS) {
        const entries = api.koffi.decode(buffer, api.processInfo, Math.min(count[0], capacity))
        const blockers = entries
          .map(normalizeProcessInfo)
          .filter((entry) => entry.pid > 0)
        return blockers
      }
      if (status !== ERROR_MORE_DATA) {
        throw new Error(`RmGetList failed with Windows error ${status}`)
      }
      capacity = Math.max(needed[0], capacity + 1)
    }
    throw new Error("RmGetList changed repeatedly while enumerating blocking processes")
  } finally {
    api.endSession(session[0])
  }
}

module.exports = {
  inspectWindowsFileLocks,
}
