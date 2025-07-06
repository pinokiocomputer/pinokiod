const fs = require('fs')
const path = require('path')
module.exports = async (req, ondata, kernel) => {
  await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true })
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "CLAUDE.md"))
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "GEMINI.md"))
  await fs.promises.rename(path.resolve(req.cwd, "gitignore"), path.resolve(req.cwd, ".gitignore"))

  // install script
  let install = {
    run: [{
      method: "shell.run",
      params: {
        message: req.input.installCommand,
        path: req.input.installPath || req.cwd
      }
    }]
  }
  if (req.input.venv) {
    install.run[0].params.venv = "venv"
  }
  await fs.promises.writeFile(path.resolve(req.cwd, "install.json"), JSON.stringify(install, null, 2))

  // start script
  let start = {
    run: [{
      method: "shell.run",
      params: {
        input: true,
        message: req.input.installableLaunchCommand,
        path: req.input.launchPath || req.cwd
      }
    }]
  }
  if (req.input.venv) {
    start.run[0].params.venv = "venv"
  }
  await fs.promises.writeFile(path.resolve(req.cwd, "start.json"), JSON.stringify(start, null, 2))

  // git
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
