module.exports = {
  title: "Antigravity",
  link: "https://antigravity.google/",
  icon: "antigravity.png",
  description: "The AI IDE from Google",
  launch_type: "desktop",
  watch: [{
    method: "note.watch",
    params: {
      path: ".pinokio/notes",
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
    when: "{{which('antigravity')}}",
    method: "exec",
    params: {
      message: "antigravity .",
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
