module.exports = {
  title: "VS Code",
  link: "https://code.visualstudio.com/",
  icon: "vscode.png",
  description: "The AI Code Editor",
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
    when: "{{which('code')}}",
    method: "exec",
    params: {
      message: "code .",
      path: "{{args.cwd}}",
    }
  }, {
    method: "process.wait",
    params: {
      title: "Launched",
      description: "Click the stop button to stop watching file changes"
    }
  }]
}
