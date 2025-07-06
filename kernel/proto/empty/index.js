const fs = require('fs')
const path = require('path')
module.exports = async (req, ondata, kernel) => {
  //config._basePath = req.input.paths[0]
  //await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true, force: true })
  //await fs.promises.writeFile(path.resolve(req.cwd, "docs/docsify.config.json"), JSON.stringify(config, null, 2))

  await kernel.download({
    uri: "https://raw.githubusercontent.com/pinokiocomputer/home/refs/heads/main/docs/README.md",
    path: req.cwd,
    filename: "PINOKIO.md"
  }, ondata)
  
  await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true, force: true })
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "CLAUDE.md"))
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "GEMINI.md"))
  await fs.promises.rename(path.resolve(req.cwd, "gitignore"), path.resolve(req.cwd, ".gitignore"))
}
