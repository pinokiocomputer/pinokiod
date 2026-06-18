const assert = require("node:assert/strict")
const test = require("node:test")

const {
  GpuSampler,
  parseNvidiaCsv,
  parseWindowsGpuProcessMemoryCsv
} = require("../kernel/resource_usage/gpu")

const MIB = 1024 * 1024

function gpuProcess(pid, bytes) {
  return {
    pid,
    usedGpuMemoryBytes: bytes
  }
}

test("parseNvidiaCsv treats nounits memory as MiB and sums duplicate PIDs", () => {
  const processes = parseNvidiaCsv([
    "1234, 256",
    "1234, 128",
    "5678, N/A"
  ].join("\n"))

  assert.equal(processes.get(1234).usedGpuMemoryBytes, 384 * MIB)
  assert.equal(processes.has(5678), false)
})

test("parseWindowsGpuProcessMemoryCsv extracts dedicated GPU bytes from process counter instances", () => {
  const processes = parseWindowsGpuProcessMemoryCsv([
    "\"(PDH-CSV 4.0)\",\"\\\\HOST\\GPU Process Memory(pid_1234_luid_0x00000000_0x00011111_phys_0)\\Dedicated Usage\",\"\\\\HOST\\GPU Process Memory(pid_1234_luid_0x00000000_0x00011111_phys_1)\\Dedicated Usage\",\"\\\\HOST\\GPU Process Memory(_total)\\Dedicated Usage\"",
    "\"06/18/2026 12:00:00.000\",\"268435456.000000\",\"134217728.000000\",\"1047527424.000000\"",
    "The command completed successfully."
  ].join("\r\n"))

  assert.equal(processes.get(1234).usedGpuMemoryBytes, 384 * MIB)
  assert.equal(processes.has(999), false)
})

test("GpuSampler uses Windows GPU counters before nvidia-smi on Windows", async () => {
  const sampler = new GpuSampler({ platform: "win32" })
  let nvidiaCalls = 0
  sampler.collectWindowsGpuProcessMemory = async () => {
    return {
      provider: "windows-gpu-process-memory",
      processes: new Map([
        [1234, gpuProcess(1234, 500 * MIB)]
      ]),
      error: null
    }
  }
  sampler.collectNvidia = async () => {
    nvidiaCalls += 1
    return {
      provider: "nvidia-smi",
      processes: new Map([
        [1234, gpuProcess(1234, 500 * MIB)]
      ]),
      error: null
    }
  }
  sampler.collectAmd = async () => null

  const snapshot = await sampler.collect()

  assert.equal(nvidiaCalls, 0)
  assert.deepEqual(snapshot.providers, ["windows-gpu-process-memory"])
  assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 500 * MIB)
})

test("GpuSampler does not query nvidia-smi on Windows when OS counters fail", async () => {
  const sampler = new GpuSampler({ platform: "win32" })
  let nvidiaCalls = 0
  sampler.collectWindowsGpuProcessMemory = async () => ({
    provider: "windows-gpu-process-memory",
    processes: new Map(),
    error: "counter unavailable"
  })
  sampler.collectNvidia = async () => {
    nvidiaCalls += 1
    return {
      provider: "nvidia-smi",
      processes: new Map([
        [1234, gpuProcess(1234, 300 * MIB)]
      ]),
      error: null
    }
  }
  sampler.collectAmd = async () => null

  const snapshot = await sampler.collect()

  assert.equal(nvidiaCalls, 0)
  assert.equal(snapshot.available, false)
  assert.deepEqual(snapshot.providers, ["windows-gpu-process-memory"])
  assert.equal(snapshot.processes.has(1234), false)
})

test("GpuSampler merges overlapping provider samples by PID without double-counting", async () => {
  const sampler = new GpuSampler({ platform: "linux" })
  sampler.collectNvidia = async () => ({
    provider: "nvidia-smi",
    processes: new Map([
      [1234, gpuProcess(1234, 300 * MIB)],
      [3333, gpuProcess(3333, 200 * MIB)]
    ]),
    error: null
  })
  sampler.collectAmd = async () => ({
    provider: "amd-smi",
    processes: new Map([
      [1234, gpuProcess(1234, 500 * MIB)],
      [2222, gpuProcess(2222, 100 * MIB)]
    ]),
    error: null
  })

  const snapshot = await sampler.collect()

  assert.equal(snapshot.available, true)
  assert.deepEqual(snapshot.providers, ["nvidia-smi", "amd-smi"])
  assert.equal(snapshot.processes.get(1234).usedGpuMemoryBytes, 500 * MIB)
  assert.equal(snapshot.processes.get(2222).usedGpuMemoryBytes, 100 * MIB)
  assert.equal(snapshot.processes.get(3333).usedGpuMemoryBytes, 200 * MIB)
})
