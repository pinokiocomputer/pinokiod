if (process.platform !== "win32") {
  process.exit(2)
}

const koffi = require("koffi")
const kernel32 = koffi.load("kernel32.dll")
const loadLibrary = kernel32.func("void * __stdcall LoadLibraryW(str16 path)")
const freeLibrary = kernel32.func("int32_t __stdcall FreeLibrary(void *module)")

const moduleHandle = loadLibrary(process.argv[2])
if (!moduleHandle) {
  process.stderr.write("LoadLibraryW failed\n")
  process.exit(1)
}

process.stdout.write("READY\n")
process.stdin.resume()
process.stdin.once("data", () => {
  freeLibrary(moduleHandle)
  process.exit(0)
})
