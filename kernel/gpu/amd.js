const { normalize_model } = require("./common")

// Detect uninformative AMD APU names that need CPU-brand fallback matching.
const is_generic_gpu_model = (model) => {
  let normalized = normalize_model(model)
  return /^(amd )?radeon graphics$/.test(normalized)
}

// Resolve CPU brand lazily so discrete GPU matches do not trigger CPU probing.
const resolve_cpu_brand = async (cpu_brand) => {
  if (typeof cpu_brand === "function") {
    return await cpu_brand()
  } else {
    return cpu_brand
  }
}

// Match AMD GPU model names that Pinokio should route to PyTorch ROCm wheels.
const matches_rocm_torch_model = (model) => {
  let normalized = normalize_model(model)

  // AMD PyTorch ROCm install policy. These checks are based on the
  // hardware families Pinokio should route to ROCm-flavored PyTorch wheels,
  // not on whether ROCm is already installed on the machine.

  // Radeon RX 7600+:
  // - RX 7600 / 7600 XT / 7600M / 7600M XT
  // - RX 7700 / 7800 / 7900 families
  // - RX 9000 families such as RX 9060 and RX 9070
  // - Future RX 8xxx/9xxx names are treated as ROCm-intended by policy.
  let rx = normalized.match(/\brx\s*([7-9]\d{3})(?!\d)/)
  if (rx && Number(rx[1]) >= 7600) {
    return true
  }

  // Radeon PRO W7700+:
  // - PRO W7700 / W7800 / W7900
  // - Future PRO W 8xxx/9xxx names are treated as ROCm-intended by policy.
  let pro = normalized.match(/\bpro\s*w\s*([7-9]\d{3})(?!\d)/)
  if (pro && Number(pro[1]) >= 7700) {
    return true
  }

  return (
    // Radeon PRO V710
    /\bpro\s*v\s*710\b/.test(normalized) ||
    // Radeon AI PRO R9600/R9700 variants, including suffixes like R9700S.
    /\bai\s*pro\s*r\s*9[67]\d{2}[a-z]?\b/.test(normalized) ||
    // Supported APUs and codenames seen in PyTorch ROCm wheel support.
    /\b(780m|820m|880m|890m|8050s|8060s|strix|phoenix|fire range)\b/.test(normalized)
  )
}

// Decide AMD ROCm install intent, using CPU brand only for generic APU GPU names.
const supports_torch_backend = async (model, cpu_brand) => {
  if (matches_rocm_torch_model(model)) {
    return true
  }
  if (!is_generic_gpu_model(model)) {
    return false
  }
  // APU-only systems can report the GPU as just "AMD Radeon Graphics".
  // In that generic case, use the CPU brand as a fallback because it often
  // includes the Radeon model or codename, such as 8060S or Strix Halo.
  return matches_rocm_torch_model(await resolve_cpu_brand(cpu_brand))
}

module.exports = {
  is_generic_gpu_model,
  matches_rocm_torch_model,
  supports_torch_backend
}
