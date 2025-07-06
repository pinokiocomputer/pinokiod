module.exports = {
  daemon: true,
  run: [
    // Edit this step to customize your app's launch command
    {
      method: "shell.run",
      params: {
        path: "app",
        env: { },                   // Edit this to customize environment variables (see documentation)
        message: [
          "pnpm run dev",
        ],
        on: [{
          // The regular expression pattern to monitor.
          // When this pattern occurs in the shell terminal, the shell will return,
          // and the script will go onto the next step.
          "event": "/http:\/\/[^\\s\\n\\r]+/",   

          // "done": true will move to the next step while keeping the shell alive.
          // "kill": true will move to the next step after killing the shell.
          "done": true
        }]
      }
    },
    {
      when: "{{input && input.event && Array.isArray(input.event) && input.event.length > 0}}",
      method: "local.set",
      params: {
        // the input.event is the regular expression match object from the previous step
        url: "{{input.event[0]}}"
      },
      next: null
    },
    {
      method: "notify",
      params: {
        html: "If the app prints its URL on launch (ex: 'Server running at http://localhost:8080'), the launcher script will detect it and open the app in a new tab automatically."
      },
    },
  ]
}

