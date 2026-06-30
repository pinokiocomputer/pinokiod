const { execFile } = require("node:child_process")

const NVIDIA_SMI_COMPUTE_CAP_ARGS = [
  "--query-gpu=pci.bus_id,compute_cap",
  "--format=csv,noheader,nounits"
]

let cuda_sm_targets_promise = null

const normalize_pci_bus = (bus) => {
  let normalized = String(bus || "").trim().toLowerCase()
  let match = /(?:[0-9a-f]{4,8}:)?([0-9a-f]{2}:[0-9a-f]{2}\.[0-7])$/.exec(normalized)
  return match ? match[1] : normalized
}

const compute_cap_to_sm_target = (compute_cap) => {
  let match = /^(\d+)\.(\d+)$/.exec(String(compute_cap || "").trim())
  return match ? `sm_${match[1]}${match[2]}` : null
}

const parse_nvidia_smi_compute_caps = (stdout) => {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let parts = line.split(",").map((part) => part.trim())
      if (parts.length < 2) return null
      let target = compute_cap_to_sm_target(parts[1])
      if (!target) return null
      return {
        pci_bus: normalize_pci_bus(parts[0]),
        target
      }
    })
    .filter(Boolean)
}

const query_cuda_sm_targets = (exec_file = execFile) => {
  return new Promise((resolve) => {
    exec_file(
      "nvidia-smi",
      NVIDIA_SMI_COMPUTE_CAP_ARGS,
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve([])
        } else {
          resolve(parse_nvidia_smi_compute_caps(stdout))
        }
      }
    )
  })
}

const cached_cuda_sm_targets = () => {
  if (!cuda_sm_targets_promise) {
    cuda_sm_targets_promise = query_cuda_sm_targets()
  }
  return cuda_sm_targets_promise
}

const select_cuda_sm_target = (controller, records) => {
  let targets = Array.isArray(records) ? records : []
  if (targets.length === 0) {
    return null
  }

  let controller_bus = normalize_pci_bus(controller && (controller.pciBus || controller.busAddress))
  if (controller_bus) {
    let match = targets.find((record) => record.pci_bus === controller_bus)
    if (match) {
      return match.target
    }
  }

  return targets.length === 1 ? targets[0].target : null
}

const resolve_cuda_sm_target = async (controller) => {
  if (!controller) {
    return null
  }
  let records = await cached_cuda_sm_targets()
  return select_cuda_sm_target(controller, records)
}

module.exports = {
  compute_cap_to_sm_target,
  parse_nvidia_smi_compute_caps,
  query_cuda_sm_targets,
  resolve_cuda_sm_target,
  select_cuda_sm_target
}
