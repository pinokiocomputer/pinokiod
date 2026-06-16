const antigravity = require("../antigravity-cli/common")

module.exports = {
  title: "Antigravity CLI Auto",
  icon: "antigravity.png",
  description: "Antigravity CLI with tool permission prompts skipped.",
  link: "https://antigravity.google/product/antigravity-cli",
  install: antigravity.installSteps,
  update: antigravity.installSteps,
  uninstall: antigravity.uninstallSteps,
  installed: antigravity.installed,
  run: (kernel, info, context) => antigravity.runSteps(kernel, info, context, { auto: true }),
}
