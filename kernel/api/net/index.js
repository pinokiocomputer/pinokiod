const axios = require('axios')
module.exports = async (req, ondata, kernel) => {
  const response = await axios(req.params)
  return response.data
}
