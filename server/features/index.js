const { createNoteFeature } = require("./notes")

async function mountFeatures(options = {}) {
  const notes = createNoteFeature(options)
  await notes.start()
  return {
    notes
  }
}

module.exports = {
  mountFeatures
}
