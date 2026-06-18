const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  GpuSampler,
  NvmlGpuMemoryClient,
  collectLinuxDrmFdinfoProcesses,
  decodeWindowsMultiSz,
  extractPidFromWindowsGpuInstance,
  isDedicatedDrmMemoryRegion,
  parseLinuxDrmFdinfo
} = require("../kernel/resource_usage/gpu")

const MIB = 1024 * 1024

function gpuProcess(pid, bytes) {
  return {
    pid,
    usedGpuMemoryBytes: bytes
  }
}

test("extractPidFromWindowsGpuInstance handles full PDH counter paths", () => {
  assert.equal(extractPidFromWindowsGpuInstance("app_pid_3456_phys_0"), 3456)
  assert.equal(extractPidFromWindowsGpuInstance("\\\\HOST\\GPU Process Memory(pid_1234_luid_0x00000000_phys_0)\\Dedicated Usage"), 1234)
  assert.equal(extractPidFromWindowsGpuInstance("\\\\HOST\\GPU Process Memory(_total)\\Dedicated Usage"), null)
})

test("decodeWindowsMultiSz decodes double-null UTF-16 string lists", () => {
  const text = "one\u0000two\u0000\u0000"
  const buffer = Buffer.from(text, "utf16le")

  assert.deepEqual(decodeWindowsMultiSz(buffer, text.length), ["one", "two"])
})

test("parseLinuxDrmFdinfo counts dedicated DRM memory regions only", () => {
  const amdgpu = parseLinuxDrmFdinfo([
    "drm-driver:\tamdgpu",
    "drm-pdev:\t0000:03:00.0",
    "drm-client-id:\t17",
    "drm-memory-vram:\t4 MiB",
    "drm-memory-gtt:\t128 MiB"
  ].join("\n"))

  const intel = parseLinuxDrmFdinfo([
    "drm-driver:\ti915",
    "drm-pdev:\t0000:00:02.0",
    "drm-client-id:\t9",
    "drm-resident-local0:\t8 MiB",
    "drm-resident-system:\t64 MiB"
  ].join("\n"))

  assert.equal(amdgpu.dedicatedBytes, 4 * MIB)
  assert.equal(intel.dedicatedBytes, 8 * MIB)
  assert.equal(isDedicatedDrmMemoryRegion("vram"), true)
  assert.equal(isDedicatedDrmMemoryRegion("local0"), true)
  assert.equal(isDedicatedDrmMemoryRegion("gtt"), false)
  assert.equal(isDedicatedDrmMemoryRegion("system"), false)
})

test("collectLinuxDrmFdinfoProcesses deduplicates DRM client fds", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-drm-fdinfo-"))
  try {
    await fs.promises.mkdir(path.join(root, "1234", "fdinfo"), { recursive: true })
    await fs.promises.mkdir(path.join(root, "5678", "fdinfo"), { recursive: true })
    await fs.promises.writeFile(path.join(root, "1234", "fdinfo", "3"), [
      "drm-driver:\tamdgpu",
      "drm-pdev:\t0000:03:00.0",
      "drm-client-id:\t17",
      "drm-resident-vram:\t12 MiB"
    ].join("\n"))
    await fs.promises.writeFile(path.join(root, "1234", "fdinfo", "4"), [
      "drm-driver:\tamdgpu",
      "drm-pdev:\t0000:03:00.0",
      "drm-client-id:\t17",
      "drm-resident-vram:\t11 MiB"
    ].join("\n"))
    await fs.promises.writeFile(path.join(root, "1234", "fdinfo", "5"), [
      "drm-driver:\tamdgpu",
      "drm-pdev:\t0000:03:00.0",
      "drm-client-id:\t18",
      "drm-resident-vram:\t5 MiB"
    ].join("\n"))
    await fs.promises.writeFile(path.join(root, "5678", "fdinfo", "9"), [
      "drm-driver:\tamdgpu",
      "drm-pdev:\t0000:03:00.0",
      "drm-client-id:\t22",
      "drm-resident-gtt:\t64 MiB"
    ].join("\n"))

    const processes = await collectLinuxDrmFdinfoProcesses([1234, 5678], { procRoot: root })

    assert.equal(processes.get(1234).usedGpuMemoryBytes, 17 * MIB)
    assert.equal(processes.has(5678), false)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test("GpuSampler uses Windows PDH only on Windows", async () => {
  const sampler = new GpuSampler({
    platform: "win32",
    windowsPdhClient: {
      collect: () => new Map([
        [1234, gpuProcess(1234, 500 * MIB)]
      ])
    }
  })

  const snapshot = await sampler.collect(new Set([1234]))

  assert.equal(snapshot.available, true)
  assert.deepEqual(snapshot.providers, ["windows-pdh"])
  assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 500 * MIB)
})

test("GpuSampler reports Windows VRAM unavailable when PDH fails", async () => {
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    const sampler = new GpuSampler({
      platform: "win32",
      windowsPdhClient: {
        collect: () => {
          throw new Error("pdh unavailable")
        }
      }
    })

    const snapshot = await sampler.collect(new Set([1234]))

    assert.equal(snapshot.available, false)
    assert.deepEqual(snapshot.providers, ["windows-pdh"])
    assert.equal(snapshot.processes.size, 0)
    assert.equal(snapshot.errors[0].provider, "windows-pdh")
  } finally {
    console.warn = originalWarn
  }
})

test("GpuSampler logs provider failures once per backoff window", async () => {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => {
    warnings.push(args)
  }

  try {
    const sampler = new GpuSampler({
      platform: "win32",
      windowsPdhClient: {
        collect: () => {
          const error = new Error("pdh unavailable")
          error.code = "PDH_TEST"
          throw error
        }
      }
    })

    await sampler.collect(new Set([1234]))
    await sampler.collect(new Set([1234]))

    assert.equal(warnings.length, 1)
    assert.equal(warnings[0][0], "[resource-usage:gpu] provider failed")
    assert.deepEqual(warnings[0][1], {
      provider: "windows-pdh",
      platform: "win32",
      pid_count: 1,
      error: "pdh unavailable",
      code: "PDH_TEST"
    })
  } finally {
    console.warn = originalWarn
  }
})

test("GpuSampler uses Linux DRM fdinfo before native library providers", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pinokio-drm-sampler-"))
  try {
    await fs.promises.mkdir(path.join(root, "1234", "fdinfo"), { recursive: true })
    await fs.promises.writeFile(path.join(root, "1234", "fdinfo", "3"), [
      "drm-driver:\ti915",
      "drm-pdev:\t0000:00:02.0",
      "drm-client-id:\t4",
      "drm-resident-local0:\t32 MiB"
    ].join("\n"))

    const sampler = new GpuSampler({ platform: "linux", procRoot: root })
    let nvmlCalls = 0
    let amdCalls = 0
    let rocmCalls = 0
    sampler.collectNvml = async () => {
      nvmlCalls += 1
      return null
    }
    sampler.collectAmdSmi = async () => {
      amdCalls += 1
      return null
    }
    sampler.collectRocmSmi = async () => {
      rocmCalls += 1
      return null
    }

    const snapshot = await sampler.collect(new Set([1234]))

    assert.equal(nvmlCalls, 0)
    assert.equal(amdCalls, 0)
    assert.equal(rocmCalls, 0)
    assert.deepEqual(snapshot.providers, ["linux-drm-fdinfo"])
    assert.equal(snapshot.available, true)
    assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 32 * MIB)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test("GpuSampler uses NVML when fdinfo does not cover target PID", async () => {
  const sampler = new GpuSampler({
    platform: "linux",
    nvmlClient: {
      collect: () => new Map([
        [1234, gpuProcess(1234, 700 * MIB)]
      ])
    }
  })
  sampler.collectLinuxDrmFdinfo = async () => null
  let amdCalls = 0
  sampler.collectAmdSmi = async () => {
    amdCalls += 1
    return null
  }

  const snapshot = await sampler.collect(new Set([1234]))

  assert.equal(amdCalls, 0)
  assert.deepEqual(snapshot.providers, ["linux-nvml"])
  assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 700 * MIB)
})

test("NvmlGpuMemoryClient sums the same PID across devices", () => {
  const client = new NvmlGpuMemoryClient({ koffi: { sizeof: () => 1 } })
  const compute = { name: "compute" }
  const graphics = { name: "graphics" }
  client.init = () => {}
  client.getDeviceHandles = () => ["gpu0", "gpu1"]
  client.functions = { compute, graphics, mps: null }
  client.collectProcessList = (device, entry) => {
    const samples = {
      "gpu0:compute": [{ pid: 1234, usedGpuMemory: 300 * MIB }],
      "gpu0:graphics": [{ pid: 1234, usedGpuMemory: 250 * MIB }],
      "gpu1:compute": [{ pid: 1234, usedGpuMemory: 400 * MIB }],
      "gpu1:graphics": [{ pid: 1234, usedGpuMemory: 100 * MIB }]
    }
    return samples[`${device}:${entry && entry.name}`] || []
  }

  const processes = client.collect([1234])

  assert.equal(processes.get(1234).usedGpuMemoryBytes, 700 * MIB)
})


test("GpuSampler uses AMD SMI after fdinfo and NVML miss", async () => {
  const sampler = new GpuSampler({
    platform: "linux",
    amdSmiClient: {
      collect: () => new Map([
        [2222, gpuProcess(2222, 300 * MIB)]
      ])
    }
  })
  sampler.collectLinuxDrmFdinfo = async () => null
  sampler.collectNvml = async () => null
  let rocmCalls = 0
  sampler.collectRocmSmi = async () => {
    rocmCalls += 1
    return null
  }

  const snapshot = await sampler.collect(new Set([2222]))

  assert.equal(rocmCalls, 0)
  assert.deepEqual(snapshot.providers, ["linux-amdsmi"])
  assert.equal(snapshot.processes.get(2222).usedGpuMemoryBytes, 300 * MIB)
})

test("GpuSampler uses ROCm SMI after AMD SMI misses", async () => {
  const sampler = new GpuSampler({
    platform: "linux",
    rocmSmiClient: {
      collect: () => new Map([
        [3333, gpuProcess(3333, 200 * MIB)]
      ])
    }
  })
  sampler.collectLinuxDrmFdinfo = async () => null
  sampler.collectNvml = async () => null
  sampler.collectAmdSmi = async () => null

  const snapshot = await sampler.collect(new Set([3333]))

  assert.deepEqual(snapshot.providers, ["linux-rocm-smi"])
  assert.equal(snapshot.processes.get(3333).usedGpuMemoryBytes, 200 * MIB)
})

test("GpuSampler merges overlapping provider samples by PID without double-counting", async () => {
  const sampler = new GpuSampler({ platform: "linux" })
  sampler.collectLinuxDrmFdinfo = async () => ({
    provider: "linux-drm-fdinfo",
    processes: new Map([
      [1234, gpuProcess(1234, 300 * MIB)]
    ]),
    error: null
  })
  sampler.collectNvml = async () => ({
    provider: "linux-nvml",
    processes: new Map([
      [1234, gpuProcess(1234, 500 * MIB)],
      [3333, gpuProcess(3333, 200 * MIB)]
    ]),
    error: null
  })
  sampler.collectAmdSmi = async () => null
  sampler.collectRocmSmi = async () => null

  const snapshot = await sampler.collect()

  assert.equal(snapshot.available, true)
  assert.deepEqual(snapshot.providers, ["linux-drm-fdinfo", "linux-nvml"])
  assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 500 * MIB)
  assert.equal(snapshot.processes.get(3333).usedGpuMemoryBytes, 200 * MIB)
})

test("GpuSampler does not collect VRAM providers on macOS", async () => {
  const sampler = new GpuSampler({ platform: "darwin" })
  sampler.collectNvml = async () => {
    throw new Error("NVML should not be queried on macOS")
  }
  sampler.collectAmdSmi = async () => {
    throw new Error("AMD SMI should not be queried on macOS")
  }

  const snapshot = await sampler.collect()

  assert.equal(snapshot.available, false)
  assert.deepEqual(snapshot.providers, [])
  assert.equal(snapshot.processes.size, 0)
})
