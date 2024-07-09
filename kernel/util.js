const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const parse_env = async (filename) => {
  try {
    const buf = await fs.promises.readFile(filename)
    const config = dotenv.parse(buf) // will return an object
    return config
  } catch (e) {
    return {}
  }
}
const api_path = async (fullpath, kernel) => {
  let api_path = `${kernel.homedir}${path.sep}api`
  let rel_path = path.relative(api_path, fullpath)
  let api_name = rel_path.split(path.sep)[0]
  let current_api_path = `${api_path}${path.sep}${api_name}`
  return current_api_path
}
module.exports = {
  parse_env, api_path
}
