const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const CondaRuntimeGuard = require('../kernel/shell_conda_runtime_guard')
const Shell = require('../kernel/shell')

const NOOP = 'echo Pinokio skipped a Conda setup command. Pinokio is continuing.'

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

function markShellRun(params) {
  Object.defineProperty(params, CondaRuntimeGuard.SHELL_RUN_GUARD, {
    configurable: true,
    value: true,
  })
  return params
}

function applyShellRunGuard(params, context) {
  return CondaRuntimeGuard.applyCondaRuntimeGuard(markShellRun(params), context)
}

function assertNoUnmarkedInspection(params, context) {
  const original = structuredClone(params.message)
  const result = CondaRuntimeGuard.applyCondaRuntimeGuard(params, context)
  assert.equal(result.skipped.length, 0)
  assert.deepEqual(params.message, original)
}

test('guard skips protected package mutations and preserves unrelated package mutations in managed base', () => {
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
  assert.deepEqual(params.message, [NOOP, 'conda install some-package -y'])
  assert.equal(events.some((event) => event.type === 'notify'), true)
  assert.equal(events.some((event) => /conda install conda=25\.5\.1 --yes/.test(event.stream.raw || '')), true)
})

test('guard exits before inspection when conda.skip is true', () => {
  CondaRuntimeGuard.resetNoticeSessionsForTest()
  const { context, events } = createContext()
  const params = {
    conda: { skip: true },
    path: context.appPath,
    message: [
      'conda install python=3.12 -y',
      'conda update --all',
      'conda env update -n base',
    ],
  }

  assertNoSkip(params, context)
  assert.equal(events.length, 0)
})

test('guard preserves app environment wrappers and string conda paths', () => {
  const { context } = createContext()
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
    conda: 'base',
    path: context.appPath,
    message: 'conda install python=3.12 -y',
  }, context)
})

test('guard skips listed broad mutations when named wrapper selects base', () => {
  const { context } = createContext()
  const params = {
    conda: { name: 'base' },
    path: context.appPath,
    message: [
      'conda update --all',
      'conda upgrade --all',
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 2)
  assert.deepEqual(params.message, [NOOP, NOOP])
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
  assert.deepEqual(params.message, Array(6).fill(NOOP))
})

test('guard preserves dry-run protected package and broad mutation commands', () => {
  const { context } = createContext()
  assertNoSkip({
    path: context.appPath,
    message: [
      'conda install conda=25.5.1 --dry-run -y',
      'conda install python=3.12 --dry-run -y',
      'conda update --all --dry-run',
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
      'conda install --file requirements.txt -y',
      'conda install -f specs.txt -y',
      'conda remove some-package -y',
      'conda uninstall some-package -y',
      'conda update some-package -y',
      'conda upgrade some-package -y',
    ],
  }, context)
})

test('command target arguments override wrapper target', () => {
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
  assert.equal(params.message, NOOP)
  assertNoSkip(nonBaseTargets, context)
})

test('explicit base target flags select managed base', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda install --name base python=3.12 -y',
      'conda install --name=base python=3.12 -y',
      `conda install -p ${context.managedBasePrefix} python=3.12 -y`,
      `conda install --prefix ${context.managedBasePrefix} python=3.12 -y`,
      `conda install --prefix=${context.managedBasePrefix} python=3.12 -y`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 5)
  assert.deepEqual(params.message, Array(5).fill(NOOP))
})

test('environment-targeting commands require explicit managed-base target', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: [
      'conda env create -f environment.yml',
      'conda env update -f environment.yml',
      'conda env remove',
      'conda create',
      'conda create -p ./env python=3.12 -y',
      'conda env update -n base -f environment.yml',
      'conda env create --name base',
      'conda create -n base python=3.12 -y',
      'conda env update -n base python=3.12',
      'conda env remove -n base',
      `conda env remove -p ${context.managedBasePrefix}`,
    ],
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 4)
  assert.deepEqual(params.message.slice(0, 7), [
    'conda env create -f environment.yml',
    'conda env update -f environment.yml',
    'conda env remove',
    'conda create',
    'conda create -p ./env python=3.12 -y',
    'conda env update -n base -f environment.yml',
    'conda env create --name base',
  ])
  assert.deepEqual(params.message.slice(7), [NOOP, NOOP, NOOP, NOOP])
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
  assert.equal(params.message[1], NOOP)
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
  assert.deepEqual(params.message, [NOOP, NOOP, NOOP])
})

test('guard treats quoted bare conda executable forms as conda commands', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: '"conda" install python=3.12 -y',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, NOOP)
})

test('guard rewrites only skippable segments in chained raw strings', () => {
  const { context } = createContext()
  const cases = [
    [
      'echo before && conda update --all && echo after',
      `echo before && ${NOOP} && echo after`,
    ],
    [
      'echo before || conda update --all || echo after',
      `echo before || ${NOOP} || echo after`,
    ],
    [
      'echo before; conda update --all; echo after',
      `echo before; ${NOOP}; echo after`,
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

test('guard does not corrupt redirection when rewriting raw strings', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: 'conda install python=3.12 -y 2>&1',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, NOOP)
  assert.equal(params.message.endsWith('&1'), false)
})

test('guard replaces whole raw string when unsafe control syntax cannot be safely separated', () => {
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
    assert.equal(params.message, NOOP)
  }
})

test('guard does not treat quoted ampersands or pipe characters as unsafe control syntax', () => {
  const { context } = createContext()
  const params = {
    path: context.appPath,
    message: 'echo "before & after" && conda update --all && echo "left | right"',
  }

  const result = applyShellRunGuard(params, context)

  assert.equal(result.skipped.length, 1)
  assert.equal(params.message, `echo "before & after" && ${NOOP} && echo "left | right"`)
})

test('guard emits one non-modal notice per session and terminal details per skip', () => {
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
  assert.match(notifyEvents[0].stream.html, /Pinokio skipped a Conda setup command/)
  assert.match(notifyEvents[0].stream.html, /Pinokio already manages base Conda/)
  assert.match(notifyEvents[0].stream.html, /Pinokio is continuing/)
  assert.match(notifyEvents[0].stream.html, /conda install conda=25\.5\.1 -y/)
  assert.match(notifyEvents[0].stream.html, /Details are in the terminal\/log/)
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

  assert.equal(applyShellRunGuard(appTarget, context).skipped.length, 0)
  assert.equal(applyShellRunGuard(baseTarget, context).skipped.length, 1)
  assert.equal(baseTarget.message, NOOP)
})

test('guard does not inspect unmarked shell messages', () => {
  const { context } = createContext()
  assertNoUnmarkedInspection({
    path: context.appPath,
    message: [
      'conda install conda=25.5.1 -y',
      'conda update --all',
    ],
  }, context)
})

test('Shell.activate guards only shell.run-marked messages before prepending activation commands', async () => {
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

  const params = await shell.activate(markShellRun({
    id: 'persistent-start-test',
    path: context.appPath,
    persistent: true,
    message: ['conda install conda=25.5.1 -y'],
  }))

  assert.equal(params.message.length, 2)
  assert.match(params.message[0], /conda activate base/)
  assert.equal(params.message[1], NOOP)
  assert.equal(events.some((event) => event.type === 'notify'), true)
})

test('Shell.activate scopes visual notices to the concrete shell flow', async () => {
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

  await createShell('flow-one', 1).activate(markShellRun({
    id: 'flow-one',
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  }))
  await createShell('flow-two', 2).activate(markShellRun({
    id: 'flow-two',
    path: context.appPath,
    message: 'conda install conda=25.5.1 -y',
  }))

  assert.equal(events.filter((event) => event.type === 'notify').length, 2)
})
