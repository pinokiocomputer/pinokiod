module.exports = {
  title: "Crush",
  icon: "crush.png",
  link: "https://github.com/charmbracelet/crush",
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
      message: "npx -y @charmland/crush@latest",
      path: "{{args.cwd}}",
      buffer: 1024,
      input: true
    }
  }]
}
