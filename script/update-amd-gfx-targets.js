const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const { normalize_model } = require('../kernel/gpu/common')

const GPU_SPECS_URL = 'https://raw.githubusercontent.com/ROCm/ROCm/develop/docs/reference/gpu-arch-specs.rst'
const GENERATOR = 'script/update-amd-gfx-targets.js'

const repoRoot = path.resolve(__dirname, '..')

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString()
        response.resume()
        fetchText(nextUrl).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`${url} returned ${response.statusCode}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

function canonicalKey(value) {
  let key = normalize_model(value)
  let previous
  do {
    previous = key
    key = key
      .replace(/^advanced micro devices\s+/, '')
      .replace(/^amd\s+/, '')
      .replace(/^instinct\s+/, '')
      .trim()
  } while (key !== previous)
  return key
}

function addEntry(entries, name, target) {
  const key = canonicalKey(name)
  if (key && /^gfx[0-9a-f]+$/i.test(target)) {
    entries[key] = target.toLowerCase()
  }
}

function parseGpuSpecs(rst) {
  const entries = {}
  let headers = null
  let cells = []
  let inRow = false

  const flushRow = () => {
    if (!inRow || cells.length === 0) return
    if (cells.includes('Name') && cells.includes('LLVM target name')) {
      headers = cells
    } else if (headers) {
      const nameIndex = headers.indexOf('Name')
      const graphicsIndex = headers.indexOf('Graphics model')
      const targetIndex = headers.indexOf('LLVM target name')
      const target = cells[targetIndex]
      if (target) {
        addEntry(entries, cells[nameIndex], target)
        if (graphicsIndex >= 0) {
          addEntry(entries, cells[graphicsIndex], target)
        }
      }
    }
    cells = []
  }

  for (const line of rst.split(/\r?\n/)) {
    if (/^\s*\*\s*$/.test(line)) {
      flushRow()
      inRow = true
      continue
    }
    const cell = line.match(/^\s*-\s*(.*)$/)
    if (inRow && cell) {
      cells.push(cell[1].trim())
    }
  }
  flushRow()

  return entries
}

function writeJson(relativePath, data) {
  const file = path.join(repoRoot, relativePath)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

async function main() {
  const specs = await fetchText(GPU_SPECS_URL)
  const entries = parseGpuSpecs(specs)

  writeJson('kernel/gpu/amd_gfx_targets.json', {
    source: GPU_SPECS_URL,
    generated_by: GENERATOR,
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
  })

  console.log(`Wrote ${Object.keys(entries).length} AMD gfx target entries`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
