module.exports = {
  version: "4.0",
  title: "Prototype",
  menu: [{
    image: "empty/icon.png",
    text: "Empty Project",
    href: "empty/index.js",
    readme: "empty/README.md",
  }, {
    image: "python/python.png",
    text: "Python Project",
    menu: [{
      text: "New Python Project",
      href: "python/new/index.js",
      readme: "python/new/README.md"
    }, {
      text: "New Gradio + Pytorch Project",
      href: "python/new_gradio_pytorch/index.js",
      readme: "python/new_gradio_pytorch/README.md"
    }, {
      text: "New Pytorch Project",
      href: "python/new_pytorch/index.js",
      readme: "python/new_pytorch/README.md"
    }, {
      text: "Clone a Python Project",
      href: "python/clone/index.js",
      readme: "python/clone/README.md"
    }, {
      text: "Clone a Python Project (Pytorch)",
      description: "Clone a python project that uses Pytorch",
      href: "python/clone_pytorch/index.js",
      readme: "python/clone_pytorch/README.md"
    }]
  }, {
    image: "nodejs/nodejs.png",
    text: "Node.js Project",
    menu: [{
      text: "New Node.js Project",
      href: "nodejs/new/index.js",
      readme: "nodejs/new/README.md"
    }, {
      text: "Clone a Node.js Project",
      href: "nodejs/clone/index.js",
      readme: "nodejs/clone/README.md"
    }]
  }, {
    image: "cli/minimal.png",
    text: "CLI App Launcher",
    menu: [{
      text: "Instant CLI Launcher",
      href: "cli/instant/index.js",
      readme: "cli/instant/README.md"
    }, {
      text: "Installable CLI Launcher",
      href: "cli/installable/index.js",
      readme: "cli/installable/README.md"
    }]
  }, {
    image: "docsify/icon.png",
    text: "Instant Documentation",
    href: "docsify/index.js",
    readme: "docsify/README.md"
  }]
}
