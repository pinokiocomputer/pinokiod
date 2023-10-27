const axios = require('axios')
const fakeUa = require('fake-useragent');
axios.defaults.headers.common['User-Agent'] = fakeUa()
module.exports = async (req, ondata, kernel) => {
  const response = await axios(req.params)
  return response.data
}
