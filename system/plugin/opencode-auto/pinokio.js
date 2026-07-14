const opencode = require("../opencode/pinokio")

module.exports = {
  ...opencode,
  title: "Opencode Auto",
  description: "OpenCode with permission prompts automatically approved unless explicitly denied.",
  run: opencode.run.map((step) => ({
    ...step,
    params: {
      ...step.params,
      message: "opencode --auto",
    },
  })),
}
