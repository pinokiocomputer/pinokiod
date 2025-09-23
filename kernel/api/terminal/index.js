const fs = require('fs')
const path = require('path')
const sanitize = require('sanitize-filename')

class Terminal {
  async upload(req, ondata, kernel) {
    const params = req.params || {}
    const files = Array.isArray(params.files) ? params.files : []
    const buffers = params.buffers || {}

    if (files.length === 0) {
      if (ondata) {
        ondata({ raw: "\r\nNo files provided for upload.\r\n" })
      }
      return { files: [] }
    }

    const shellInstance = this.resolveShellInstance(params, kernel)
    const shellCwd = this.resolveShellCwd(params, kernel)
    const baseCwd = shellInstance && typeof shellInstance.path === 'string' && shellInstance.path.trim().length > 0
      ? shellInstance.path
      : shellCwd

    const uploadRoot = baseCwd
      ? path.join(baseCwd, '.pinokio-temp')
      : kernel.path('temp', 'web-terminal')

    await fs.promises.mkdir(uploadRoot, { recursive: true })

    const saved = []

    for (const file of files) {
      const key = file && file.key
      if (!key || !buffers[key]) {
        continue
      }
      const sourceBuffer = buffers[key]
      const originalName = typeof file.name === 'string' && file.name.length > 0
        ? file.name
        : 'upload'
      const sanitized = sanitize(originalName) || `upload-${Date.now()}`
      const targetName = await this.uniqueFilename(uploadRoot, sanitized)
      const targetPath = path.join(uploadRoot, targetName)

      await fs.promises.writeFile(targetPath, sourceBuffer)
      delete buffers[key]

      const homeRelativePath = path.relative(kernel.homedir, targetPath)
      const normalizedHomeRelativePath = homeRelativePath.split(path.sep).join('/')
      const cliPath = targetPath
      const cliBase = baseCwd || kernel.homedir
      const cliRelative = cliBase ? path.relative(cliBase, targetPath) : null
      const cliRelativePath = cliRelative ? cliRelative.split(path.sep).join('/') : null

      saved.push({
        originalName,
        storedAs: targetName,
        path: targetPath,
        size: typeof file.size === 'number' ? file.size : sourceBuffer.length,
        mimeType: typeof file.type === 'string' ? file.type : '',
        homeRelativePath: normalizedHomeRelativePath,
        displayPath: `~/${normalizedHomeRelativePath}`,
        cliPath,
        cliRelativePath
      })

    }

    if (saved.length === 0) {
      if (ondata) {
        ondata({ raw: "\r\nNo files were saved.\r\n" })
      }
      return { files: saved }
    }

    const marker = '[attachment] '
    if (params && params.id && kernel && kernel.shell && typeof kernel.shell.emit === 'function') {
      try {
        kernel.shell.emit({
          id: params.id,
          emit: marker,
          paste: true
        })
      } catch (error) {
        if (ondata) {
          ondata({ raw: marker })
        }
      }
    } else if (ondata) {
      ondata({ raw: marker })
    }

    // Break references to potentially large buffers once handled.
    if (req.params) {
      req.params.buffers = {}
    }

    return { files: saved }
  }

  resolveShellInstance(params, kernel) {
    if (!params || typeof params.id !== 'string') {
      return null
    }
    if (!kernel || !kernel.shell || typeof kernel.shell.get !== 'function') {
      return null
    }
    try {
      return kernel.shell.get(params.id)
    } catch (error) {
      return null
    }
  }

  resolveShellCwd(params, kernel) {
    if (!params || typeof params.cwd !== 'string') {
      return null
    }
    let cwd = params.cwd.trim()
    if (!cwd) {
      return null
    }
    const queryIndex = cwd.indexOf('?')
    if (queryIndex !== -1) {
      cwd = cwd.slice(0, queryIndex)
    }
    const hashIndex = cwd.indexOf('#')
    if (hashIndex !== -1) {
      cwd = cwd.slice(0, hashIndex)
    }
    if (!cwd) {
      return null
    }
    if (cwd.startsWith('~/')) {
      return path.resolve(kernel.homedir, cwd.slice(2))
    }
    if (path.isAbsolute(cwd)) {
      return cwd
    }
    return path.resolve(kernel.homedir, cwd)
  }

  async uniqueFilename(dir, candidate) {
    const parsed = path.parse(candidate)
    const baseName = parsed.name && parsed.name.trim().length > 0 ? parsed.name : 'upload'
    const extension = parsed.ext || ''
    let attemptIndex = 0

    // Ensure we do not end up in an infinite loop if fs.access throws non-ENOENT errors.
    while (true) {
      const attemptName = attemptIndex === 0 ? `${baseName}${extension}` : `${baseName}_${attemptIndex}${extension}`
      const attemptPath = path.join(dir, attemptName)
      try {
        await fs.promises.access(attemptPath)
        attemptIndex += 1
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          return attemptName
        }
        throw error
      }
    }
  }
}

module.exports = Terminal
