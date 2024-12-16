const fs = require("fs")
const { parse } = require("csv-parse")
const YAML = require("yaml")
const path = require("path")
const clearModule = require('clear-module');

class Loader {
  async load(_path) {
    let resolved
    let dirname
    let extension = path.extname(_path)
    clearModule(_path)

    if (/\.json$/i.test(_path)) {
      resolved = await this.requireJSON(_path)
      dirname = path.dirname(_path)
    } else if (/\.js$/i.test(_path)) {
      resolved = await this.requireJS(_path)
      dirname = path.dirname(_path)
//    } else if (/\.(csv|txt)$/i.test(_path)) {
//      resolved = await this.requireCSV(_path)
//    } else if (/\.(yaml|yml)$/.test(_path)) {
//      resolved = await this.requireYAML(_path)
    } else {
      // load JS if directory
      try {
        let stat = await fs.promises.stat(_path)
        if (stat.isDirectory()) {
          resolved = await this.requireJS(_path)
          dirname = _path
        } else {
          resolved = null
        }
      } catch (e) {
        console.log(e)
        resolved = null
      }
    }
    return { resolved, extension, dirname }
  }
  async requireJSON(filepath) {
    let config
    try { config = require(filepath) } catch (e) {
      console.log("load error", filepath, e)
    }
    return config
  }
  async requireJS(filepath) {
    let config
    try { config = require(filepath) } catch (e) {
      console.log("load error", filepath, e)
    }
    try {
      // if the required module is a class, return the instantiated object
      return new config();
    } catch (e) {
      // otherwise return normally
      return config
    }
  }
  async requireYAML(filepath) {
    const str = await fs.promises.readFile(filepath, "utf8")
    const parsed = YAML.parse(str)
    return parsed
  }
  async requireCSV(filepath) {
    const str = await fs.promises.readFile(filepath, "utf8")
    let result = await new Promise((resolve, reject) => {
      parse(str, {
        columns: true,
        skip_empty_lines: true
      }, (err, records) => {
        if (err) {
          reject(err)
        } else {
          resolve(records)
        }
      });
    })
    return result
  }
}
module.exports = Loader
