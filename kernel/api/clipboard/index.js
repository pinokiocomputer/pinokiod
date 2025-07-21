const Util = require("../../util")
/*
{
  "run": [
    {
      "method": "clipboard.copy",
      "params": {
        "text": "hello world"
      }
    },
    {
      "method": "clipboard.paste"
    },
    {
      "method": "log",
      "params": {
        "raw": "{{input}}"
      }
    }
  ]
}
*/
class Clipboard {
  /*
    method: "clipboard.copy",
    params: {
      text: <text>
    }
  */
  async copy(req, ondata, kernel) {
    await Util.clipboard({
      type: "copy",
      text: req.params.text
    })
  }
  async paste(req, ondata, kernel) {
    let text = await Util.clipboard({
      type: "paste",
    })
    return text
  }
}
module.exports = Clipboard
