module.exports = {
  title: "Claude Code Auto",
  icon: "claude.png",
  description: "Claude Code with trusted workspace and bypass permissions prompts skipped.",
  link: "https://www.anthropic.com/claude-code",
  watch: [{
    method: "draft.watch",
    params: {
      path: ".pinokio/drafts",
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
        CLAUDE_CODE_GIT_BASH_PATH: "{{kernel.path('bin/miniconda/Library/bin/bash.exe')}}",
        CLAUBBIT: "true"
      },
      message: {
        _: [
          "npx",
          "-y",
          "@anthropic-ai/claude-code@latest",
          "--settings",
          "{\"skipDangerousModePermissionPrompt\":true}",
          "--dangerously-skip-permissions",
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
      env: {
        CLAUBBIT: "true"
      },
      message: {
        _: [
          "npx",
          "-y",
          "@anthropic-ai/claude-code@latest",
          "--settings",
          "{\"skipDangerousModePermissionPrompt\":true}",
          "--dangerously-skip-permissions",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true,
      buffer: 1024
    }
  }]
}
