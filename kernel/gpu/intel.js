const { normalize_model } = require("./common")

// Resolve CPU brand lazily so clear GPU model matches do not trigger CPU probing.
const resolve_cpu_brand = async (cpu_brand) => {
  if (typeof cpu_brand === "function") {
    return await cpu_brand()
  } else {
    return cpu_brand
  }
}

// Match Intel GPU model names that Pinokio should route to PyTorch XPU wheels.
const matches_xpu_torch_model = (model) => {
  let normalized = normalize_model(model)
  return (
    // Intel Arc A-Series / B-Series, Arc Pro, and Core Ultra iGPUs when the
    // GPU model itself includes Arc.
    /\barc\b/.test(normalized) ||
    // Intel Data Center GPU Max Series. Do not match generic Data Center GPU
    // names because Data Center GPU Flex is not in current PyTorch XPU docs.
    /\b(data center gpu max|gpu max|ponte vecchio)\b/.test(normalized)
  )
}

// Detect uninformative Intel iGPU names that need CPU-brand fallback matching.
const is_generic_gpu_model = (model) => {
  let normalized = normalize_model(model)
  return /^(intel )?graphics$/.test(normalized)
}

// Decide Intel XPU install intent, using CPU brand only for generic iGPU names.
const supports_torch_backend = async (model, cpu_brand) => {
  if (matches_xpu_torch_model(model)) {
    return true
  }
  if (!is_generic_gpu_model(model)) {
    return false
  }
  let brand = normalize_model(await resolve_cpu_brand(cpu_brand))
  return /\bcore\s*ultra\b/.test(brand)
}

module.exports = {
  is_generic_gpu_model,
  matches_xpu_torch_model,
  supports_torch_backend
}
