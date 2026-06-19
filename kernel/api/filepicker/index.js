/*
{
  method: "filepicker.open",
  params: {
    title,             := <dialog title>
    type,              := folder | file (default)
    path,               := <cwd to open from>
    filetype,         := <file types to accept> can be an array or string (example: `image/*.png,*.jpg` or `["image/*.png", "docs/*.pdf"]`)
    filetypes,         := <file types to accept> (example:   [["Images", "*.png *.jpg *.jpeg"]] )
    multiple,          := True | False (allow multiple)
    save,              := True | False ('save as' dialog, which lets the user select a file name)
    initialfile,       := In case of "save=True", set the default filename
    confirmoverwrite,  := True | False (if set to true, will warn if the selected file name exists, for save=True type dialogs)
  }
}


returns an array of selected file paths

returns: {
  paths: [
    ...,
    ....
  ]
}

*/
const path = require('path')
const Util = require("../../util")
class Filepicker {
  async open(req, ondata, kernel) {
    if (req.params.cwd) {
      req.params.cwd = path.resolve(req.cwd, req.params.cwd)
    } else if (req.params.path) {
      req.params.cwd = path.resolve(req.cwd, req.params.path)
    } else {
      req.params.cwd = req.cwd
    }

    let res = await Util.filepicker(req, ondata, kernel)
    return res

  }
}
module.exports = Filepicker
