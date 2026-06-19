const semver = require('semver')

const CONDA_PIN_VERSION = "25.5.1"
const DEFAULT_SQLITE_PIN_VERSION = "3.47.2"
const WINDOWS_SQLITE_PIN_VERSION = "3.53.2"
const WINDOWS_PYTHON_SSL_FIX_SPEC = "python=3.10.20=*_1_cpython"
const WINDOWS_PYTHON_SSL_FIX_VERSION = "3.10.20"

const sqlitePinVersion = (platform) => {
  return platform === "win32" ? WINDOWS_SQLITE_PIN_VERSION : DEFAULT_SQLITE_PIN_VERSION
}

const sqliteInstallSpec = (platform) => {
  return `sqlite=${sqlitePinVersion(platform)}`
}

const sqlitePinnedSpec = (platform) => {
  return `sqlite ==${sqlitePinVersion(platform)}`
}

const isExpectedSqlitePinned = (platform, version) => {
  return String(version) === sqlitePinVersion(platform)
}

const condaBuildNumber = (build) => {
  const chunks = String(build || "").split("_").reverse()
  const buildNumber = chunks.find((chunk) => /^\d+$/.test(chunk))
  return buildNumber ? Number(buildNumber) : null
}

const isWindowsPythonSslFixed = (version, build) => {
  const coerced = semver.coerce(version)
  if (!coerced) {
    return false
  }
  if (!semver.satisfies(coerced, ">=3.10.20 <3.11.0")) {
    return false
  }
  if (semver.eq(coerced, WINDOWS_PYTHON_SSL_FIX_VERSION)) {
    const buildNumber = condaBuildNumber(build)
    return typeof buildNumber === "number" && buildNumber >= 1
  }
  return true
}

module.exports = {
  CONDA_PIN_VERSION,
  WINDOWS_PYTHON_SSL_FIX_SPEC,
  isExpectedSqlitePinned,
  isWindowsPythonSslFixed,
  sqliteInstallSpec,
  sqlitePinnedSpec,
}
