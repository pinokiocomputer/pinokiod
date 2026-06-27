const semver = require('semver')

const CONDA_PIN_VERSION = "26.3.2"
const PYTHON_PIN_VERSION = "3.10.20"
const PYTHON_INSTALL_SPEC = `python=${PYTHON_PIN_VERSION}`
const WINDOWS_PYTHON_SSL_FIX_SPEC = `${PYTHON_INSTALL_SPEC}=*_1_cpython`

const condaBuildNumber = (build) => {
  const chunks = String(build || "").split("_").reverse()
  const buildNumber = chunks.find((chunk) => /^\d+$/.test(chunk))
  return buildNumber ? Number(buildNumber) : null
}

const isExpectedPythonPinned = (platform, version, build) => {
  const coerced = semver.coerce(version)
  if (!coerced) {
    return false
  }
  if (!semver.eq(coerced, PYTHON_PIN_VERSION)) {
    return false
  }
  if (platform === "win32") {
    const buildNumber = condaBuildNumber(build)
    return typeof buildNumber === "number" && buildNumber >= 1
  }
  return true
}

module.exports = {
  CONDA_PIN_VERSION,
  PYTHON_INSTALL_SPEC,
  WINDOWS_PYTHON_SSL_FIX_SPEC,
  isExpectedPythonPinned,
}
