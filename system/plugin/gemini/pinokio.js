module.exports = {
  title: "Gemini CLI",
  icon: "gemini.jpeg",
  link: "https://github.com/google-gemini/gemini-cli",
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
          "{{args.prompt || undefined}}"
        ]
      },
      path: "{{args.cwd}}",
      buffer: 1024,
      input: true
    }
  }]
}
