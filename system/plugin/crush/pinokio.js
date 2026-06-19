module.exports = {
  title: "Crush",
  icon: "crush.png",
  link: "https://github.com/charmbracelet/crush",
  run: [{
    id: "run",
    method: "shell.run",
    params: {
      message: "npx -y @charmland/crush@latest",
      path: "{{args.cwd}}",
      buffer: 1024,
      input: true
    }
  }]
}
