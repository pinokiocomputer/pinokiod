const os = require('os')
let platform = os.platform()
module.exports = {
  ai: (kernel) => {
    let conda_requirements = [
      "uv",
      "node",
      "huggingface",
      "git",
      "ffmpeg",
//      "caddy"
    ]
    let requirements = [
      { name: "conda", },
      { name: "git", },
  //      { name: "zip", },
      { name: "node", },
      { name: "ffmpeg", },
//      { name: "caddy", }
    ]
    if (platform === "win32") {
      requirements.push({ name: "registry" })
      requirements.push({ name: "vs" })
    }
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    if (platform === "linux") {
      requirements.push({ name: "gxx" })
      conda_requirements.push("gxx")
    }
    if (kernel.gpu === "nvidia") {
      requirements.push({ name: "cuda", })
      conda_requirements.push("cuda")
    }
    requirements = requirements.concat([
      { name: "cloudflared" },
//      { name: "playwright" },
      { name: "huggingface" },
      { name: "uv" },
      { name: "py" },
    ])
    return {
      icon: "fa-solid fa-brain",
      title: "AI",
      description: "Install common modules required for running AI locally",
      requirements,
      conda_requirements
    }
  },
  javascript: (kernel) => {
    return {
      icon: "fa-brands fa-js",
      title: "Node.js",
      description: "Set up self-contained node.js development environment",
      requirements: [
        { name: "conda", },
        { name: "git", },
        { name: "node", },
      ],
      conda_requirements: [
        "node",
        "git",
      ]
    }
  },
  python: (kernel) => {
    return {
      icon: "fa-brands fa-python",
      title: "Python",
      description: "Set up self-contained python development environment",
      requirements: [
        { name: "conda", },
        { name: "git", },
        { name: "uv", },
      ],
      conda_requirements: [
        "uv",
        "git",
      ]
    }
  },
  dev: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "git", },
      { name: "node", },
      { name: "uv", },
    ]
    let conda_requirements = [
      "uv",
      "node",
      "git",
    ]
    if (platform === "win32") {
      requirements.push({ name: "registry" })
      requirements.push({ name: "vs" })
    }
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    if (platform === "linux") {
      requirements.push({ name: "gxx" })
      conda_requirements.push("gxx")
    }
    return {
      icon: "fa-solid fa-laptop-code",
      title: "Coding",
      description: "Install common modules required for development (Node.js, python, Visual Studio Developer Tools (Windows), Xcode build tools (Mac)",
      requirements,
      conda_requirements,
    }
  },
  network: (kernel) => {
    return {
      icon: "fa-solid fa-wifi",
      title: "Network",
      description: "Automatic HTTPS and local network sharing for ALL local apps",
      requirements: [
        { name: "conda", },
        { name: "git", },
        { name: "caddy", },
      ],
      conda_requirements: [
        "git",
        "caddy"
      ]
    }
  },
  connect: (kernel) => {
    return {
      icon: "fa-solid fa-wifi",
      title: "API Connect",
      description: "Connect with 3rd party APIs",
      requirements: [
        { name: "conda", },
        { name: "git", },
        { name: "caddy", },
      ],
      conda_requirements: [
        "git",
        "caddy"
      ]
    }
  }
}
