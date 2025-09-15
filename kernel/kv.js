class KV {
  constructor(kernel) {
    this.kernel = kernel
  }
  async set(host, val, index) {
    if (this.kernel.homedir) {
      let filePath = this.kernel.path("key.json")
      let json = await this.kernel.load(filePath)
      if (!json) json = {}
      // if the array at host path doesn't exist, create an empty array
      if (!json[host]) {
        json[host] = []
      }
      // if index doesn't exist, set index 0
      if (!index) {
        index = 0
      }
      json[host][index] = val
      await fs.promises.writeFile(filePath, JSON.stringify(json, null, 2), 'utf8')
    }
  }
  async get(host, index) {
    if (this.kernel.homedir) {
      let filePath = this.kernel.path("key.json")
      let json = await this.kernel.load(filePath)
      if (!json) {
        return null
      }
      if (json[host]) {
        return json[host][index]
      }
    }
    return null
  }
}
module.exports = KV
