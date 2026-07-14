module.exports = {
  title: "Opencode",
  icon: "icon.png",
  description: "The AI coding agent built for the terminal.",
  link: "https://opencode.ai/",
  path: "plugin",
  async installed(kernel) {
    return Boolean(kernel.which("opencode"))
  },
  install: [{
    method: "shell.run",
    params: {
      message: "npm install -g opencode-ai@latest"
    }
  }],
  uninstall: [{
    method: "shell.run",
    params: {
      message: "npm uninstall -g opencode-ai"
    }
  }, {
    method: "fs.rm",
    params: {
      path: "."
    }
  }],
  update: [{
    method: "shell.run",
    params: {
      message: "git pull",
    }
  }, {
    method: "shell.run",
    params: {
      message: "npm install -g opencode-ai@latest"
    }
  }],
  run: [{
    when: "{{platform === 'win32'}}",
    method: "shell.run",
    params: {
      shell: "bash",
      message: "opencode",
      path: "{{args.cwd}}",
      input: true
    }
  }, {
    when: "{{platform !== 'win32'}}",
    id: "run",
    method: "shell.run",
    params: {
      message: "opencode",
      path: "{{args.cwd}}",
      input: true
    }
  }]
}
