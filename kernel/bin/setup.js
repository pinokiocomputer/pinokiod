const os = require('os')
let platform = os.platform()
let zip_cmd
if (platform === 'win32') {
  zip_cmd = "7zip"
} else {
  zip_cmd = "p7zip"
}
module.exports = {
  ai: (kernel) => {
    let conda_requirements = [
      zip_cmd,
      "uv",
      "node",
      "huggingface",
      "git",
      "ffmpeg",
//      "caddy"
    ]
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "node", },
      { name: "cli", },
      { name: "ffmpeg", },
//      { name: "caddy", }
    ])
    if (platform === "win32") {
      requirements.push({ name: "registry" })
      requirements.push({ name: "vs" })
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
//      { name: "cloudflared" },
//      { name: "playwright" },
      { name: "huggingface" },
      { name: "uv" },
      { name: "py" },
      // browserless disabled for now (keep module for later re-enable)
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
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "node", },
      { name: "cli", },
      { name: "py" },
      // browserless disabled for now (keep module for later re-enable)
    ])
    return {
      icon: "fa-brands fa-js",
      title: "Node.js",
      description: "Set up self-contained node.js development environment",
      requirements,
      conda_requirements: [
        zip_cmd,
        "node",
        "git",
      ]
    }
  },
  python: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "uv", },
      { name: "py" },
    ])
    return {
      icon: "fa-brands fa-python",
      title: "Python",
      description: "Set up self-contained python development environment",
      requirements,
      conda_requirements: [
        zip_cmd,
        "uv",
        "git",
      ]
    }
  },
  prod_dev: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "node", },
      { name: "cli", },
      { name: "uv", },
      { name: "caddy", },
      { name: "py", },
      // browserless disabled for now (keep module for later re-enable)
    ])
    let conda_requirements = [
      zip_cmd,
      "uv",
      "node",
      "git",
      "caddy"
    ]
    return {
      icon: "fa-solid fa-laptop-code",
      title: "Coding (Essential)",
      description: "Install common modules required for development (Node.js, python, Visual Studio Developer Tools (Windows), Xcode build tools (Mac)",
      requirements,
      conda_requirements,
    }
  },
  dev: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "node", },
      { name: "cli", },
      { name: "uv", },
      { name: "py", },
      { name: "huggingface" },
      { name: "ffmpeg", },
      // browserless disabled for now (keep module for later re-enable)
    ])
    let conda_requirements = [
      zip_cmd,
      "uv",
      "node",
      "huggingface",
      "git",
      "ffmpeg",
    ]
    return {
      icon: "fa-solid fa-laptop-code",
      title: "Coding (Essential)",
      description: "Install common modules required for development (Node.js, python, Visual Studio Developer Tools (Windows), Xcode build tools (Mac)",
      requirements,
      conda_requirements,
    }
  },
  advanced_dev: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "node", },
      { name: "cli", },
      { name: "uv", },
      { name: "caddy", },
      { name: "huggingface" },
      { name: "ffmpeg", },
      { name: "py", },
      // browserless disabled for now (keep module for later re-enable)
    ])
    let conda_requirements = [
      zip_cmd,
      "uv",
      "node",
      "huggingface",
      "git",
      "ffmpeg",
      "caddy",
    ]
    if (platform === "win32") {
      requirements.push({ name: "registry" })
      requirements.push({ name: "vs" })
    }
    if (platform === "linux") {
      requirements.push({ name: "gxx" })
      conda_requirements.push("gxx")
    }
    return {
      icon: "fa-solid fa-laptop-code",
      title: "Coding (Advanced)",
      description: "Coding (Essential) + More modules useful for building",
      requirements,
      conda_requirements,
    }
  },
  network: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "uv", },
      { name: "caddy", },
      { name: "py", },
    ])
    return {
      icon: "fa-solid fa-wifi",
      title: "Network",
      description: "Automatic HTTPS and local network sharing for ALL local apps",
      requirements,
      conda_requirements: [
        zip_cmd,
        "uv",
        "git",
        "caddy"
      ]
    }
  },
  connect: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "zip", },
    ]
    if (platform === "darwin") {
      requirements.push({ name: "brew" })
    }
    requirements = requirements.concat([
      { name: "git", },
      { name: "uv", },
      { name: "caddy", },
      { name: "py", },
    ])
    return {
      icon: "fa-solid fa-wifi",
      title: "API Connect",
      description: "Connect with 3rd party APIs",
      requirements,
      conda_requirements: [
        zip_cmd,
        "huggingface",
        "uv",
        "git",
        "caddy"
      ]
    }
  },
  git: (kernel) => {
    let requirements = [
      { name: "conda", },
      { name: "git", },
    ]
    return {
      icon: "fa-solid fa-wifi",
      title: "Git",
      description: "Self-contained git installation",
      requirements,
      conda_requirements: [
        "git",
      ]
    }
  }
}
