const path = require('path')
const { spawn } = require("child_process");
/*
{
  method: "filepicker.open",
  params: {
    title,             := <dialog title>
    type,              := folder | file (default)
    path,               := <cwd to open from>
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
class Filepicker {
  async open(req, ondata, kernel) {
    if (req.params.cwd) {
      req.params.cwd = path.resolve(req.cwd, req.params.cwd)
    } else if (req.params.path) {
      req.params.cwd = path.resolve(req.cwd, req.params.path)
    } else {
      req.params.cwd = req.cwd
    }
    let response = await new Promise((resolve, reject) => {
      let picker_path = kernel.path("bin/py/picker.py")
      const proc = spawn("python", [picker_path])

      let output = "";
      proc.stdout.on("data", (chunk) => output += chunk);
      proc.stderr.on("data", (err) => console.error("Python error:", err.toString()));
      proc.on("close", () => {
        try {
          const result = JSON.parse(output);
          if (result.error) return reject(result.error);
          resolve(result.paths); // Always an array
        } catch (e) {
          reject("Failed to parse Python output: " + output);
        }
      });

      proc.stdin.write(JSON.stringify(req.params));
      proc.stdin.end();
    });
    return { paths: response }
  }
}
module.exports = Filepicker
