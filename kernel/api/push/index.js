/*
  {
    method: "push",
  params: {
      title: <string>,
      subtitle: <string>, 
      message: <string>,
      image: <image path>,
      sound: true|false|string,
  }
}
(*/
const util = require('../../util')
const path = require('path');
module.exports = async (req, ondata, kernel) => {
  const params = { ...(req.params || {}) }
  if (typeof params.image === 'string') {
    params.image = path.resolve(req.cwd, params.image)
  }
  if (typeof params.sound === 'string') {
    const trimmed = params.sound.trim()
    params.sound = trimmed || undefined
  }
  util.push(params)
}
