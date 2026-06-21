const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

async function runWithFakeShell ({ platform = 'win32', chunks, response, waitForBreak = false, on }) {
  class FakeShell {
    constructor () {
      this.id = 'fake-shell'
      this.monitor = ''
      this.breakResolver = null
      this.resolved = undefined
    }

    stripAnsi (value) {
      return value
    }

    kill (message) {
      this.resolved = message || response
      if (this.breakResolver) {
        this.breakResolver(this.resolved)
      }
    }

    continue (message) {
      this.resolved = message || response
      if (this.breakResolver) {
        this.breakResolver(this.resolved)
      }
    }

    async start (_params, onstream) {
      let breakPromise = null
      if (waitForBreak) {
        breakPromise = new Promise((resolve) => {
          this.breakResolver = resolve
        })
      }
      for (const chunk of chunks) {
        await onstream({ raw: chunk })
        if (this.resolved !== undefined) {
          return this.resolved
        }
      }
      if (waitForBreak) {
        return await breakPromise
      }
      return response
    }
  }

  const shellsModulePath = require.resolve('../kernel/shells')
  delete require.cache[shellsModulePath]

  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === './shell' && parent && /kernel[\\/]shells\.js$/.test(parent.filename)) {
      return FakeShell
    }
    return originalLoad.apply(this, arguments)
  }

  try {
    const Shells = require('../kernel/shells')
    const kernel = {
      platform,
      homedir: '/tmp/pinokio-home',
      bracketedPasteSupport: { 'cmd.exe': true },
      bin: { envs: (env) => env || {} },
      api: {
        resolvePath: (_cwd, execPath) => execPath,
        running: {}
      },
      which: () => null
    }
    const output = []
    const shells = new Shells(kernel)
    const result = await shells.run({ message: 'python wgp.py', on }, { cwd: '/tmp/app' }, (stream) => {
      output.push(stream.raw || '')
    })

    return { output, result }
  } finally {
    Module._load = originalLoad
    delete require.cache[shellsModulePath]
  }
}

test('shell.run promotes a live break match to an error when the final response loses it', async () => {
  const { output, result } = await runWithFakeShell({
    chunks: [
      "Traceback (most recent call last):\r\n",
      "ModuleNotFoundError: No module named 'torch'\r\n"
    ],
    response: "(env) (base) C:\\pinokio\\api\\wan2gp-amd.git\\app>"
  })

  assert.equal(output.some((chunk) => chunk.includes('# input.event')), true)
  assert.deepEqual(result.event[0], 'Error:')
  assert.deepEqual(result.error, ['Error:'])
})

test('shell.run promotes a live argparse error to an error when the final response loses it', async () => {
  const { output, result } = await runWithFakeShell({
    platform: 'darwin',
    chunks: [
      "usage: x-voice_infer-gradio [-h] [--port PORT] [--host HOST]\n",
      "x-voice_infer-gradio: error: argument --port: invalid int value: 'aaaa'\n"
    ],
    response: "(/Users/x/pinokio/api/X-Voice.git2/app/conda_env) <<PINOKIO_SHELL>>"
  })

  assert.equal(output.some((chunk) => chunk.includes('# input.event')), true)
  assert.deepEqual(result.event[0], 'error:')
  assert.deepEqual(result.error, ['error:'])
})

test('shell.run resolves an interactive run on a real live break match', async () => {
  const { output, result } = await runWithFakeShell({
    platform: 'darwin',
    chunks: [
      "x-voice_infer-gradio: error: argument --port: invalid int value: 'aaaa'\n"
    ],
    response: "(/Users/x/pinokio/api/X-Voice.git2/app/conda_env) <<PINOKIO_SHELL>>",
    waitForBreak: true
  })

  assert.equal(output.some((chunk) => chunk.includes('# input.event')), true)
  assert.deepEqual(result.event[0], 'error:')
  assert.deepEqual(result.error, ['error:'])
})

test('shell.run does not return an error for a live match covered by break:false', async () => {
  const { result } = await runWithFakeShell({
    platform: 'darwin',
    chunks: [
      "error: triton is not available, continuing without it\n"
    ],
    response: "error: triton is not available, continuing without it\nready"
  })

  assert.equal(result.error, undefined)
})
