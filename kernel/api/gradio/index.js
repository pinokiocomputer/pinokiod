const path = require('path')
const { client } = require('node-gradio-client')
class Gradio {
  /*
  {
    "method": "gradio.predict",
    "params": {
      uri: <uri>,
      path: "/answer_question_1"
      //on: "{{payload.data.translation}}"
      params: [
        { image: <filepath> }, 
        { video: <uri> },
        <str>
      ]
    }
  }
  */
  async predict(req, ondata, kernel) {
    const app = await client(req.params.uri)
    let args = req.params.params
    let res = await app.predict(req.params.path, args)
    return res
  }
}
module.exports = Gradio
