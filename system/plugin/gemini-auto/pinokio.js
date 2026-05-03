module.exports = {
  title: "Gemini CLI Auto",
  icon: "gemini.jpeg",
  description: "Gemini CLI with workspace trust and tool approvals skipped.",
  link: "https://github.com/google-gemini/gemini-cli",
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
    id: "run",
    method: "shell.run",
    params: {
      message: {
        _: [
          "npx",
          "-y",
          "@google/gemini-cli",
          "--include-directories",
          "{{kernel.path('prototype')}}",
          "--skip-trust",
          "--approval-mode=yolo",
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      buffer: 1024,
      input: true
    }
  }]
}
