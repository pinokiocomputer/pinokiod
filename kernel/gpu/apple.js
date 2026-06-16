// Apple GPU routes to the built-in PyTorch MPS backend on macOS.
const supports_torch_backend = (controller, platform) => {
  return !!controller && platform === "darwin"
}

module.exports = {
  supports_torch_backend
}
