const assert = require("node:assert/strict")
const os = require("node:os")
const test = require("node:test")

const procsPath = require.resolve("../kernel/procs")

function loadProcsForPlatform(platform) {
  const originalPlatform = os.platform
  delete require.cache[procsPath]
  os.platform = () => platform
  try {
    return require("../kernel/procs")
  } finally {
    os.platform = originalPlatform
    delete require.cache[procsPath]
  }
}

test("Windows process parser only probes listening TCP rows", async () => {
  const Procs = loadProcsForPlatform("win32")
  const procs = new Procs({})
  const probed = []

  procs.isHttp = async (host, port) => {
    probed.push(`${host}:${port}`)
    return true
  }

  const stdout = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       1111",
    "  TCP    127.0.0.1:49153        127.0.0.1:5173         ESTABLISHED     2222",
    "  TCP    0.0.0.0:7860           0.0.0.0:0              LISTENING       3333",
    "  TCP    [::1]:11434            [::]:0                 LISTENING       4444"
  ].join("\n")

  const results = await procs.get_pids(stdout)

  assert.deepEqual(probed, [
    "127.0.0.1:5173",
    "0.0.0.0:7860",
    "::1:11434"
  ])
  assert.deepEqual(results.map((item) => `${item.pid}:${item.ip}`), [
    "1111:127.0.0.1:5173",
    "3333:0.0.0.0:7860",
    "4444:[::1]:11434"
  ])
})
