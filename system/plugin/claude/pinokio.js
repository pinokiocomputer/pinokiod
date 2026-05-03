module.exports = {
  title: "Claude Code",
  icon: "claude.png",
  link: "https://www.anthropic.com/claude-code",
  watch: [{
    handler: "draft",
    method: "ready",
    params: {
      path: ".pinokio/draft",
      content: "post.md",
      publish: {
        target: "registry",
        type: "post",
        parent: {
          type: "app",
          url: "{{args.url || ''}}"
        }
      }
    }
  }],
  run: [{
    when: "{{platform === 'win32'}}",
    id: "run",
    method: "shell.run",
    params: {
      shell: "{{kernel.path('bin/miniconda/Library/bin/bash.exe')}}",
      conda: {
        skip: true
      },
      env: {
        CLAUDE_CODE_GIT_BASH_PATH: "{{kernel.path('bin/miniconda/Library/bin/bash.exe')}}"
      },
      message: {
        _: [
          "npx",
          "-y",
          "@anthropic-ai/claude-code@latest",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true,
      buffer: 1024
    }
  }, {
    when: "{{platform !== 'win32'}}",
    id: "run",
    method: "shell.run",
    params: {
      message: {
        _: [
          "npx",
          "-y",
          "@anthropic-ai/claude-code@latest",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true,
      buffer: 1024
    }
  }]
}
