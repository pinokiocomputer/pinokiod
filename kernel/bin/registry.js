class Registry {
  description = "Look for a dialog requesting admin permission and approve it to proceed. This will allow long paths on your machine, which is required for installing certain python packages."
  async installed(force) {
    if (!force && '_installed' in this) {
      console.log("this._installed already determined", this._installed)
      return this._installed
    }

    let res = await this.kernel.bin.exec({
      message: "reg query HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled",
      conda: {
        skip: true
      }
    }, (stream) => {
    })
    console.log("registry check", { res })
    const output = (res && (res.response || res.stdout)) || ""
    const matches = /LongPathsEnabled\s+REG_DWORD\s+([^\s]+)/i.exec(output)
    console.log("matches", matches)
    if (matches && matches[1]) {
      const parsed = parseInt(matches[1], 0)
      this._installed = Number.isFinite(parsed) && parsed === 1
    } else {
      this._installed = false
    }
    return this._installed
  }
  async install(req, ondata) {
    // 1. Set registry to allow long paths
    let res = await this.kernel.bin.exec({
      message: "reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f",
      sudo: true
    }, (stream) => {
      ondata(stream)
    })
    await this.installed(true)  // force refresh
    return res
  }
}
module.exports = Registry
