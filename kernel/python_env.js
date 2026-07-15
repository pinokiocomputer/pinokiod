function managedPythonEnv(source = process.env) {
  const env = { ...(source || {}) }
  for (const key of Object.keys(env)) {
    if (["PYTHONNOUSERSITE", "PYTHONPATH"].includes(key.toUpperCase())) {
      delete env[key]
    }
  }
  env.PYTHONNOUSERSITE = "1"
  return env
}

module.exports = {
  managedPythonEnv,
}
