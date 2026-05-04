module.exports = {
  title: "Cursor",
  link: "https://cursor.com",
  icon: "cursor.jpeg",
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
    when: "{{which('cursor')}}",
    method: "exec",
    params: {
      message: "cursor .",
      path: "{{args.cwd}}"
    }
  }, {
    when: "{{!which('cursor')}}",
    method: "notify",
    params: {
      html: "Cursor is not installed. Click to visit the Cursor homepage to download",
      href: "https://cursor.com",
      target: "_blank"
    }
  }]
}
