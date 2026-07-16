module.exports = {
  title: "Grok Build",
  icon: "grok.png",
  link: "https://github.com/xai-org/grok-build",
  run: [{
    when: "{{platform === 'win32'}}",
    id: "run",
    method: "shell.run",
    params: {
      shell: "{{kernel.path('bin/miniforge/Library/bin/bash.exe')}}",
      conda: {
        skip: true
      },
      message: {
        _: [
          "npx",
          "-y",
          "@xai-official/grok@latest",
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
          "@xai-official/grok@latest",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true,
      buffer: 1024
    }
  }]
}
