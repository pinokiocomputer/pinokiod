const { createDraftFeature } = require("./drafts")

async function mountFeatures(options = {}) {
  const drafts = createDraftFeature(options)
  await drafts.start()
  return {
    drafts
  }
}

module.exports = {
  mountFeatures
}
