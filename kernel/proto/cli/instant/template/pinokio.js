module.exports = {
  version: "4.0",
  menu: async (kernel, info) => {
    return [{
      default: true,
      icon: "fa-solid fa-power-off",
      text: "Start",
      href: "start.json"
    }]
  }
}
