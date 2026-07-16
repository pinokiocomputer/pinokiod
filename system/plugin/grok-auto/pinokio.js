const grok = require("../grok/pinokio")

module.exports = {
  ...grok,
  title: "Grok Build Auto",
  description: "Grok Build with tool permission prompts automatically approved unless explicitly denied.",
  run: grok.run.map((step) => ({
    ...step,
    params: {
      ...step.params,
      message: {
        _: [
          ...step.params.message._.slice(0, 3),
          "--always-approve",
          ...step.params.message._.slice(3)
        ]
      }
    }
  }))
}
