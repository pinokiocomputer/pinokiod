// NVIDIA routes to CUDA PyTorch wheels on supported non-macOS platforms.
const supports_torch_backend = (controller, platform) => {
  return !!controller && platform !== "darwin"
}

module.exports = {
  supports_torch_backend
}
