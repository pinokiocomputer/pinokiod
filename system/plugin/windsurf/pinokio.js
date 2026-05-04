module.exports = {
  title: "Windsurf",
  link: "https://windsurf.com/",
  icon: "windsurf.png",
  description: "The AI Code Editor",
  launch_type: "desktop",
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
    method: "uri.open",
    params: {
      uri: "windsurf://cascade/newChat",
      params: {
        prompt: "{{args.prompt || ''}}",
        folder: "{{args.cwd || ''}}"
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
