const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const CondaRuntimeGuard = require('../kernel/shell_conda_runtime_guard')
const ShellAPI = require('../kernel/api/shell')
const Bin = require('../kernel/bin')
const Kernel = require('../kernel')
const Shell = require('../kernel/shell')
const Shells = require('../kernel/shells')

const SKIPPED = ''

function createContext(platform = 'darwin') {
  const root = platform === 'win32'
    ? 'C:\\pinokio'
    : path.join(os.tmpdir(), 'pinokio-conda-runtime-guard')
  const appPath = platform === 'win32'
    ? 'C:\\pinokio\\api\\demo'
    : path.join(root, 'api', 'demo')
  const events = []
  return {
    appPath,
    context: {
      appPath,
      cwd: appPath,
      managedBasePrefix: platform === 'win32'
        ? 'C:\\pinokio\\bin\\miniforge'
        : path.join(root, 'bin', 'miniforge'),
      ondata: (stream, type) => events.push({ stream, type }),
      platform,
      sessionKey: `test-${Math.random()}`,
      shellName: platform === 'win32' ? 'cmd.exe' : 'bash',
    },
    events,
    root,
  }
}

function assertNoSkip(params, context) {
  const original = structuredClone(params.message)
  const result = applyShellRunGuard(params, context)
  assert.equal(result.skipped.length, 0)
  assert.deepEqual(params.message, original)
}

function applyShellRunGuard(params, context) {
  return CondaRuntimeGuard.applyCondaRuntimeGuard(params, context)
}

test('skip rule requires protected mutation and preserves unprotected base installs', () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda install conda=25.5.1 --yes',
      'conda install some-package -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.deepEqual(params.message, [SKIPPED, 'conda install some-package -y'])
  assert.equal(events.some((event) => event.type === 'notify'), true)
  assert.equal(events.some((event) => /conda install conda=25\.5\.1 --yes/.test(event.stream.raw || '')), true)
})

test('conda.skip disables wrapper inference but not explicit base targets', () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events } = createContext()
  assertNoSkip({
    conda: { skip: true, path: context.managedBasePrefix, activate: 'minimal' },
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  }, context)
  assertNoSkip({
    conda: { skip: true, name: 'base' },
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
  const params = {
    conda: { skip: true },
    path: context.appPath,
    message: [
      'conda install python=3.12 -y',
      'conda update --all',
      'conda env update -n base',
      'conda install -n base conda=25.5.1 -y',
      `conda install -p ${context.managedBasePrefix} python=3.12 -y`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 3)
  assert.deepEqual(params.message, [
    'conda install python=3.12 -y',
    'conda update --all',
    SKIPPED,
    SKIPPED,
    SKIPPED,
  ])
  assert.equal(events.some((event) => event.type === 'notify'), true)
})

test('base-scoped wrapper rules cover conda parameter shapes', () => {
  const { context } = createContext()
  const relativeManagedBase = path.relative(context.appPath, context.managedBasePrefix)
  assertNoSkip({
    conda: { path: '.env' },
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
  assertNoSkip({
    conda: { name: 'app-env' },
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
  assertNoSkip({
    conda: 'base-env',
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
  assertNoSkip({
    conda: 'base',
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
  for (const conda of [
    undefined,
    { name: 'base' },
    { path: context.managedBasePrefix },
    { path: relativeManagedBase },
    context.managedBasePrefix,
    relativeManagedBase,
    { path: '.env', activate: 'minimal' },
    { name: 'app-env', activate: 'minimal' },
  ]) {
    const params = {
      path: context.appPath,
      message: 'conda install python=3.12 -y',
    }
    if (conda !== undefined) {
      params.conda = conda
    }
    const result = applyShellRunGuard(params, context)
    assert.equal(result.skipped.length, 1)
    assert.equal(params.message, SKIPPED)
  }
})

test('guard skips listed broad mutations when named wrapper selects base', () => {
  const { context } = createContext()
  const params = {
    conda: { name: 'base' },
    path: context.appPath,
    message: [
      'conda update --all',
      'conda update --update-all',
      'conda upgrade --all',
      'conda upgrade --update-all',
      'conda install --update-all',
      'conda install --all',
      'conda install --revision 3',
      'conda install --revision=3',
      'conda remove --all',
      'conda uninstall --all',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, params.message.length)
  assert.deepEqual(params.message, Array(10).fill(SKIPPED))
})

test('guard skips protected package specs for current-environment mutating subcommands', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda install --solver libmamba -c conda-forge conda=25.5.1 -y',
      'conda install conda-forge::conda-libmamba-solver>=25.4.0 -y',
      'conda remove python -y',
      'conda uninstall conda-libmamba-solver -y',
      'conda update python>=3.10 -y',
      'conda upgrade conda -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, params.message.length)
  assert.deepEqual(params.message, Array(6).fill(SKIPPED))
})

test('guard handles local protected package archives without hyphenated-name false positives', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda install ./conda-25.5.1-py310_0.conda -y',
      'conda install ./python-3.10.20-h123_0.tar.bz2 -y',
      'conda install ./conda-libmamba-solver-25.4.0-py310_0.conda -y',
      'conda install ./conda-build-25.5.1-py310_0.conda -y',
      'conda install ./python-dateutil-2.9.0-py310_0.tar.bz2 -y',
      'conda install conda-build -y',
      'conda install python-dateutil -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 3)
  assert.deepEqual(params.message, [
    SKIPPED,
    SKIPPED,
    SKIPPED,
    'conda install ./conda-build-25.5.1-py310_0.conda -y',
    'conda install ./python-dateutil-2.9.0-py310_0.tar.bz2 -y',
    'conda install conda-build -y',
    'conda install python-dateutil -y',
  ])
})

test('guard skips opaque file-based package mutations in managed base', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda install --file specs.txt -y',
      'conda install -f specs.txt -y',
      'conda update --file specs.txt -y',
      'conda upgrade --file specs.txt -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, params.message.length)
  assert.deepEqual(params.message, Array(4).fill(SKIPPED))
})

test('guard preserves dry-run protected package and broad mutation commands', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: [
      'conda install conda=25.5.1 --dry-run -y',
      'conda --dry-run install conda=25.5.1 -y',
      'conda install python=3.12 --dry-run -y',
      'conda update --all --dry-run',
      'conda -d update --all',
      'conda remove --all -d',
    ],
  }, context)
})

test('guard preserves unprotected package specs for current-environment mutating subcommands', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: [
      'conda install some-package -y',
      'conda install ffmpeg -y',
      'conda remove some-package -y',
      'conda uninstall some-package -y',
      'conda update some-package -y',
      'conda upgrade some-package -y',
    ],
  }, context)
  assertNoSkip({
    conda: { path: '.env' },
    path: context.appPath,
    message: [
      'conda install --file requirements.txt -y',
      'conda install -f specs.txt -y',
    ],
  }, context)
})

test('base-scoped explicit target flags override wrapper target', () => {
  const { context } = createContext()
  const params = {
    conda: { path: '.env' },
    path: context.appPath,
    message: 'conda remove -n base python',
  }
  const nonBaseTargets = {
    path: context.appPath,
    message: [
      'conda install -p ./env python=3.12 -y',
      'conda install -n app python=3.12 -y',
      'conda install --prefix ./env python=3.12 -y',
      'conda install --prefix=./env python=3.12 -y',
      'conda install --name app-env python=3.12 -y',
      `conda install -p ${path.join(context.managedBasePrefix, 'envs', 'app')} python=3.12 -y`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, SKIPPED)
  assertNoSkip(nonBaseTargets, context)
})

test('base-scoped explicit base target flags include absolute and relative prefixes', () => {
  const { context } = createContext()
  const relativeManagedBase = path.relative(context.appPath, context.managedBasePrefix)
  const params = {
    path: context.appPath,
    message: [
      'conda install --name base python=3.12 -y',
      'conda install --name=base python=3.12 -y',
      `conda install -p ${context.managedBasePrefix} python=3.12 -y`,
      `conda install -p ${relativeManagedBase} python=3.12 -y`,
      `conda install --prefix ${context.managedBasePrefix} python=3.12 -y`,
      `conda install --prefix=${context.managedBasePrefix} python=3.12 -y`,
      `conda install --prefix=${relativeManagedBase} python=3.12 -y`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 7)
  assert.deepEqual(params.message, Array(7).fill(SKIPPED))
})

test('environment-targeting commands skip managed-base create, remove, and update mutations', () => {
  const { context } = createContext()
  assertNoSkip({
    conda: { path: '.env' },
    path: context.appPath,
    message: 'conda env update -f environment.yml',
  }, context)
  const params = {
    path: context.appPath,
    message: [
      'conda env create -f environment.yml',
      'conda env update -f environment.yml',
      'conda env remove',
      'conda create',
      'conda create -p ./env python=3.12 -y',
      'conda env update -n app -f environment.yml',
      'conda env update -p ./env -f environment.yml',
      'conda env update -n base -f environment.yml',
      'conda env create --name base',
      'conda create -n base python=3.12 -y',
      'conda env update -n base python=3.12',
      'conda env remove -n base',
      `conda env remove -p ${context.managedBasePrefix}`,
      `conda env create -p ${context.managedBasePrefix}`,
      `conda create -p ${context.managedBasePrefix} python=3.12 -y`,
      'conda env remove --name=base',
      `conda env update --prefix ${context.managedBasePrefix} -f environment.yml`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 11)
  assert.deepEqual(params.message.slice(0, 5), [
    'conda env create -f environment.yml',
    SKIPPED,
    'conda env remove',
    'conda create',
    'conda create -p ./env python=3.12 -y',
  ])
  assert.deepEqual(params.message.slice(5, 7), [
    'conda env update -n app -f environment.yml',
    'conda env update -p ./env -f environment.yml',
  ])
  assert.deepEqual(params.message.slice(7), Array(10).fill(SKIPPED))
})

test('guard preserves read-only conda commands', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: [
      'conda list',
      'conda info',
      'conda config --show',
      'conda search python',
    ],
  }, context)
})

test('direct executable paths identify conda commands but do not override app wrapper target', () => {
  const { context, root } = createContext()
  const managedConda = path.join(root, 'bin', 'miniforge', 'bin', 'conda')
  const params = {
    conda: { path: '.env' },
    path: context.appPath,
    message: [
      `${managedConda} install python=3.12 -y`,
      `${managedConda} install -n base python=3.12 -y`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message[0], `${managedConda} install python=3.12 -y`)
  assert.equal(params.message[1], SKIPPED)
})

test('guard recognizes Windows conda wrapper executable names', () => {
  const { context } = createContext('win32')
  const params = {
    path: context.appPath,
    message: [
      '"C:\\tools\\conda.exe" install conda=25.5.1 -y',
      '"C:\\tools\\conda.bat" install python=3.12 -y',
      '"C:\\tools\\conda.cmd" install conda-libmamba-solver -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 3)
  assert.deepEqual(params.message, [SKIPPED, SKIPPED, SKIPPED])
})

test('guard treats quoted bare conda executable forms as conda commands', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: '"conda" install python=3.12 -y',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, SKIPPED)
})

test('guard recognizes supported shell prefixes before Conda invocations', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'CONDA_OVERRIDE_CUDA=1 conda install conda=25.5.1 -y',
      'CONDA_OVERRIDE_CUDA=1 conda install ffmpeg -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.deepEqual(params.message, [
    SKIPPED,
    'CONDA_OVERRIDE_CUDA=1 conda install ffmpeg -y',
  ])

  const { context: windowsContext } = createContext('win32')
  const windowsParams = {
    path: windowsContext.appPath,
    message: 'call conda install python=3.12 -y',
  }
  const windowsResult = applyShellRunGuard(windowsParams, windowsContext)
  assert.equal(windowsResult.skipped.length, 1)
  assert.equal(windowsParams.message, SKIPPED)

  assertNoSkip({
    path: context.appPath,
    message: 'call conda install python=3.12 -y',
  }, context)
})

test('guard recognizes python module Conda invocations', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'python -m conda install conda=25.5.1 -y',
      'python3 -m conda update --all',
      'python3.12 -m conda install ffmpeg -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 2)
  assert.deepEqual(params.message, [
    SKIPPED,
    SKIPPED,
    'python3.12 -m conda install ffmpeg -y',
  ])

  const { context: windowsContext } = createContext('win32')
  const windowsParams = {
    path: windowsContext.appPath,
    message: 'python.exe -m conda install conda=25.5.1 -y',
  }
  const windowsResult = applyShellRunGuard(windowsParams, windowsContext)
  assert.equal(windowsResult.skipped.length, 1)
  assert.equal(windowsParams.message, SKIPPED)
})

test('guard does not treat ordinary Python script args as Conda invocations', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: 'python setup.py -m conda install conda=25.5.1 -y',
  }, context)
})

test('guard recognizes nested Conda mutations through conda run', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda run -n base conda install conda=25.5.1 -y',
      'conda run -n base --cwd /tmp conda install conda=25.5.1 -y',
      'conda run --cwd /tmp -n base conda install conda=25.5.1 -y',
      'conda run -n base --cwd=/tmp -- conda install conda=25.5.1 -y',
      `conda run -p ${context.managedBasePrefix} python -m conda install python=3.12 -y`,
      'conda run --name=base -- conda install conda=25.5.1 -y',
      `conda run --prefix=${context.managedBasePrefix} -- python -m conda install python=3.12 -y`,
      'conda run -- conda install conda=25.5.1 -y',
      'conda run -n app conda install conda=25.5.1 -y',
      'conda run --name=app -- conda install conda=25.5.1 -y',
      'conda run conda install conda=25.5.1 -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 9)
  assert.deepEqual(params.message, [
    SKIPPED,
    SKIPPED,
    SKIPPED,
    SKIPPED,
    SKIPPED,
    SKIPPED,
    SKIPPED,
    SKIPPED,
    'conda run -n app conda install conda=25.5.1 -y',
    'conda run --name=app -- conda install conda=25.5.1 -y',
    SKIPPED,
  ])
})

test('nested Conda target flags override conda run and wrapper targets', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda run -n app -- conda install -n base conda=25.5.1 -y',
      'conda run -n base -- conda install -n app conda=25.5.1 -y',
      'conda run -n base -- conda install --prefix ./env python=3.12 -y',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.deepEqual(params.message, [
    SKIPPED,
    'conda run -n base -- conda install -n app conda=25.5.1 -y',
    'conda run -n base -- conda install --prefix ./env python=3.12 -y',
  ])
})

test('guard leaves out-of-scope Conda config mutations unchanged', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: [
      'conda config --set channel_priority strict',
      `conda config -p ${context.managedBasePrefix} --remove-key pinned_packages`,
    ],
  }, context)
})

test('guard removes raw strings that contain skippable commands', () => {
  const { context } = createContext()
  const cases = [
    [
      'echo before && conda update --all && echo after',
      SKIPPED,
    ],
    [
      'echo before || conda update --all || echo after',
      SKIPPED,
    ],
    [
      'echo before; conda update --all; echo after',
      SKIPPED,
    ],
    [
      'echo before\nconda update --all\necho after',
      SKIPPED,
    ],
  ]

  for (const [message, expected] of cases) {
    const params = {
      path: context.appPath,
      message,
    }

    const result = applyShellRunGuard(params, context)

    assert.equal(result.skipped.length, 1)
    assert.equal(params.message, expected)
  }
})

test('guard does not corrupt redirection when removing raw strings', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: 'conda install python=3.12 -y 2>&1',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, SKIPPED)
  assert.equal(params.message.endsWith('&1'), false)
})

test('raw string separators remove the whole raw string when any segment is skipped', () => {
  const { context } = createContext()
  for (const message of [
    'conda install python=3.12 -y & echo after',
    'echo before & conda update --all',
    'echo before | conda update --all',
  ]) {
    const params = {
      path: context.appPath,
      message,
    }

    const result = applyShellRunGuard(params, context)

    assert.equal(result.skipped.length, 1)
    assert.equal(params.message, SKIPPED)
  }
})

test('guard does not treat quoted raw-string separators as unsafe control syntax', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: 'echo "conda update --all && conda install python=3.12 -y; conda remove --all | conda update --all"',
  }, context)
  const params = {
    path: context.appPath,
    message: 'echo "before & after" && conda update --all && echo "left | right"',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, SKIPPED)
})

test('rewrite logs every skipped command and shows one warning per flow', () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events } = createContext()
  context.sessionKey = 'same-app-flow'

  applyShellRunGuard({
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  }, context)
  applyShellRunGuard({
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)

  const notifyEvents = events.filter((event) => event.type === 'notify')
  const rawEvents = events.filter((event) => /\[Pinokio\] Command:/.test(event.stream.raw || ''))

  assert.equal(notifyEvents.length, 1)
  assert.equal(rawEvents.length, 2)
  assert.equal(notifyEvents[0].stream.silent, true)
  assert.equal(notifyEvents[0].stream.type, 'warning')
  assert.match(notifyEvents[0].stream.html, /Command skipped/)
  assert.match(notifyEvents[0].stream.html, /conda install conda=25\.5\.1 -y/)
  assert.match(notifyEvents[0].stream.html, /No action needed\. Pinokio already includes Conda/)
  assert.doesNotMatch(notifyEvents[0].stream.html, /Reason:/)
  assert.doesNotMatch(notifyEvents[0].stream.html, /Conda setup skipped/)
  assert.doesNotMatch(notifyEvents[0].stream.html, /Details are in the terminal\/log/)
  assert.doesNotMatch(notifyEvents[0].stream.html, /Pinokio is continuing/)
  assert.match(rawEvents[0].stream.raw, /conda install conda=25\.5\.1 -y/)
  assert.match(rawEvents[0].stream.raw, /targets Pinokio's protected base Conda setup/)
})

test('guard escapes skipped command text in notification html', () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events } = createContext()
  context.sessionKey = 'html-escape-flow'

  applyShellRunGuard({
    path: context.appPath,
    message: 'conda install "conda=<script>" -y',
  }, context)

  const notifyEvent = events.find((event) => event.type === 'notify')
  assert.ok(notifyEvent)
  assert.equal(notifyEvent.stream.html.includes('<script>'), false)
  assert.match(notifyEvent.stream.html, /&lt;script&gt;/)
})

test('guard classifies structured shell messages with flags', () => {
  const { context } = createContext()
  const appTarget = {
    path: context.appPath,
    message: {
      _: ['conda', 'install', 'python=3.12'],
      p: './env',
      y: true,
    },
  }
  const baseTarget = {
    conda: { path: '.env' },
    path: context.appPath,
    message: {
      _: ['conda', 'remove', 'python'],
      n: 'base',
    },
  }
  const { context: windowsContext } = createContext('win32')
  const powershellCall = {
    path: windowsContext.appPath,
    message: {
      _: ['&', 'conda', 'install', 'conda=25.5.1'],
    },
  }

  assert.equal(applyShellRunGuard(appTarget, context).skipped.length, 0)
  assert.equal(applyShellRunGuard(baseTarget, context).skipped.length, 1)
  assert.equal(baseTarget.message, SKIPPED)
  assert.equal(applyShellRunGuard(powershellCall, { ...windowsContext, shellName: 'powershell' }).skipped.length, 1)
  assert.equal(powershellCall.message, SKIPPED)
})

test('public shell.run API enables guard and treats string conda as a path', async () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events, root } = createContext()
  let activatedParams
  const originalPrompt = Shell.prototype.prompt
  const originalExec = Shell.prototype.exec
  Shell.prototype.prompt = async () => 'PINOKIO_PROMPT'
  Shell.prototype.exec = async function (params) {
    activatedParams = await this.activate(params)
    return Array.isArray(activatedParams.message) ? activatedParams.message.join('\n') : activatedParams.message
  }

  try {
    const kernel = {
      homedir: root,
      platform: 'darwin',
      bracketedPasteSupport: { bash: true },
      envs: {},
      exists: async () => false,
      which: () => null,
      path: (...parts) => path.join(root, ...parts),
      bin: {
        envs: (env = {}) => env,
        path: (...parts) => path.join(root, 'bin', ...parts),
        activationCommands: () => [],
      },
      api: {
        resolvePath: (cwd, target) => path.resolve(cwd, target),
        running: {},
      },
      git: {
        repos: async () => [],
        restoreNewReposForActiveSnapshot: async () => {},
      },
      template: {
        render: (value) => value,
      },
    }
    kernel.shell = new Shells(kernel)

    const api = new ShellAPI()
    await api.run({
      cwd: context.appPath,
      parent: {
        path: path.join(context.appPath, 'install.js'),
      },
      params: {
        message: 'conda install conda=25.5.1 --yes',
      },
    }, (stream, type) => {
      events.push({ stream, type })
    }, kernel)

    assert.ok(activatedParams)
    assert.equal(activatedParams.message.length, 2)
    assert.match(activatedParams.message[0], /conda activate base/)
    assert.equal(activatedParams.message[1], SKIPPED)
    assert.equal(events.some((event) => event.type === 'notify'), true)
    assert.equal(events.some((event) => /conda install conda=25\.5\.1 --yes/.test(event.stream.raw || '')), true)

    activatedParams = null
    await api.run({
      cwd: context.appPath,
      parent: {
        path: path.join(context.appPath, 'install.js'),
      },
      params: {
        conda: 'base',
        message: 'conda install python=3.12 -y',
      },
    }, (stream, type) => {
      events.push({ stream, type })
    }, kernel)

    assert.ok(activatedParams)
    assert.match(activatedParams.message[0], /conda create -y -p .*\/base/)
    assert.equal(activatedParams.message.at(-1), 'conda install python=3.12 -y')
  } finally {
    Shell.prototype.prompt = originalPrompt
    Shell.prototype.exec = originalExec
  }
})

test('kernel.bin exec does not enable the Conda runtime guard', async () => {
  const calls = []
  const bin = new Bin({
    shell: {
      run: async (params, options) => {
        calls.push({ params: structuredClone(params), options })
        return { stdout: 'ok' }
      },
    },
  })
  const params = {
    path: path.join(os.tmpdir(), 'pinokio-bin-guard-scope'),
    message: 'conda install conda=25.5.1 -y',
  }

  const result = await bin.exec(params, () => {})

  assert.deepEqual(result, { stdout: 'ok' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options, null)
  assert.equal(calls[0].params.message, 'conda install conda=25.5.1 -y')
})

test('kernel.exec does not enable the Conda runtime guard', async () => {
  const calls = []
  const kernel = {
    bin: {},
    shell: {
      run: async (params, options) => {
        calls.push({ params: structuredClone(params), options })
        return { stdout: 'ok' }
      },
    },
  }
  const params = {
    path: path.join(os.tmpdir(), 'pinokio-kernel-guard-scope'),
    message: 'conda install conda=25.5.1 -y',
  }

  const result = await Kernel.prototype.exec.call(kernel, params, () => {})

  assert.deepEqual(result, { stdout: 'ok' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options, null)
  assert.equal(calls[0].params.message, 'conda install conda=25.5.1 -y')
})

test('internal shell activation inspects only when shell.run guard option is set', async () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events, root } = createContext()
  const shell = new Shell({
    homedir: root,
    bracketedPasteSupport: {},
    path: (...parts) => path.join(root, ...parts),
    bin: {
      path: (...parts) => path.join(root, 'bin', ...parts),
      activationCommands: () => [],
    },
  })
  shell.platform = 'darwin'
  shell.shell = 'bash'
  shell.group = 'activate-test'
  shell.ondata = (stream, type) => events.push({ stream, type })

  const unmarked = await shell.activate({
    id: 'persistent-start-test',
    path: context.appPath,
    persistent: true,
    message: ['conda install conda=25.5.1 -y'],
  })

  assert.equal(unmarked.message.length, 2)
  assert.match(unmarked.message[0], /conda activate base/)
  assert.equal(unmarked.message[1], 'conda install conda=25.5.1 -y')
  assert.equal(events.some((event) => event.type === 'notify'), false)

  shell.condaRuntimeGuard = true
  const params = await shell.activate({
    id: 'persistent-start-test',
    path: context.appPath,
    persistent: true,
    message: ['conda install conda=25.5.1 -y'],
  })

  assert.equal(params.message.length, 2)
  assert.match(params.message[0], /conda activate base/)
  assert.equal(params.message[1], SKIPPED)
  assert.equal(events.some((event) => event.type === 'notify'), true)
})

test('Windows cmd suppresses echo only for explicit conda shell.run commands', () => {
  const shell = new Shell({ bracketedPasteSupport: {} })
  shell.platform = 'win32'
  shell.shell = 'cmd.exe'
  const command = 'conda_hook & conda deactivate & conda activate base & conda install -y -c conda-forge ffmpeg'

  assert.equal(shell.shouldSuppressCmdEchoForConda({
    message: 'conda install -y -c conda-forge ffmpeg',
  }), true)
  assert.equal(shell.shouldSuppressCmdEchoForConda({
    message: 'python main.py',
  }), false)
  assert.equal(shell.shouldSuppressCmdEchoForConda({
    message: 'conda_hook',
  }), false)
  assert.equal(shell.shouldSuppressCmdEchoForConda({
    input: true,
    message: 'conda install -y -c conda-forge ffmpeg',
  }), false)

  const prepared = shell.prepareCommandExecution({
    message: 'conda install -y -c conda-forge ffmpeg',
  }, command)
  assert.equal(prepared.preview, command)
  assert.equal(prepared.command, command)
  assert.equal(prepared.quietCmd, true)

  assert.deepEqual(shell.prepareCommandExecution({
    message: 'python main.py',
  }, command), { command })
})

test('Windows cmd array shell.run marks only the conda launch quiet', async (t) => {
  const { context } = createContext('win32')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-windows-cmd-array-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  context.appPath = path.join(root, 'api', 'demo')
  context.cwd = context.appPath
  context.managedBasePrefix = path.join(root, 'bin', 'miniforge')
  const records = []
  const originalPrompt = Shell.prototype.prompt
  const originalExec = Shell.prototype.exec
  Shell.prototype.prompt = async () => 'PINOKIO_PROMPT'
  Shell.prototype.exec = async function (params) {
    this.platform = 'win32'
    this.shell = 'cmd.exe'
    const originalParams = {
      input: params && params.input,
      message: params && params.message,
    }
    const activatedParams = await this.activate(params)
    const command = this.build(activatedParams)
    records.push({
      message: originalParams.message,
      prepared: this.prepareCommandExecution(originalParams, command),
    })
    return command
  }

  try {
    const kernel = {
      homedir: root,
      platform: 'win32',
      bracketedPasteSupport: { 'cmd.exe': false },
      envs: {},
      exists: async () => false,
      which: () => null,
      path: (...parts) => path.join(root, ...parts),
      bin: {
        envs: (env = {}) => env,
        path: (...parts) => path.join(root, 'bin', ...parts),
        activationCommands: () => [],
      },
      api: {
        resolvePath: (_cwd, target) => target,
        running: {},
      },
      git: {
        repos: async () => [],
        restoreNewReposForActiveSnapshot: async () => {},
      },
      template: {
        render: (value) => value,
      },
    }
    kernel.shell = new Shells(kernel)

    await kernel.shell.run({
      path: context.appPath,
      message: [
        'echo before',
        'conda install -y -c conda-forge ffmpeg',
        'python main.py',
      ],
    }, {}, () => {})

    assert.deepEqual(records.map((record) => record.message), [
      'echo before',
      'conda install -y -c conda-forge ffmpeg',
      'python main.py',
    ])
    assert.deepEqual(records.map((record) => !!record.prepared.quietCmd), [
      false,
      true,
      false,
    ])
  } finally {
    Shell.prototype.prompt = originalPrompt
    Shell.prototype.exec = originalExec
  }
})

test('rewrite warning is scoped to each user-visible shell flow', async () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events, root } = createContext()
  const createShell = (id, startTime) => {
    const shell = new Shell({
      homedir: root,
      bracketedPasteSupport: {},
      path: (...parts) => path.join(root, ...parts),
      bin: {
        path: (...parts) => path.join(root, 'bin', ...parts),
        activationCommands: () => [],
      },
    })
    shell.platform = 'darwin'
    shell.shell = 'bash'
    shell.group = 'same-script-group'
    shell.id = id
    shell.start_time = startTime
    shell.ondata = (stream, type) => events.push({ stream, type })
    return shell
  }

  const flowOne = createShell('flow-one', 1)
  flowOne.condaRuntimeGuard = true
  await flowOne.activate({
    id: 'flow-one',
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  })
  const flowTwo = createShell('flow-two', 2)
  flowTwo.condaRuntimeGuard = true
  await flowTwo.activate({
    id: 'flow-two',
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  })

  assert.equal(events.filter((event) => event.type === 'notify').length, 2)
})
