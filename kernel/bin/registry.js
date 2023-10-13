class Registry {
  async installed() {
    let res = await this.kernel.bin.exec({
      message: "reg query HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled",
    }, (stream) => {
      ondata(stream)
    })
    console.log("RES", res)
    return res
  }
  async install(req, ondata) {
    // 1. Set registry to allow long paths
    let res = await this.kernel.bin.exec({
      message: "reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f",
      sudo: true
    }, (stream) => {
      ondata(stream)
    })
    return res
  }
}
module.exports = Registry
