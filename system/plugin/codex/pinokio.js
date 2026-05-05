module.exports = {
  title: "OpenAI Codex",
  icon: "openai.webp",
  link: "https://github.com/openai/codex",
  watch: [{
    method: "note.watch",
    params: {
      path: ".pinokio/notes",
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
      message: {
        _: [
          "npx",
          "-y",
          "@openai/codex@latest",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true
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
          "@openai/codex@latest",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true
    }
  }]
}
