module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "pnpm install"
        ],
      }
    },
  ]
}
