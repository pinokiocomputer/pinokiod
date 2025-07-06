const fs = require('fs')
const path = require('path')
module.exports = async (req, ondata, kernel) => {
  //config._basePath = req.input.paths[0]
  //await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true, force: true })
  //await fs.promises.writeFile(path.resolve(req.cwd, "docs/docsify.config.json"), JSON.stringify(config, null, 2))
  
  await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true, force: true })
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "CLAUDE.md"))
  await fs.promises.cp(path.resolve(__dirname, "template/AGENTS.md"), path.resolve(req.cwd, "GEMINI.md"))
  await fs.promises.rename(path.resolve(req.cwd, "gitignore"), path.resolve(req.cwd, ".gitignore"))
  await fs.promises.cp(req.input.paths[0], path.resolve(req.cwd, 'docs/repo'), { recursive: true, force: true })

  config.basePath = "/repo/"
  await fs.promises.writeFile(path.resolve(req.cwd, "docs/docsify.config.json"), JSON.stringify(config, null, 2))

  // copy templates
  await fs.promises.cp(path.resolve(__dirname, "template"), req.cwd, { recursive: true, force: true })

  // clone into the docs folder
  await kernel.exec({
    message: `git clone ${req.input.url} repo`,
    path: path.resolve(req.cwd, "docs")
  }, ondata)

  // update the basePath to repo
  config.basePath = "/repo/"
  await fs.promises.writeFile(path.resolve(req.cwd, "docs/docsify.config.json"), JSON.stringify(config, null, 2))
}
