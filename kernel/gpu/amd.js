const { normalize_model } = require("./common")
const amd_gfx_targets = require("./amd_gfx_targets.json")

const canonical_model_key = (model) => {
  let key = normalize_model(model)
  let previous
  do {
    previous = key
    key = key
      .replace(/^advanced micro devices\s+/, "")
      .replace(/^amd\s+/, "")
      .replace(/^instinct\s+/, "")
      .trim()
  } while (key !== previous)
  return key
}

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

const resolve_rocm_gfx_target = (model) => {
  let key = canonical_model_key(model)
  if (/^gfx[0-9a-f]+$/i.test(key)) {
    return key.toLowerCase()
  }
  if (amd_gfx_targets.entries[key]) {
    return amd_gfx_targets.entries[key]
  }

  return null
}

const resolve_gpu_target = async (model, cpu_brand) => {
  let target = resolve_rocm_gfx_target(model)
  if (target) {
    return target
  }
  if (!is_generic_gpu_model(model)) {
    return null
  }
  return resolve_rocm_gfx_target(await resolve_cpu_brand(cpu_brand))
}

module.exports = {
  resolve_gpu_target,
  resolve_rocm_gfx_target
}
