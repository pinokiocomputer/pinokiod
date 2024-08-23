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
    //let matches = /(LongPathsEnabled.+)[\r\n]+/.exec(res.response)
    let matches = /(LongPathsEnabled.+REG_DWORD.+)[\r\n]+/.exec(res.response)
    console.log("matches", matches)
    if (matches && matches.length > 0) {
      let chunks = matches[1].split(/\s+/)
      console.log("chunks", chunks)
      if (chunks.length === 3) {
        if (Number(chunks[2]) === 1) {
          this._installed = true
        } else {
          this._installed = false
        }
      } else {
        this._installed = false
      }
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
