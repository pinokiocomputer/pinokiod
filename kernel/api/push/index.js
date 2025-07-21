/*
  {
    method: "push",
    params: {
      title: <string>,
      subtitle: <string>, 
      message: <string>,
      image: <image path>,
      sound: true|false,
    }
  }
(*/
const util = require('../../util')
const path = require('path');
module.exports = async (req, ondata, kernel) => {
  let params = req.params
  if (params.image) {
    params.image = path.resolve(req.cwd, params.image)
  }
  util.push(params)
}
