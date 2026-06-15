const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ShellRunTemplate = require('../kernel/api/shell_run_template')
const Shell = require('../kernel/shell')

function createKernel(root = process.cwd()) {
  return {
    homedir: root,
    bracketedPasteSupport: {},
    connect: {
      keys: async () => null
    },
    envs: process.env,
    exists: async (filepath) => {
      try {
        await fs.access(filepath)
        return true
      } catch (_) {
        return false
      }
    },
    path: (type, ...parts) => path.join(root, type, ...parts)
  }
}

function createShell(kernel = createKernel()) {
  return new Shell(kernel)
}

test('renderEnvArgs protects multiline structured shell.run argv values', () => {
  const rpc = {
    method: 'shell.run',
    params: {
      shell: 'bash',
      message: {
        _: ['python', '-c', 'print("a")\nprint("b")']
      },
      env: {
        EXISTING: '1'
      }
    }
  }

  const rendered = ShellRunTemplate.renderEnvArgs({ platform: 'darwin' }, rpc, {})

  assert.notStrictEqual(rendered, rpc)
  assert.deepEqual(rendered.params.message, {
    _: ['python', '-c', '__PINOKIO_ENVARG_0__']
  })
  assert.equal(rendered.params.env.EXISTING, '1')
  assert.equal(rendered.params.env.PINOKIO_ARG_0, 'print("a")\nprint("b")')
  assert.deepEqual(rendered.params._pinokio_env_args, [
    {
      name: 'PINOKIO_ARG_0',
      value: 'print("a")\nprint("b")'
    }
  ])
  assert.equal(rendered.params._pinokio_cmd_delayed_expansion, false)
})

test('renderEnvArgs is a no-op for non-multiline or raw string shell.run messages', () => {
  const structured = {
    method: 'shell.run',
    params: {
      message: {
        _: ['echo', 'hello']
      }
    }
  }
  const rawString = {
    method: 'shell.run',
    params: {
      message: 'echo one\necho two'
    }
  }
  const differentMethod = {
    method: 'fs.write',
    params: {
      message: {
        _: ['echo', 'one\ntwo']
      }
    }
  }

  assert.strictEqual(ShellRunTemplate.renderEnvArgs({ platform: 'darwin' }, structured, {}), structured)
  assert.strictEqual(ShellRunTemplate.renderEnvArgs({ platform: 'darwin' }, rawString, {}), rawString)
  assert.strictEqual(ShellRunTemplate.renderEnvArgs({ platform: 'darwin' }, differentMethod, {}), differentMethod)
})

test('renderEnvArgs marks cmd shell runs for delayed expansion', () => {
  const rpc = {
    method: 'shell.run',
    params: {
      shell: 'cmd.exe',
      message: {
        _: ['node', '-e', 'console.log("a")\nconsole.log("b")']
      }
    }
  }

  const rendered = ShellRunTemplate.renderEnvArgs({ platform: 'win32' }, rpc, {})

  assert.equal(rendered.params._pinokio_cmd_delayed_expansion, true)
  assert.equal(rendered.params.env.PINOKIO_ARG_0, 'console.log("a")\nconsole.log("b")')
})

test('Shell.buildStructuredMessage expands env arg markers with shell-specific quoting', () => {
  const shell = createShell()
  const message = {
    _: ['python', '-c', '__PINOKIO_ENVARG_0__']
  }

  assert.equal(
    shell.buildStructuredMessage(message, 'bash'),
    '\'python\' \'-c\' "$PINOKIO_ARG_0"'
  )
  assert.equal(
    shell.buildStructuredMessage(message, 'powershell'),
    '& \'python\' \'-c\' "${env:PINOKIO_ARG_0}"'
  )
  assert.equal(
    shell.buildStructuredMessage(message, 'cmd.exe'),
    '"python" "-c" "!PINOKIO_ARG_0!"'
  )
})

test('Shell.init_env preserves multiline Pinokio argv env values only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-shell-envarg-'))
  await fs.mkdir(path.join(root, 'api'), { recursive: true })
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'PINOKIO_TEST_ENV=1\n')
  const shell = createShell(createKernel(root))

  await shell.init_env({
    path: process.cwd(),
    env: {
      PINOKIO_ARG_0: 'line one\nline two',
      OTHER_MULTILINE: 'line one\nline two'
    }
  })

  assert.equal(shell.env.PINOKIO_ARG_0, 'line one\nline two')
  assert.equal(shell.env.OTHER_MULTILINE, 'line one line two')
})

test('Shell.init_env disables Hugging Face hub update checks by default without overriding apps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-shell-hf-env-'))
  await fs.mkdir(path.join(root, 'api'), { recursive: true })
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'PINOKIO_TEST_ENV=1\n')

  const defaultShell = createShell(createKernel(root))
  await defaultShell.init_env({
    path: process.cwd(),
    env: {}
  })
  assert.equal(defaultShell.env.HF_HUB_DISABLE_UPDATE_CHECK, '1')

  const overrideShell = createShell(createKernel(root))
  await overrideShell.init_env({
    path: process.cwd(),
    env: {
      HF_HUB_DISABLE_UPDATE_CHECK: '0'
    }
  })
  assert.equal(overrideShell.env.HF_HUB_DISABLE_UPDATE_CHECK, '0')
})

test('Shell.init_env keeps Windows Hugging Face symlink defaults scoped to win32', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-shell-hf-win-'))
  await fs.mkdir(path.join(root, 'api'), { recursive: true })
  await fs.writeFile(path.join(root, 'ENVIRONMENT'), 'PINOKIO_TEST_ENV=1\n')

  const darwinShell = createShell(createKernel(root))
  darwinShell.platform = 'darwin'
  await darwinShell.init_env({
    path: process.cwd(),
    env: {}
  })
  assert.equal(darwinShell.env.HF_HUB_DISABLE_UPDATE_CHECK, '1')
  assert.equal(darwinShell.env.HF_HUB_DISABLE_SYMLINKS, undefined)

  const winShell = createShell(createKernel(root))
  winShell.platform = 'win32'
  await winShell.init_env({
    path: process.cwd(),
    env: {}
  })
  assert.equal(winShell.env.HF_HUB_DISABLE_UPDATE_CHECK, '1')
  assert.equal(winShell.env.HF_HUB_DISABLE_SYMLINKS, '1')
  assert.equal(winShell.env.HF_HUB_DISABLE_SYMLINKS_WARNING, '1')
})

test('redactEnvArgs summarizes protected argv env values', () => {
  const redacted = ShellRunTemplate.redactEnvArgs({
    PINOKIO_ARG_0: 'line one\nline two',
    REGULAR_VALUE: 'visible'
  })

  assert.equal(redacted.REGULAR_VALUE, 'visible')
  assert.deepEqual(redacted.PINOKIO_ARG_0, {
    type: 'pinokio env arg',
    lines: 2,
    preview: 'line one\nline two',
    truncated: false
  })
})
