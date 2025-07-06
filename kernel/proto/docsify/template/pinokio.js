module.exports = {
  version: "4.0",
  menu: async (kernel, info) => {
    let local = info.local("start.js")
    let config_exists = info.exists("docs/docsify.config.json")
    if (config_exists) {
      if (local && local.url) {
        return [{
          default: true,
          icon: "fa-solid fa-rocket",
          text: "View",
          href: local.url,
        }, {
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js"
        }]
      } else {
        return [{
          default: true,
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js"
        }]
      }
    }
  }
}
