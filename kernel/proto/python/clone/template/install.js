const config = require('./config.json')
module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: [
          "git clone $GIT_URL app"
        ],
      },
    },
    {
      method: "shell.run",
      params: {
        venv: "venv",                // Edit this to customize the venv folder path
        path: "$INSTALL_PATH",
        message: [
          "$INSTALL_COMMAND"
        ],
      }
    },
  ]
}
