const git = require('isomorphic-git')
const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const http = require('isomorphic-git/http/node')
const ini = require('ini')
class Git {
  constructor(kernel) {
    this.kernel = kernel
  }
  async repos (root) {
    let _repos = await glob('**/.git/', {
      cwd: root,
      onlyDirectories: true,
      dot: true,
      ignore: ['**/node_modules/**', "**/venv/**"], // optional
    });

    let repos = []
    for(let r of _repos) {
      const gitPath = path.resolve(root, r)
      const gitRelPath = path.relative(root, gitPath)
      const gitParentPath = path.dirname(gitPath)
      const gitParentRelPath = path.relative(this.kernel.path("api"), gitParentPath)
      let dir = path.dirname(gitPath)
      try {
        let gitRemote = await git.getConfig({
          fs,
          http,
          dir,
          path: 'remote.origin.url'
        })
        repos.push({
          gitPath,
          gitRelPath,
          gitParentPath,
          gitParentRelPath,
          dir,
          url: gitRemote
        })
      } catch (e) {
        repos.push({
          gitPath,
          gitRelPath,
          gitParentPath,
          gitParentRelPath,
          dir,
        })
      }
    }
    return repos
  }
  async config (dir) {
    try {
      const gitConfigPath = path.resolve(dir, ".git/config")
      const content = await fs.promises.readFile(gitConfigPath, 'utf-8');
      const gitconfig = ini.parse(content);
      return gitconfig
    } catch (e) {
      return null
    }
  }
}
module.exports = Git
