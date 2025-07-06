module.exports = {
  version: "4.0",
  menu: async (kernel, info) => {
    let running = {
      install: info.running("install.json"),
      start: info.running("start.json"),
    }
    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.json",
      }]
    } else if (running.start) {
      return [{
        default: true,
        icon: 'fa-solid fa-terminal',
        text: "Terminal",
        href: "start.json",
      }]
    } else {
      return [{
        icon: "fa-solid fa-power-off",
        text: "Start",
        href: "start.json",
      }, {
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.json",
      }]
    }
  }
}
