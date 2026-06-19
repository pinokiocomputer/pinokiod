// Normalize GPU/CPU names so matching works across vendor punctuation variants.
const normalize_model = (model) => {
  return (model || "")
    .toLowerCase()
    .replace(/\((tm|r)\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

module.exports = {
  normalize_model
}
