const antigravity = require("./common")

module.exports = {
  title: "Antigravity CLI",
  icon: "antigravity.png",
  description: "Antigravity agents in the terminal.",
  link: "https://antigravity.google/product/antigravity-cli",
  install: antigravity.installSteps,
  update: antigravity.installSteps,
  uninstall: antigravity.uninstallSteps,
  installed: antigravity.installed,
  run: antigravity.runSteps,
}
