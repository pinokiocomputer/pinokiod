const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

async function buildCondaListFromMeta(minicondaPath, useCondaList) {
  if (!useCondaList) {
    const metaOutput = await readFromMeta(minicondaPath)
    if (metaOutput) {
      return { response: metaOutput, source: 'conda-meta' }
    }
  }
  return await runCondaList(minicondaPath)
}

async function readFromMeta(minicondaPath) {
  if (!minicondaPath) {
    return null
  }
  const metaDir = path.join(minicondaPath, 'conda-meta')
  let entries
  try {
    entries = await fs.promises.readdir(metaDir, { withFileTypes: true })
  } catch (err) {
    return null
  }
  const lines = [
    '# packages in environment (generated from conda-meta)',
    '#',
    '# name version build channel'
  ]
  let count = 0
  for (const entry of entries) {
    if (!entry || !entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const fullpath = path.join(metaDir, entry.name)
    try {
      const content = await fs.promises.readFile(fullpath, 'utf8')
      const json = JSON.parse(content)
      if (json && json.name && json.version) {
        const build = json.build_string || json.build || 'meta'
        const channel = json.channel || ''
        lines.push(`${json.name} ${json.version} ${build} ${channel}`)
        count++
      }
    } catch (err) {
      // ignore malformed entries
    }
  }
  if (count === 0) {
    return null
  }
  return lines.join('\n')
}

async function runCondaList(minicondaPath) {
  const condaBinary = resolveCondaBinary(minicondaPath)
  if (!condaBinary) {
    return { response: '', source: 'conda-list' }
  }
  return await new Promise((resolve) => {
    execFile(condaBinary, ['list'], { windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ response: '', source: 'conda-list' })
      } else {
        resolve({ response: stdout || '', source: 'conda-list' })
      }
    })
  })
}

function resolveCondaBinary(minicondaPath) {
  if (process.platform === 'win32') {
    if (minicondaPath) {
      const scriptPath = path.join(minicondaPath, 'Scripts', 'conda.exe')
      if (fs.existsSync(scriptPath)) {
        return scriptPath
      }
    }
    return 'conda'
  }
  if (minicondaPath) {
    const binPath = path.join(minicondaPath, 'bin', 'conda')
    if (fs.existsSync(binPath)) {
      return binPath
    }
  }
  return 'conda'
}

module.exports = {
  buildCondaListFromMeta
}
