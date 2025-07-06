const fs = require('fs')
const path = require('path')
module.exports = async (req, ondata, kernel) => {
  /*
  req.input := {
    url,
    launch_command,
    launch_path,
    install_command,
    install_path
  }
  */
  console.log("REQ", req)
  await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true })
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "CLAUDE.md"))
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "GEMINI.md"))

  if (req.input.pythonOptions && req.input.pythonOptions.length > 0) {
    if (req.input.pythonOptions.includes("torch")) {
      console.log("torch included")
      await fs.promises.cp(path.resolve(__dirname, "install_with_torch.js"), path.resolve(req.cwd, "install.js"))
    }
    if (req.input.pythonOptions.includes("gradio")) {
      console.log("gradio included")
      await fs.promises.writeFile(path.resolve(req.cwd, "app", "requirements.txt"), "gradio\n")
    }
  }
  await fs.promises.rename(path.resolve(req.cwd, "gitignore"), path.resolve(req.cwd, ".gitignore"))
  await kernel.exec({
    message: [
      "git init",
      "git add .",
      "git commit -am init"
    ],
    path: req.cwd
  }, (e) => {
    ondata(e) 
  })
}
