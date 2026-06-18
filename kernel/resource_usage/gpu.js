"use strict"

const fs = require("fs")
const os = require("os")
const path = require("path")
const { normalizePid } = require("./process_tree")

const DEFAULT_GPU_TTL_MS = 5000
const DEFAULT_DRM_FDINFO_MAX_PIDS = 4096
const DEFAULT_DRM_FDINFO_MAX_FDS_PER_PID = 1024
const MIB = 1024 * 1024

const WINDOWS_GPU_PROCESS_COUNTER = "\\GPU Process Memory(*)\\Dedicated Usage"
const ERROR_SUCCESS = 0
const PDH_MORE_DATA = 0x800007D2
const PDH_INVALID_PATH = 0xC0000BC4
const PDH_INVALID_DATA = 0xC0000BC6
const PDH_NO_DATA = 0x800007D5
const PDH_FMT_LARGE = 0x00000400

const NVML_SUCCESS = 0
const NVML_ERROR_INSUFFICIENT_SIZE = 7
const NVML_VALUE_NOT_AVAILABLE = 0xFFFFFFFFFFFFFFFFn

const AMDSMI_INIT_AMD_GPUS = 1 << 1
const RSMI_INIT_DEFAULT = 0

let koffiModule
const koffiTypeCache = new WeakMap()

function unique(values) {
  const seen = new Set()
  const next = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function loadKoffi() {
  if (koffiModule !== undefined) {
    return koffiModule
  }
  try {
    koffiModule = require("koffi")
  } catch (_) {
    koffiModule = null
  }
  return koffiModule
}

function getCachedKoffiTypes(koffi, key, factory) {
  let cache = koffiTypeCache.get(koffi)
  if (!cache) {
    cache = new Map()
    koffiTypeCache.set(koffi, cache)
  }
  if (!cache.has(key)) {
    cache.set(key, factory())
  }
  return cache.get(key)
}

function getWindowsPdhTypes(koffi) {
  return getCachedKoffiTypes(koffi, "windows-pdh", () => {
    const counterValue = koffi.struct("PDH_FMT_COUNTERVALUE", {
      CStatus: "uint32_t",
      largeValue: "int64_t"
    })
    const counterInfo = koffi.struct("PDH_COUNTER_INFO_W_PREFIX", {
      dwLength: "uint32_t",
      dwType: "uint32_t",
      CVersion: "uint32_t",
      CStatus: "uint32_t",
      lScale: "int32_t",
      lDefaultScale: "int32_t",
      dwUserData: "uintptr_t",
      dwQueryUserData: "uintptr_t",
      szFullPath: "str16"
    })
    return { counterValue, counterInfo }
  })
}

function getNvmlTypes(koffi) {
  return getCachedKoffiTypes(koffi, "nvml", () => {
    const processInfoV1 = koffi.struct("nvmlProcessInfo_v1_t", {
      pid: "uint32_t",
      usedGpuMemory: "uint64_t"
    })
    const processInfoV2 = koffi.struct("nvmlProcessInfo_v2_t", {
      pid: "uint32_t",
      usedGpuMemory: "uint64_t",
      gpuInstanceId: "uint32_t",
      computeInstanceId: "uint32_t"
    })
    return { processInfoV1, processInfoV2 }
  })
}

function getAmdSmiTypes(koffi) {
  return getCachedKoffiTypes(koffi, "amdsmi", () => {
    const engineUsage = koffi.struct("amdsmi_engine_usage_process_t", {
      gfx: "uint64_t",
      enc: "uint64_t",
      reserved: koffi.array("uint32_t", 12)
    })
    const memoryUsage = koffi.struct("amdsmi_memory_usage_process_t", {
      gtt_mem: "uint64_t",
      cpu_mem: "uint64_t",
      vram_mem: "uint64_t",
      reserved: koffi.array("uint32_t", 10)
    })
    const procInfo = koffi.struct("amdsmi_proc_info_t", {
      name: koffi.array("char", 256),
      pid: "uint32_t",
      mem: "uint64_t",
      engine_usage: engineUsage,
      memory_usage: memoryUsage,
      container_name: koffi.array("char", 256),
      cu_occupancy: "uint32_t",
      evicted_time: "uint32_t",
      reserved: koffi.array("uint32_t", 10)
    })
    return { procInfo }
  })
}

function getRocmSmiTypes(koffi) {
  return getCachedKoffiTypes(koffi, "rocm-smi", () => {
    const procInfo = koffi.struct("rsmi_process_info_t", {
      process_id: "uint32_t",
      pasid: "uint32_t",
      vram_usage: "uint64_t",
      sdma_usage: "uint64_t",
      cu_occupancy: "uint32_t"
    })
    return { procInfo }
  })
}

function existingLibraryCandidates(candidates) {
  return unique(candidates).filter((candidate) => {
    if (!candidate) return false
    if (!path.isAbsolute(candidate)) return true
    try {
      return fs.existsSync(candidate)
    } catch (_) {
      return false
    }
  })
}

function rocmLibraryCandidates(filename) {
  const roots = unique([
    process.env.ROCM_PATH,
    process.env.ROCM_HOME,
    "/opt/rocm",
    "/usr",
    "/usr/local"
  ])
  const candidates = [filename]
  for (const root of roots) {
    candidates.push(
      path.join(root, "lib", filename),
      path.join(root, "lib64", filename)
    )
  }
  candidates.push(
    path.join("/usr/lib/x86_64-linux-gnu", filename),
    path.join("/usr/lib/aarch64-linux-gnu", filename),
    path.join("/usr/local/lib", filename)
  )
  return existingLibraryCandidates(candidates)
}

function loadFirstLibrary(koffi, candidates, options = {}) {
  let lastError = null
  for (const candidate of existingLibraryCandidates(candidates)) {
    try {
      return koffi.load(candidate, options)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("native GPU library unavailable")
}

function optionalFunction(library, definitions) {
  for (const definition of definitions) {
    try {
      return library.func(definition)
    } catch (_) {}
  }
  return null
}

function statusCode(value) {
  return Number(value) >>> 0
}

function isStatus(value, expected) {
  return statusCode(value) === (expected >>> 0)
}

function isSuccess(value) {
  return isStatus(value, ERROR_SUCCESS)
}

function isNoDataStatus(value) {
  return isStatus(value, PDH_INVALID_PATH) || isStatus(value, PDH_INVALID_DATA) || isStatus(value, PDH_NO_DATA)
}

function toSafeNumber(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(value)
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return number
}

function parseMemoryToBytes(value, defaultUnit = "") {
  if (value == null) return null
  if (typeof value === "number" || typeof value === "bigint") {
    const number = toSafeNumber(value)
    if (number == null) return null
    if (defaultUnit === "mib") return Math.round(number * MIB)
    if (defaultUnit === "kb") return Math.round(number * 1024)
    return Math.round(number)
  }
  const raw = String(value).trim()
  if (!raw || /N\/A|not supported|none/i.test(raw)) {
    return null
  }
  const match = /(-?\d+(?:\.\d+)?)\s*([KMGT]?i?B|[KMGT]B|bytes?)?/i.exec(raw)
  if (!match) return null
  const amount = Number.parseFloat(match[1])
  if (!Number.isFinite(amount) || amount < 0) return null
  const unit = (match[2] || defaultUnit || "bytes").toLowerCase()
  if (unit === "mib" || unit === "mb") return Math.round(amount * MIB)
  if (unit === "gib" || unit === "gb") return Math.round(amount * 1024 * MIB)
  if (unit === "kib" || unit === "kb") return Math.round(amount * 1024)
  if (unit === "tib" || unit === "tb") return Math.round(amount * 1024 * 1024 * MIB)
  return Math.round(amount)
}

function addGpuProcess(processes, pid, bytes) {
  const normalizedPid = normalizePid(pid)
  if (!normalizedPid || !Number.isFinite(bytes) || bytes < 0) {
    return
  }
  const current = processes.get(normalizedPid) || {
    pid: normalizedPid,
    usedGpuMemoryBytes: 0
  }
  current.usedGpuMemoryBytes += bytes
  processes.set(normalizedPid, current)
}

function mergeGpuProcess(processes, pid, bytes) {
  const normalizedPid = normalizePid(pid)
  if (!normalizedPid || !Number.isFinite(bytes) || bytes < 0) {
    return
  }
  const current = processes.get(normalizedPid) || {
    pid: normalizedPid,
    usedGpuMemoryBytes: 0
  }
  current.usedGpuMemoryBytes = Math.max(current.usedGpuMemoryBytes || 0, bytes)
  processes.set(normalizedPid, current)
}

function normalizePidSet(values) {
  const pids = []
  for (const value of values || []) {
    const pid = normalizePid(value)
    if (pid) pids.push(pid)
  }
  return Array.from(new Set(pids)).sort((a, b) => a - b)
}

function filterProcessMap(processes, pids) {
  const targetPids = normalizePidSet(pids)
  if (targetPids.length === 0 && pids != null) {
    return new Map()
  }
  if (targetPids.length === 0) {
    return processes
  }
  const targetSet = new Set(targetPids)
  const filtered = new Map()
  for (const entry of processes.values()) {
    if (targetSet.has(entry.pid)) {
      filtered.set(entry.pid, entry)
    }
  }
  return filtered
}

function coveredPids(processes) {
  return new Set(Array.from(processes.keys()))
}

function hasUncoveredTarget(pids, covered) {
  const targetPids = normalizePidSet(pids)
  if (pids == null) return true
  if (targetPids.length === 0) return false
  for (const pid of targetPids) {
    if (!covered.has(pid)) return true
  }
  return false
}

function extractPidFromWindowsGpuInstance(instanceName) {
  const match = /(?:^|[^a-z0-9])pid[_\s-]*(\d+)(?:\D|$)/i.exec(String(instanceName || ""))
  return normalizePid(match && match[1])
}

function decodeWindowsMultiSz(buffer, charCount) {
  const values = []
  let start = 0
  const count = Math.max(0, Math.min(charCount || 0, Math.floor(buffer.length / 2)))
  for (let i = 0; i < count; i += 1) {
    const char = buffer.readUInt16LE(i * 2)
    if (char !== 0) continue
    if (i === start) break
    values.push(buffer.subarray(start * 2, i * 2).toString("utf16le"))
    start = i + 1
  }
  return values.filter(Boolean)
}

function isDedicatedDrmMemoryRegion(region) {
  const normalized = String(region || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
  const compact = normalized.replace(/[^a-z0-9]/g, "")
  if (!compact || /^(system|gtt|memory|shared|stolen|cpu|host)\d*$/.test(compact)) {
    return false
  }
  return /^vram\d*$/.test(compact) || /^local\d*$/.test(compact)
}

function parseLinuxDrmFdinfo(stdout) {
  const fields = new Map()
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator < 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key) fields.set(key, value)
  }

  const driver = fields.get("drm-driver")
  if (!driver) {
    return null
  }

  let residentBytes = 0
  let legacyMemoryBytes = 0
  let hasResidentDedicatedMemory = false
  for (const [key, value] of fields.entries()) {
    const match = /^drm-(resident|memory)-(.+)$/.exec(key)
    if (!match || !isDedicatedDrmMemoryRegion(match[2])) continue
    const bytes = parseMemoryToBytes(value)
    if (!Number.isFinite(bytes) || bytes < 0) continue
    if (match[1] === "resident") {
      hasResidentDedicatedMemory = true
      residentBytes += bytes
    } else {
      legacyMemoryBytes += bytes
    }
  }

  return {
    driver,
    pdev: fields.get("drm-pdev") || "",
    clientId: fields.get("drm-client-id") || "",
    dedicatedBytes: hasResidentDedicatedMemory ? residentBytes : legacyMemoryBytes
  }
}

async function collectLinuxDrmFdinfoProcesses(pids, options = {}) {
  const procRoot = options.procRoot || "/proc"
  const maxPids = options.maxPids || DEFAULT_DRM_FDINFO_MAX_PIDS
  const maxFdsPerPid = options.maxFdsPerPid || DEFAULT_DRM_FDINFO_MAX_FDS_PER_PID
  const targetPids = normalizePidSet(pids).slice(0, maxPids)
  const byClient = new Map()

  for (const pid of targetPids) {
    const fdinfoDir = path.join(procRoot, String(pid), "fdinfo")
    let entries = []
    try {
      entries = await fs.promises.readdir(fdinfoDir, { withFileTypes: true })
    } catch (_) {
      continue
    }

    let scannedFds = 0
    for (const entry of entries) {
      const name = entry && entry.name ? entry.name : ""
      if (!/^\d+$/.test(name)) continue
      scannedFds += 1
      if (scannedFds > maxFdsPerPid) break

      let stdout = ""
      try {
        stdout = await fs.promises.readFile(path.join(fdinfoDir, name), "utf8")
      } catch (_) {
        continue
      }

      const parsed = parseLinuxDrmFdinfo(stdout)
      if (!parsed || !(parsed.dedicatedBytes > 0)) continue
      const clientKey = parsed.clientId
        ? `client:${parsed.clientId}`
        : "unknown-client"
      const key = [
        pid,
        parsed.driver || "unknown-driver",
        parsed.pdev || "unknown-device",
        clientKey
      ].join(":")
      const current = byClient.get(key)
      byClient.set(key, {
        pid,
        bytes: current ? Math.max(current.bytes, parsed.dedicatedBytes) : parsed.dedicatedBytes
      })
    }
  }

  const processes = new Map()
  for (const entry of byClient.values()) {
    addGpuProcess(processes, entry.pid, entry.bytes)
  }
  return processes
}

class WindowsPdhGpuMemoryClient {
  constructor(options = {}) {
    this.koffi = options.koffi || loadKoffi()
    this.library = null
    this.query = null
    this.counters = []
    this.counterValueType = null
    this.counterInfoType = null
    this.functions = null
    this.counterRefreshMs = options.counterRefreshMs || DEFAULT_GPU_TTL_MS
    this.lastCounterRefreshAt = 0
  }

  init() {
    if (this.functions) return
    if (!this.koffi) {
      throw new Error("koffi unavailable")
    }

    const types = getWindowsPdhTypes(this.koffi)
    this.counterValueType = types.counterValue
    this.counterInfoType = types.counterInfo

    this.library = this.koffi.load("pdh.dll")
    this.functions = {
      openQuery: this.library.func("uint32_t __stdcall PdhOpenQueryW(const char16_t *szDataSource, uintptr_t dwUserData, _Out_ void **phQuery)"),
      addEnglishCounter: this.library.func("uint32_t __stdcall PdhAddEnglishCounterW(void *hQuery, const char16_t *szFullCounterPath, uintptr_t dwUserData, _Out_ void **phCounter)"),
      addCounter: this.library.func("uint32_t __stdcall PdhAddCounterW(void *hQuery, const char16_t *szFullCounterPath, uintptr_t dwUserData, _Out_ void **phCounter)"),
      collectQueryData: this.library.func("uint32_t __stdcall PdhCollectQueryData(void *hQuery)"),
      getCounterInfo: this.library.func("uint32_t __stdcall PdhGetCounterInfoW(void *hCounter, int bRetrieveExplainText, _Inout_ uint32_t *pdwBufferSize, _Out_ void *lpBuffer)"),
      expandWildCardPath: this.library.func("uint32_t __stdcall PdhExpandWildCardPathW(const char16_t *szDataSource, const char16_t *szWildCardPath, _Out_ char16_t *mszExpandedPathList, _Inout_ uint32_t *pcchPathListLength, uint32_t dwFlags)"),
      getFormattedCounterValue: this.library.func("uint32_t __stdcall PdhGetFormattedCounterValue(void *hCounter, uint32_t dwFormat, _Out_ uint32_t *lpdwType, _Out_ PDH_FMT_COUNTERVALUE *pValue)"),
      closeQuery: this.library.func("uint32_t __stdcall PdhCloseQuery(void *hQuery)")
    }
  }

  openQuery() {
    const query = [null]
    const status = this.functions.openQuery(null, 0, query)
    if (!isSuccess(status)) {
      throw new Error(`PdhOpenQueryW failed: 0x${statusCode(status).toString(16)}`)
    }
    return query[0]
  }

  closeQuery(query) {
    if (!query || !this.functions) return
    try {
      this.functions.closeQuery(query)
    } catch (_) {}
  }

  getLocalizedWildcardPath() {
    const query = this.openQuery()
    const counter = [null]
    try {
      let status = this.functions.addEnglishCounter(query, WINDOWS_GPU_PROCESS_COUNTER, 0, counter)
      if (!isSuccess(status)) {
        throw new Error(`PdhAddEnglishCounterW failed: 0x${statusCode(status).toString(16)}`)
      }

      const bufferSize = [0]
      status = this.functions.getCounterInfo(counter[0], 0, bufferSize, null)
      if (!isStatus(status, PDH_MORE_DATA) && !isSuccess(status)) {
        throw new Error(`PdhGetCounterInfoW failed: 0x${statusCode(status).toString(16)}`)
      }
      if (bufferSize[0] <= 0) {
        return WINDOWS_GPU_PROCESS_COUNTER
      }

      const buffer = Buffer.alloc(bufferSize[0])
      status = this.functions.getCounterInfo(counter[0], 0, bufferSize, buffer)
      if (!isSuccess(status)) {
        throw new Error(`PdhGetCounterInfoW failed: 0x${statusCode(status).toString(16)}`)
      }

      const info = this.koffi.decode(buffer, this.counterInfoType)
      return info && info.szFullPath ? info.szFullPath : WINDOWS_GPU_PROCESS_COUNTER
    } finally {
      this.closeQuery(query)
    }
  }

  expandWildcardPath(wildcardPath) {
    const charCount = [0]
    let status = this.functions.expandWildCardPath(null, wildcardPath, null, charCount, 0)
    if (isNoDataStatus(status)) {
      return []
    }
    if (!isStatus(status, PDH_MORE_DATA) && !isSuccess(status)) {
      throw new Error(`PdhExpandWildCardPathW failed: 0x${statusCode(status).toString(16)}`)
    }
    if (charCount[0] <= 0) {
      return []
    }

    const buffer = Buffer.alloc(charCount[0] * 2)
    status = this.functions.expandWildCardPath(null, wildcardPath, buffer, charCount, 0)
    if (isNoDataStatus(status)) {
      return []
    }
    if (!isSuccess(status)) {
      throw new Error(`PdhExpandWildCardPathW failed: 0x${statusCode(status).toString(16)}`)
    }
    return decodeWindowsMultiSz(buffer, charCount[0])
  }

  refreshCounters(force = false) {
    const now = Date.now()
    if (!force && this.query && now - this.lastCounterRefreshAt < this.counterRefreshMs) {
      return
    }

    const paths = this.expandWildcardPath(this.getLocalizedWildcardPath())
    const query = this.openQuery()
    const counters = []
    try {
      for (const counterPath of paths) {
        const pid = extractPidFromWindowsGpuInstance(counterPath)
        if (!pid) continue
        const counter = [null]
        const status = this.functions.addCounter(query, counterPath, 0, counter)
        if (isSuccess(status) && counter[0]) {
          counters.push({ handle: counter[0], pid })
        }
      }
    } catch (error) {
      this.closeQuery(query)
      throw error
    }

    const previousQuery = this.query
    this.query = counters.length > 0 ? query : null
    this.counters = counters
    this.lastCounterRefreshAt = now
    if (this.query !== query) {
      this.closeQuery(query)
    }
    this.closeQuery(previousQuery)
  }

  readCounterValue(counter) {
    const type = [0]
    const buffer = Buffer.alloc(this.koffi.sizeof(this.counterValueType))
    const status = this.functions.getFormattedCounterValue(counter.handle, PDH_FMT_LARGE, type, buffer)
    if (isNoDataStatus(status)) {
      return null
    }
    if (!isSuccess(status)) {
      return null
    }
    const value = this.koffi.decode(buffer, this.counterValueType)
    if (!value || !isSuccess(value.CStatus)) {
      return null
    }
    return parseMemoryToBytes(value.largeValue)
  }

  collect(pids) {
    this.init()
    this.refreshCounters(false)
    if (!this.query || this.counters.length === 0) {
      return new Map()
    }

    const status = this.functions.collectQueryData(this.query)
    if (isNoDataStatus(status)) {
      return new Map()
    }
    if (!isSuccess(status)) {
      throw new Error(`PdhCollectQueryData failed: 0x${statusCode(status).toString(16)}`)
    }

    const targetPids = normalizePidSet(pids)
    const targetSet = targetPids.length > 0 ? new Set(targetPids) : null
    const processes = new Map()
    for (const counter of this.counters) {
      if (!counter || (targetSet && !targetSet.has(counter.pid))) continue
      addGpuProcess(processes, counter.pid, this.readCounterValue(counter))
    }
    return processes
  }

  stop() {
    this.closeQuery(this.query)
    this.query = null
    this.counters = []
  }
}

class NvmlGpuMemoryClient {
  constructor(options = {}) {
    this.koffi = options.koffi || loadKoffi()
    this.library = null
    this.initialized = false
    this.processInfoV1 = null
    this.processInfoV2 = null
    this.functions = null
  }

  init() {
    if (this.initialized) return
    if (!this.koffi) {
      throw new Error("koffi unavailable")
    }

    const types = getNvmlTypes(this.koffi)
    this.processInfoV1 = types.processInfoV1
    this.processInfoV2 = types.processInfoV2

    this.library = loadFirstLibrary(this.koffi, [
      process.env.NVIDIA_ML,
      "libnvidia-ml.so.1",
      "/usr/lib/x86_64-linux-gnu/libnvidia-ml.so.1",
      "/usr/lib/aarch64-linux-gnu/libnvidia-ml.so.1",
      "/usr/lib64/libnvidia-ml.so.1",
      "/usr/local/nvidia/lib64/libnvidia-ml.so.1"
    ])
    this.functions = {
      init: optionalFunction(this.library, [
        "int nvmlInit_v2(void)",
        "int nvmlInit(void)"
      ]),
      shutdown: optionalFunction(this.library, [
        "int nvmlShutdown(void)"
      ]),
      getCount: optionalFunction(this.library, [
        "int nvmlDeviceGetCount_v2(_Out_ uint32_t *deviceCount)",
        "int nvmlDeviceGetCount(_Out_ uint32_t *deviceCount)"
      ]),
      getHandleByIndex: optionalFunction(this.library, [
        "int nvmlDeviceGetHandleByIndex_v2(uint32_t index, _Out_ void **device)",
        "int nvmlDeviceGetHandleByIndex(uint32_t index, _Out_ void **device)"
      ]),
      compute: this.pickProcessFunction("nvmlDeviceGetComputeRunningProcesses"),
      graphics: this.pickProcessFunction("nvmlDeviceGetGraphicsRunningProcesses"),
      mps: this.pickProcessFunction("nvmlDeviceGetMPSComputeRunningProcesses")
    }

    if (!this.functions.init || !this.functions.getCount || !this.functions.getHandleByIndex) {
      throw new Error("NVML process API unavailable")
    }
    const status = this.functions.init()
    if (status !== NVML_SUCCESS) {
      throw new Error(`nvmlInit failed: ${status}`)
    }
    this.initialized = true
  }

  pickProcessFunction(baseName) {
    const candidates = [
      { suffix: "_v3", type: () => this.processInfoV2 },
      { suffix: "_v2", type: () => this.processInfoV2 },
      { suffix: "", type: () => this.processInfoV1 }
    ]
    for (const candidate of candidates) {
      const typeName = candidate.type() === this.processInfoV2 ? "nvmlProcessInfo_v2_t" : "nvmlProcessInfo_v1_t"
      const func = optionalFunction(this.library, [
        `int ${baseName}${candidate.suffix}(void *device, _Inout_ uint32_t *infoCount, _Out_ ${typeName} *infos)`
      ])
      if (func) {
        return { func, type: candidate.type() }
      }
    }
    return null
  }

  getDeviceHandles() {
    const count = [0]
    const status = this.functions.getCount(count)
    if (status !== NVML_SUCCESS) {
      throw new Error(`nvmlDeviceGetCount failed: ${status}`)
    }
    const handles = []
    for (let i = 0; i < count[0]; i += 1) {
      const handle = [null]
      const handleStatus = this.functions.getHandleByIndex(i, handle)
      if (handleStatus === NVML_SUCCESS && handle[0]) {
        handles.push(handle[0])
      }
    }
    return handles
  }

  collectProcessList(device, entry) {
    if (!entry || !entry.func) return []

    let count = [0]
    let status = entry.func(device, count, null)
    if (status === NVML_SUCCESS && count[0] === 0) {
      return []
    }
    if (status !== NVML_SUCCESS && status !== NVML_ERROR_INSUFFICIENT_SIZE) {
      return []
    }

    let capacity = Math.max(1, count[0] + 8)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      count = [capacity]
      const buffer = Buffer.alloc(this.koffi.sizeof(entry.type) * capacity)
      status = entry.func(device, count, buffer)
      if (status === NVML_SUCCESS) {
        return this.koffi.decode(buffer, entry.type, Math.min(count[0], capacity))
      }
      if (status !== NVML_ERROR_INSUFFICIENT_SIZE || count[0] <= capacity) {
        return []
      }
      capacity = count[0] + 8
    }
    return []
  }

  collect(pids = null) {
    this.init()
    const processes = new Map()
    for (const device of this.getDeviceHandles()) {
      const deviceProcesses = new Map()
      for (const entry of [this.functions.compute, this.functions.graphics, this.functions.mps]) {
        for (const processInfo of this.collectProcessList(device, entry)) {
          if (!processInfo) continue
          const pid = normalizePid(processInfo.pid)
          if (!pid) continue
          if (typeof processInfo.usedGpuMemory === "bigint" && processInfo.usedGpuMemory === NVML_VALUE_NOT_AVAILABLE) {
            continue
          }
          const bytes = parseMemoryToBytes(processInfo.usedGpuMemory)
          mergeGpuProcess(deviceProcesses, pid, bytes)
        }
      }
      for (const entry of deviceProcesses.values()) {
        addGpuProcess(processes, entry.pid, entry.usedGpuMemoryBytes)
      }
    }
    return filterProcessMap(processes, pids)
  }

  stop() {
    if (this.initialized && this.functions && this.functions.shutdown) {
      try {
        this.functions.shutdown()
      } catch (_) {}
    }
    this.initialized = false
  }
}

class AmdSmiGpuMemoryClient {
  constructor(options = {}) {
    this.koffi = options.koffi || loadKoffi()
    this.library = null
    this.initialized = false
    this.procInfoType = null
    this.functions = null
  }

  init() {
    if (this.initialized) return
    if (!this.koffi) {
      throw new Error("koffi unavailable")
    }

    this.procInfoType = getAmdSmiTypes(this.koffi).procInfo

    this.library = loadFirstLibrary(this.koffi, [
      process.env.AMD_SMI_LIBRARY,
      ...rocmLibraryCandidates("libamd_smi.so")
    ])
    this.functions = {
      init: this.library.func("int amdsmi_init(uint64_t init_flags)"),
      shutdown: optionalFunction(this.library, [
        "int amdsmi_shut_down(void)"
      ]),
      getSocketHandles: this.library.func("int amdsmi_get_socket_handles(_Inout_ uint32_t *socket_count, _Out_ void **socket_handles)"),
      getProcessorHandles: this.library.func("int amdsmi_get_processor_handles(void *socket_handle, _Inout_ uint32_t *processor_count, _Out_ void **processor_handles)"),
      getProcessList: this.library.func("int amdsmi_get_gpu_process_list(void *processor_handle, _Inout_ uint32_t *max_processes, _Out_ amdsmi_proc_info_t *list)")
    }

    const status = this.functions.init(AMDSMI_INIT_AMD_GPUS)
    if (status !== 0) {
      throw new Error(`amdsmi_init failed: ${status}`)
    }
    this.initialized = true
  }

  readPointerArray(countFunction) {
    let count = [0]
    let status = countFunction(count, null)
    if (status !== 0 && count[0] === 0) {
      return []
    }
    if (count[0] <= 0) {
      return []
    }
    const pointerSize = this.koffi.sizeof("void *")
    const buffer = Buffer.alloc(pointerSize * count[0])
    status = countFunction(count, buffer)
    if (status !== 0) {
      return []
    }
    return this.koffi.decode(buffer, "uintptr_t", count[0]).filter(Boolean)
  }

  getProcessorHandles() {
    const sockets = this.readPointerArray((count, buffer) => {
      return this.functions.getSocketHandles(count, buffer)
    })
    const processors = []
    for (const socket of sockets) {
      processors.push(...this.readPointerArray((count, buffer) => {
        return this.functions.getProcessorHandles(socket, count, buffer)
      }))
    }
    return processors
  }

  collectProcessorProcesses(processor) {
    let count = [0]
    let status = this.functions.getProcessList(processor, count, null)
    if (status !== 0 && count[0] === 0) {
      return []
    }
    if (count[0] <= 0) {
      return []
    }

    let capacity = count[0]
    for (let attempt = 0; attempt < 2; attempt += 1) {
      count = [capacity]
      const buffer = Buffer.alloc(this.koffi.sizeof(this.procInfoType) * capacity)
      status = this.functions.getProcessList(processor, count, buffer)
      if (status === 0) {
        return this.koffi.decode(buffer, this.procInfoType, Math.min(count[0], capacity))
      }
      if (count[0] <= capacity) {
        return []
      }
      capacity = count[0]
    }
    return []
  }

  collect(pids = null) {
    this.init()
    const processes = new Map()
    for (const processor of this.getProcessorHandles()) {
      for (const entry of this.collectProcessorProcesses(processor)) {
        if (!entry) continue
        const bytes = parseMemoryToBytes(entry.memory_usage && entry.memory_usage.vram_mem)
        addGpuProcess(processes, entry.pid, bytes)
      }
    }
    return filterProcessMap(processes, pids)
  }

  stop() {
    if (this.initialized && this.functions && this.functions.shutdown) {
      try {
        this.functions.shutdown()
      } catch (_) {}
    }
    this.initialized = false
  }
}

class RocmSmiGpuMemoryClient {
  constructor(options = {}) {
    this.koffi = options.koffi || loadKoffi()
    this.library = null
    this.initialized = false
    this.procInfoType = null
    this.functions = null
  }

  init() {
    if (this.initialized) return
    if (!this.koffi) {
      throw new Error("koffi unavailable")
    }

    this.procInfoType = getRocmSmiTypes(this.koffi).procInfo

    this.library = loadFirstLibrary(this.koffi, [
      process.env.ROCM_SMI_LIBRARY,
      ...rocmLibraryCandidates("librocm_smi64.so")
    ])
    this.functions = {
      init: this.library.func("int rsmi_init(uint64_t init_flags)"),
      shutdown: optionalFunction(this.library, [
        "int rsmi_shut_down(void)"
      ]),
      getProcessInfo: this.library.func("int rsmi_compute_process_info_get(_Out_ rsmi_process_info_t *procs, _Inout_ uint32_t *num_items)")
    }

    const status = this.functions.init(RSMI_INIT_DEFAULT)
    if (status !== 0) {
      throw new Error(`rsmi_init failed: ${status}`)
    }
    this.initialized = true
  }

  collect(pids = null) {
    this.init()
    let count = [0]
    let status = this.functions.getProcessInfo(null, count)
    if (status !== 0 && count[0] === 0) {
      return new Map()
    }
    if (count[0] <= 0) {
      return new Map()
    }

    const buffer = Buffer.alloc(this.koffi.sizeof(this.procInfoType) * count[0])
    status = this.functions.getProcessInfo(buffer, count)
    if (status !== 0) {
      return new Map()
    }

    const processes = new Map()
    for (const entry of this.koffi.decode(buffer, this.procInfoType, count[0])) {
      if (!entry) continue
      addGpuProcess(processes, entry.process_id, parseMemoryToBytes(entry.vram_usage))
    }
    return filterProcessMap(processes, pids)
  }

  stop() {
    if (this.initialized && this.functions && this.functions.shutdown) {
      try {
        this.functions.shutdown()
      } catch (_) {}
    }
    this.initialized = false
  }
}

class GpuSampler {
  constructor(options = {}) {
    this.kernel = options.kernel || null
    this.platform = options.platform || (this.kernel && this.kernel.platform) || os.platform()
    this.ttlMs = options.ttlMs || DEFAULT_GPU_TTL_MS
    this.procRoot = options.procRoot || "/proc"
    this.drmFdinfoMaxPids = options.drmFdinfoMaxPids || DEFAULT_DRM_FDINFO_MAX_PIDS
    this.drmFdinfoMaxFdsPerPid = options.drmFdinfoMaxFdsPerPid || DEFAULT_DRM_FDINFO_MAX_FDS_PER_PID
    this.windowsPdhClient = options.windowsPdhClient || null
    this.nvmlClient = options.nvmlClient || null
    this.amdSmiClient = options.amdSmiClient || null
    this.rocmSmiClient = options.rocmSmiClient || null
    this.current = null
    this.currentCacheKey = null
    this.inFlight = null
    this.inFlightCacheKey = null
    this.providerBackoff = new Map()
    this.providerLogBackoff = new Map()
  }

  isBackedOff(provider) {
    const until = this.providerBackoff.get(provider) || 0
    return Date.now() < until
  }

  backoff(provider, ms = 60000) {
    this.providerBackoff.set(provider, Date.now() + ms)
  }

  logProviderFailure(provider, error, pids, fallbackMessage = "GPU provider unavailable", ms = 60000) {
    const now = Date.now()
    const until = this.providerLogBackoff.get(provider) || 0
    if (now < until) return
    this.providerLogBackoff.set(provider, now + ms)

    const summary = {
      provider,
      platform: this.platform,
      pid_count: normalizePidSet(pids).length,
      error: error && error.message ? error.message : fallbackMessage
    }
    const code = error && (error.code || error.errno || error.status)
    if (code != null) {
      summary.code = String(code)
    }
    try {
      console.warn("[resource-usage:gpu] provider failed", summary)
    } catch (_) {}
  }

  getWindowsPdhClient() {
    if (!this.windowsPdhClient) {
      this.windowsPdhClient = new WindowsPdhGpuMemoryClient()
    }
    return this.windowsPdhClient
  }

  getNvmlClient() {
    if (!this.nvmlClient) {
      this.nvmlClient = new NvmlGpuMemoryClient()
    }
    return this.nvmlClient
  }

  getAmdSmiClient() {
    if (!this.amdSmiClient) {
      this.amdSmiClient = new AmdSmiGpuMemoryClient()
    }
    return this.amdSmiClient
  }

  getRocmSmiClient() {
    if (!this.rocmSmiClient) {
      this.rocmSmiClient = new RocmSmiGpuMemoryClient()
    }
    return this.rocmSmiClient
  }

  async collectWindowsPdh(pids) {
    if (this.platform !== "win32" || this.isBackedOff("windows-pdh")) {
      return null
    }
    try {
      return {
        provider: "windows-pdh",
        processes: this.getWindowsPdhClient().collect(pids),
        error: null
      }
    } catch (error) {
      this.logProviderFailure("windows-pdh", error, pids, "Windows PDH unavailable")
      this.backoff("windows-pdh", 60000)
      return {
        provider: "windows-pdh",
        processes: new Map(),
        error: error && error.message ? error.message : "Windows PDH unavailable"
      }
    }
  }

  async collectLinuxDrmFdinfo(pids) {
    if (this.platform !== "linux" || this.isBackedOff("linux-drm-fdinfo") || pids == null) {
      return null
    }
    const targetPids = normalizePidSet(pids)
    if (targetPids.length === 0) {
      return null
    }
    try {
      const processes = await collectLinuxDrmFdinfoProcesses(targetPids, {
        procRoot: this.procRoot,
        maxPids: this.drmFdinfoMaxPids,
        maxFdsPerPid: this.drmFdinfoMaxFdsPerPid
      })
      if (processes.size === 0) {
        return null
      }
      return {
        provider: "linux-drm-fdinfo",
        processes,
        error: null
      }
    } catch (error) {
      this.logProviderFailure("linux-drm-fdinfo", error, pids, "Linux DRM fdinfo unavailable")
      this.backoff("linux-drm-fdinfo", 60000)
      return {
        provider: "linux-drm-fdinfo",
        processes: new Map(),
        error: error && error.message ? error.message : "Linux DRM fdinfo unavailable"
      }
    }
  }

  async collectNvml(pids) {
    if (this.platform !== "linux" || this.isBackedOff("linux-nvml")) {
      return null
    }
    try {
      return {
        provider: "linux-nvml",
        processes: this.getNvmlClient().collect(pids),
        error: null
      }
    } catch (error) {
      this.logProviderFailure("linux-nvml", error, pids, "Linux NVML unavailable")
      this.backoff("linux-nvml", 60000)
      return null
    }
  }

  async collectAmdSmi(pids) {
    if (this.platform !== "linux" || this.isBackedOff("linux-amdsmi")) {
      return null
    }
    try {
      return {
        provider: "linux-amdsmi",
        processes: this.getAmdSmiClient().collect(pids),
        error: null
      }
    } catch (error) {
      this.logProviderFailure("linux-amdsmi", error, pids, "Linux AMD SMI unavailable")
      this.backoff("linux-amdsmi", 60000)
      return null
    }
  }

  async collectRocmSmi(pids) {
    if (this.platform !== "linux" || this.isBackedOff("linux-rocm-smi")) {
      return null
    }
    try {
      return {
        provider: "linux-rocm-smi",
        processes: this.getRocmSmiClient().collect(pids),
        error: null
      }
    } catch (error) {
      this.logProviderFailure("linux-rocm-smi", error, pids, "Linux ROCm SMI unavailable")
      this.backoff("linux-rocm-smi", 60000)
      return null
    }
  }

  mergeResults(results) {
    const processes = new Map()
    const providers = []
    const errors = []
    for (const result of results) {
      if (!result) continue
      if (result.provider) providers.push(result.provider)
      if (result.error) errors.push({ provider: result.provider, error: result.error })
      for (const entry of result.processes.values()) {
        mergeGpuProcess(processes, entry.pid, entry.usedGpuMemoryBytes)
      }
    }
    return { processes, providers, errors }
  }

  async collect(pids = null) {
    if (this.platform === "darwin") {
      return {
        available: false,
        stale: false,
        collectedAt: Date.now(),
        providers: [],
        processes: new Map(),
        errors: []
      }
    }

    const results = []
    if (this.platform === "win32") {
      const windowsPdh = await this.collectWindowsPdh(pids)
      if (windowsPdh) results.push(windowsPdh)
    } else if (this.platform === "linux") {
      const linuxDrmFdinfo = await this.collectLinuxDrmFdinfo(pids)
      if (linuxDrmFdinfo) results.push(linuxDrmFdinfo)

      let merged = this.mergeResults(results)
      const covered = coveredPids(merged.processes)

      if (hasUncoveredTarget(pids, covered)) {
        const nvml = await this.collectNvml(pids)
        if (nvml) results.push(nvml)
      }

      merged = this.mergeResults(results)
      const afterNvmlCovered = coveredPids(merged.processes)
      if (hasUncoveredTarget(pids, afterNvmlCovered)) {
        const amdSmi = await this.collectAmdSmi(pids)
        if (amdSmi) results.push(amdSmi)
      }

      merged = this.mergeResults(results)
      const afterAmdCovered = coveredPids(merged.processes)
      if (hasUncoveredTarget(pids, afterAmdCovered)) {
        const rocmSmi = await this.collectRocmSmi(pids)
        if (rocmSmi) results.push(rocmSmi)
      }
    }

    const { processes, providers, errors } = this.mergeResults(results)
    return {
      available: providers.length > 0 && errors.length < providers.length,
      stale: false,
      collectedAt: Date.now(),
      providers,
      processes,
      errors
    }
  }

  async getSnapshot(pids = null) {
    const now = Date.now()
    const cacheKey = this.platform === "darwin" ? "" : normalizePidSet(pids).join(",")
    if (this.current && this.currentCacheKey === cacheKey && now - this.current.collectedAt < this.ttlMs) {
      return this.current
    }
    if (this.inFlight && this.inFlightCacheKey === cacheKey) {
      return this.inFlight
    }
    this.inFlightCacheKey = cacheKey
    this.inFlight = this.collect(pids).then((snapshot) => {
      this.current = snapshot
      this.currentCacheKey = cacheKey
      return snapshot
    }).catch((error) => {
      this.logProviderFailure("gpu", error, pids, "GPU sampling unavailable")
      if (this.current) {
        return { ...this.current, stale: true }
      }
      return {
        available: false,
        stale: false,
        collectedAt: Date.now(),
        providers: [],
        processes: new Map(),
        errors: [{ provider: "gpu", error: error && error.message ? error.message : String(error) }]
      }
    }).finally(() => {
      this.inFlight = null
      this.inFlightCacheKey = null
    })
    return this.inFlight
  }

  stop() {
    for (const client of [this.windowsPdhClient, this.nvmlClient, this.amdSmiClient, this.rocmSmiClient]) {
      if (client && typeof client.stop === "function") {
        client.stop()
      }
    }
  }
}

function sumGpuMemory(snapshot, pids) {
  const processes = snapshot && snapshot.processes instanceof Map ? snapshot.processes : new Map()
  let bytes = 0
  for (const pid of pids || []) {
    const entry = processes.get(pid)
    if (!entry) continue
    bytes += entry.usedGpuMemoryBytes || 0
  }
  return { bytes }
}

module.exports = {
  GpuSampler,
  WindowsPdhGpuMemoryClient,
  NvmlGpuMemoryClient,
  AmdSmiGpuMemoryClient,
  RocmSmiGpuMemoryClient,
  parseMemoryToBytes,
  decodeWindowsMultiSz,
  extractPidFromWindowsGpuInstance,
  collectLinuxDrmFdinfoProcesses,
  isDedicatedDrmMemoryRegion,
  parseLinuxDrmFdinfo,
  sumGpuMemory
}
