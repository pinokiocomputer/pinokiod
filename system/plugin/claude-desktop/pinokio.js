module.exports = {
  title: "Claude Desktop",
  link: "https://claude.com/download",
  icon: "icon.jpeg",
  description: "Claude desktop",
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
      uri: "claude://code/new",
      params: {
        q: "{{args.prompt || ''}}",
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
