module.exports = {
  title: "Antigravity",
  link: "https://antigravity.google/",
  icon: "antigravity.png",
  description: "The AI IDE from Google",
  launch_type: "desktop",
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
