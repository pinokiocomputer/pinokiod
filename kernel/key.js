const { createStore } = require('key-store')
class Key {
  async init(filePath) {
    const saveKeys = (data) => {
      return fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
    }
    const readKeys = async () => {
      try {
        let s = await fs.promises.readFile(filePath, "utf8")
        return JSON.parse(s)
      } catch (e) {
        return {}
      }
    }
    let keys = await readKeys()

    this.store = await createStore(saveKeys, keys)
  }
  keys() {
    return this.store.getKeyIDs()
  }
  get(key, password) {
    if (password) {
      return this.store.getPrivateKeyData(key, password)
    } else {
      return this.store.getPublicKeyData(key)
    }
  }
  set(key, val, password) {
    if (password) {
      console.log({ key, val, password})
      return this.store.saveKey(key, password, String(val))
    } else {
      console.log({ key, val})
      //return this.store.savePublicKeyData(key, String(val))
      return this.store.saveKey(key, "", "", String(val))
    }
  }
  del(key) {
    this.store.removeKey(key)
  }
}
module.exports = Key
