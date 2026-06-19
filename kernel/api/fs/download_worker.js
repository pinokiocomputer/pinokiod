const fs = require('fs')
const { DownloaderHelper } = require('node-downloader-helper')
const randomUseragent = require('random-useragent')

const safeSend = (msg) => {
  try {
    if (process.send) {
      process.send(msg)
    }
  } catch (_) {
    // ignore IPC errors
  }
}

process.on('message', async (config) => {
  const { url, folder, fileName, stallMs } = config || {}

  if (!url || !folder) {
    safeSend({
      type: 'error',
      error: { message: 'download_worker: invalid config (url/folder required)', stack: '' }
    })
    process.exit(1)
    return
  }

  try {
    await fs.promises.mkdir(folder, { recursive: true }).catch(() => {})
  } catch (_) {
    // if mkdir fails, DownloaderHelper will surface an error later
  }

  const userAgent = randomUseragent.getRandom((ua) => ua.browserName === 'Chrome') ||
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

  const options = {
    headers: {
      'user-agent': userAgent
    },
    override: {
      skip: true,
      skipSmaller: false
    },
    resumeIfFileExists: true,
    removeOnStop: false,
    removeOnFail: false,
    retry: { maxRetries: 10, delay: 5000 }
  }

  if (fileName) {
    options.fileName = fileName
  }

  const dl = new DownloaderHelper(url, folder, options)

  const STALL_MS = typeof stallMs === 'number' ? stallMs : 60000
  let lastProgressAt = Date.now()
  let finished = false
  let stallTimer = setInterval(() => {
    if (finished) return
    const elapsed = Date.now() - lastProgressAt
    if (elapsed > STALL_MS) {
      safeSend({
        type: 'stall',
        elapsed
      })
      try {
        dl.stop()
      } catch (_) {
      }
    }
  }, STALL_MS)

  const cleanup = () => {
    finished = true
    if (stallTimer) {
      clearInterval(stallTimer)
      stallTimer = null
    }
  }

  dl.on('download', (downloadInfo) => {
    safeSend({ type: 'download', info: downloadInfo })
  })

  // High-frequency progress updates stay in the worker to drive the stall watchdog,
  // but we only forward throttled updates to the parent to avoid flooding IPC.
  dl.on('progress', (stats) => {
    lastProgressAt = Date.now()
  })

  dl.on('progress.throttled', (stats) => {
    lastProgressAt = Date.now()
    safeSend({ type: 'progress.throttled', stats })
  })

  dl.on('stateChanged', (state) => {
    safeSend({ type: 'stateChanged', state })
  })

  dl.on('redirected', (newUrl, oldUrl) => {
    safeSend({ type: 'redirected', newUrl, oldUrl })
  })

  dl.on('resume', (isResumed) => {
    safeSend({ type: 'resume', isResumed })
  })

  dl.on('timeout', () => {
    safeSend({ type: 'timeout' })
  })

  dl.on('warning', (err) => {
    safeSend({
      type: 'warning',
      error: {
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : ''
      }
    })
  })

  dl.on('skip', (skipInfo) => {
    cleanup()
    safeSend({ type: 'skip', info: skipInfo })
    process.exit(0)
  })

  dl.on('end', (downloadInfo) => {
    cleanup()
    safeSend({ type: 'end', info: downloadInfo })
    process.exit(0)
  })

  dl.on('error', (err) => {
    cleanup()
    safeSend({
      type: 'error',
      error: {
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : String(err)
      }
    })
    process.exit(1)
  })

  dl.start().catch((err) => {
    cleanup()
    safeSend({
      type: 'error',
      error: {
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : String(err)
      }
    })
    process.exit(1)
  })
})
