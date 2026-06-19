const BaseAdapter = require('./base')

class UnsupportedAdapter extends BaseAdapter {
  constructor(kernel) {
    super(kernel)
    this.reason = `App launching is not supported on platform ${this.platform}`
  }

  async buildIndex() {
    this.entries.clear()
  }

  async search() {
    throw new Error(this.reason)
  }

  async info() {
    throw new Error(this.reason)
  }

  async refresh() {
    throw new Error(this.reason)
  }

  async launch() {
    throw new Error(this.reason)
  }

  async launchUnknown() {
    throw new Error(this.reason)
  }
}

module.exports = UnsupportedAdapter
