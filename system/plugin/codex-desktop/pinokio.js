module.exports = {
  title: "Codex Desktop",
  link: "https://openai.com/codex",
  icon: "icon.png",
  description: "Codex Desktop",
  launch_type: "desktop",
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
    method: "uri.open",
    params: {
      uri: "codex://new",
      params: {
        prompt: "{{args.prompt || ''}}",
        path: "{{args.cwd || ''}}"
      }
    }
  }, {
    method: "process.wait",
    params: {
      title: "Launched",
      description: "Click the stop button to stop watching file changes"
    }
  }]
}
