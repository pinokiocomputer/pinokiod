const git = require('isomorphic-git')
const fs = require('fs')
const path = require('path')
const { glob, sync, hasMagic } = require('glob-gitignore')
const http = require('isomorphic-git/http/node')
const ini = require('ini')
class Git {
  constructor(kernel) {
    this.kernel = kernel
    this.dirs = new Set()
  }
  async findGitDirs(dir, results = []) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          results.push(path.join(dir, entry.name));
          continue; // don't go deeper in this repo
        }
        if (entry.name === 'node_modules' || entry.name === 'venv' || entry.name.startsWith(".")) {
          continue; // skip these heavy folders
        }
        await this.findGitDirs(path.join(dir, entry.name), results);
      }
    }
    return results;
  }

  async repos (root) {
    let _repos = await this.findGitDirs(root)
//    let _repos = await glob('**/.git/', {
//      cwd: root,
//      onlyDirectories: true,
//      dot: true,
//      ignore: ['**/node_modules/**', "**/venv/**"], // optional
//    });

    let name = path.basename(root)

    let repos = []
    for(let r of _repos) {
      const gitPath = path.resolve(root, r)
      const gitRelPath = path.relative(root, gitPath)
      const gitRelPathSansGit = path.dirname(gitRelPath)
      const gitParentPath = path.dirname(gitPath)
      const gitParentRelPath = path.relative(this.kernel.path("api"), gitParentPath)
      let dir = path.dirname(gitPath)
      let display_name
      let main
      if (gitRelPathSansGit === ".") {
        display_name = name
        main = true
      } else {
        display_name = `${name}/${gitRelPathSansGit}`
        main = false
      }
      try {
        let gitRemote = await git.getConfig({
          fs,
          http,
          dir,
          path: 'remote.origin.url'
        })
        repos.push({
          main,
          name: display_name,
          gitPath,
          gitRelPath,
          gitParentPath,
          gitParentRelPath,
          dir,
          url: gitRemote,
        })
      } catch (e) {
        repos.push({
          main,
          name: display_name,
          gitPath,
          gitRelPath,
          gitParentPath,
          gitParentRelPath,
          dir,
        })
      }
      this.dirs.add(dir)
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
  async getHead(repoPath) {
    const commits = await git.log({
      fs,
      dir: repoPath,
      depth: 1,   // only get the latest commit
    });

    if (commits.length === 0) {
      throw new Error("No commits found in repository");
    }

    const { oid, commit } = commits[0];
    return {
      hash: oid,
      message: commit.message,
    };
  }

  async resolveCommitOid(dir, ref) {
    const oid = await git.resolveRef({ fs, dir, ref });
    const { type } = await git.readObject({ fs, dir, oid });
    if (type === "tag") {
      const { object } = await git.readTag({ fs, dir, oid });
      return object;
    }
    if (type !== "commit") {
      throw new Error(`Ref ${ref} points to a ${type}, not a commit.`);
    }
    return oid;
  }

  async getParentCommit(dir, commitOid) {
    const { commit } = await git.readCommit({ fs, dir, oid: commitOid });
    return commit.parent[0] || commitOid; // For initial commit
  }
}
module.exports = Git
