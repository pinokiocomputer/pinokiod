module.exports = {
  title: "OpenAI Codex Auto",
  icon: "openai.webp",
  description: "OpenAI Codex CLI with --yolo and trusted workspace config.",
  link: "https://github.com/openai/codex",
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
          "--yolo",
          "-c",
          "projects={ {{JSON.stringify(args.cwd)}}={trust_level=\"trusted\"} }",
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
          "--yolo",
          "-c",
          "projects={ {{JSON.stringify(args.cwd)}}={trust_level=\"trusted\"} }",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      input: true
    }
  }]
}
