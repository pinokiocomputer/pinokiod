const assert = require('node:assert/strict')
const fsModule = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Bin = require('../kernel/bin')
const Conda = require('../kernel/bin/conda')
const {
  CONDA_PIN_VERSION,
  PYTHON_INSTALL_SPEC,
  WINDOWS_PYTHON_SSL_FIX_SPEC,
  isExpectedCondaPinned,
  isExpectedPythonPinned,
} = require('../kernel/bin/conda-pins')

async function pathExists(target) {
  return fs.access(target).then(() => true).catch(() => false)
}

function createKernel(root, platform = 'win32') {
  return {
    arch: 'x64',
    homedir: root,
    platform,
    path: (...parts) => path.join(root, ...parts),
    exists: async (...parts) => pathExists(path.join(root, ...parts)),
    bin: {
      correct_conda: true,
      installed: {},
      path: (...parts) => path.join(root, 'bin', ...parts),
      exists: async (target) => pathExists(path.join(root, 'bin', target)),
    },
  }
}

async function writeCondaMeta(root, name, version, build = 'py_0') {
  const metaDir = path.join(root, 'bin', 'miniforge', 'conda-meta')
  await fs.mkdir(metaDir, { recursive: true })
  await fs.writeFile(
    path.join(metaDir, `${name}-${version}.json`),
    JSON.stringify({ name, version, build_string: build, channel: 'conda-forge' })
  )
}

async function writeHealthyCondaMeta(root, platform = 'win32', condaVersion = CONDA_PIN_VERSION) {
  await writeCondaMeta(root, 'conda', condaVersion, 'py310')
  await writeCondaMeta(root, 'conda-libmamba-solver', '25.4.0', 'pyhd3eb1b0_0')
  await writeCondaMeta(root, 'python', '3.10.20', platform === 'win32' ? 'h4de0772_1_cpython' : 'cpython')
}

async function writeFakeManagedConda(root, platform = 'win32') {
  const condaPath = platform === 'win32'
    ? path.join(root, 'bin', 'miniforge', 'Scripts', 'conda.exe')
    : path.join(root, 'bin', 'miniforge', 'bin', 'conda')
  await fs.mkdir(path.dirname(condaPath), { recursive: true })
  await fs.copyFile(process.execPath, condaPath)
  await fs.chmod(condaPath, 0o755)
  return condaPath
}

async function createCondaRoot(root, name) {
  const condaRoot = path.join(root, 'bin', name)
  await fs.mkdir(path.join(condaRoot, 'Scripts'), { recursive: true })
  await fs.writeFile(path.join(condaRoot, 'Scripts', 'conda.exe'), 'fake conda\n')
  return condaRoot
}

async function createMiniforge(root) {
  return createCondaRoot(root, 'miniforge')
}

async function createLegacyMiniconda(root) {
  return createCondaRoot(root, 'miniconda')
}

function createConda(kernel) {
  const conda = new Conda()
  conda.kernel = kernel
  return conda
}

function createBin(root, platform = 'win32') {
  const kernel = {
    homedir: root,
    platform,
    path: (...parts) => path.join(root, ...parts),
  }
  const bin = new Bin(kernel)
  bin.platform = platform
  bin.installed = {}
  kernel.bin = bin
  return bin
}

test('Conda uses Miniforge assets and writes conda-forge-only config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-miniforge-config-'))
  const conda = createConda(createKernel(root))

  assert.equal(
    conda.urls.win32.x64,
    'https://github.com/conda-forge/miniforge/releases/download/26.3.2-3/Miniforge3-Windows-x86_64.exe'
  )

  await conda.init()
  const condarc = await fs.readFile(path.join(root, 'condarc'), 'utf8')

  assert.match(condarc, /^channels:\n  - conda-forge\n/m)
  assert.match(condarc, /  - python=3\.10\.20\n/)
  assert.match(condarc, /bin\/miniforge\/envs/)
  assert.doesNotMatch(condarc, /bin\/miniconda\/envs/)
  assert.doesNotMatch(condarc, /\bdefaults\b/)
  assert.doesNotMatch(condarc, /auto_accept_tos/)
  assert.equal(await pathExists(path.join(root, 'bin', 'miniforge')), false)
})

test('Conda pins the managed Conda and Python versions consistently', async () => {
  assert.equal(CONDA_PIN_VERSION, '26.5.3')
  assert.equal(PYTHON_INSTALL_SPEC, 'python=3.10.20')
  assert.equal(WINDOWS_PYTHON_SSL_FIX_SPEC, 'python=3.10.20=*_1_cpython')

  assert.equal(isExpectedCondaPinned('26.5.3'), true)
  assert.equal(isExpectedCondaPinned('26.3.2'), false)

  assert.equal(isExpectedPythonPinned('darwin', '3.10.20', 'cpython'), true)
  assert.equal(isExpectedPythonPinned('linux', '3.10.20', 'cpython'), true)
  assert.equal(isExpectedPythonPinned('darwin', '3.10.21', 'cpython'), false)
  assert.equal(isExpectedPythonPinned('darwin', '3.11.0', 'cpython'), false)
  assert.equal(isExpectedPythonPinned('win32', '3.10.20', 'h4de0772_0_cpython'), false)
  assert.equal(isExpectedPythonPinned('win32', '3.10.20', 'h4de0772_1_cpython'), true)
})

test('Conda init writes the current Conda pin into an existing runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-pin-init-'))
  await createMiniforge(root)
  await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })

  await createConda(createKernel(root, 'darwin')).init()

  assert.equal(
    await fs.readFile(path.join(root, 'bin', 'miniforge', 'conda-meta', 'pinned'), 'utf8'),
    'conda ==26.5.3'
  )
})

test('Conda init leaves Windows OpenSSL activation hooks untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-hooks-untouched-'))
  const hookRoot = path.join(root, 'bin', 'miniforge', 'etc', 'conda')
  const hookFiles = [
    path.join('activate.d', 'openssl_activate-win.bat'),
    path.join('activate.d', 'openssl_activate-win.ps1'),
    path.join('activate.d', 'openssl_activate-win.sh'),
    path.join('deactivate.d', 'openssl_deactivate-win.bat'),
    path.join('deactivate.d', 'openssl_deactivate-win.ps1'),
    path.join('deactivate.d', 'openssl_deactivate-win.sh'),
  ]
  await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
  for (const relativePath of hookFiles) {
    const hookPath = path.join(hookRoot, relativePath)
    await fs.mkdir(path.dirname(hookPath), { recursive: true })
    await fs.writeFile(hookPath, `upstream ${relativePath}\n`)
  }

  await createConda(createKernel(root, 'win32')).init()

  for (const relativePath of hookFiles) {
    assert.equal(
      await fs.readFile(path.join(hookRoot, relativePath), 'utf8'),
      `upstream ${relativePath}\n`
    )
  }
})

test('Conda install requests the Python 3.10.20 pin on macOS/Linux', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-python-pin-darwin-'))
  const kernel = createKernel(root, 'darwin')
  const calls = []

  kernel.bin.mods = []
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    calls.push(payload)
    if (payload && payload.conda && payload.conda.skip) {
      await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
    }
  }

  await createConda(kernel)._install({ dependencies: [] }, () => {})

  assert.equal(await pathExists(path.join(root, 'bin', 'miniconda')), true)
  const condaInstall = calls.find((call) => Array.isArray(call.message))
  assert.ok(condaInstall)
  assert.equal(
    condaInstall.message[1],
    'conda install -y --override-channels -c conda-forge "conda=26.5.3" "python=3.10.20" "conda-libmamba-solver>=25.4.0"'
  )
  assert.equal(
    await fs.readFile(path.join(root, 'bin', 'miniforge', 'conda-meta', 'pinned'), 'utf8'),
    'conda ==26.5.3'
  )
})

test('Conda install keeps the Windows Python 3.10.20 SSL-fixed build pin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-python-pin-win32-'))
  const kernel = createKernel(root, 'win32')
  const calls = []

  kernel.bin.mods = []
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    calls.push(payload)
    if (payload && payload.conda && payload.conda.skip) {
      const miniforge = path.join(root, 'bin', 'miniforge')
      await fs.mkdir(path.join(miniforge, 'conda-meta'), { recursive: true })
      await fs.writeFile(path.join(miniforge, 'python.exe'), 'fake python\n')
    }
  }

  await createConda(kernel)._install({ dependencies: [] }, () => {})

  assert.equal(await pathExists(path.join(root, 'bin', 'miniconda')), true)
  const condaInstall = calls.find((call) => Array.isArray(call.message))
  assert.ok(condaInstall)
  assert.equal(
    condaInstall.message[1],
    'conda install -y --override-channels -c conda-forge "conda=26.5.3" "python=3.10.20=*_1_cpython" "conda-libmamba-solver>=25.4.0"'
  )
})

test('Conda install replaces the stale runtime and rebuilds declared Conda modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-full-reset-'))
  const staleRoot = await createMiniforge(root)
  const staleMarker = path.join(staleRoot, 'stale-runtime.txt')
  await fs.writeFile(staleMarker, 'remove me\n')
  const kernel = createKernel(root, 'darwin')
  const calls = []

  kernel.bin.mods = [
    { name: 'uv', mod: { cmd: () => 'uv=0.11.23' } },
    { name: 'node', mod: { cmd: () => 'nodejs=22.21.1 pnpm' } },
  ]
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    calls.push(payload)
    if (payload && payload.conda && payload.conda.skip) {
      await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
    }
  }

  await createConda(kernel)._install({ dependencies: ['uv', 'node'] }, () => {})

  assert.equal(await pathExists(staleMarker), false)
  const condaInstall = calls.find((call) => Array.isArray(call.message))
  assert.ok(condaInstall)
  assert.equal(
    condaInstall.message[1],
    'conda install -y --override-channels -c conda-forge "conda=26.5.3" "python=3.10.20" "conda-libmamba-solver>=25.4.0" uv=0.11.23 nodejs=22.21.1 pnpm'
  )
})

test('Conda replacement stops, preserves, and restarts a running managed Caddy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-caddy-lifecycle-'))
  await createMiniforge(root)
  const kernel = createKernel(root, 'win32')
  const events = []
  let caddyRunning = true
  let condaInstall

  const caddy = {
    cmd: () => 'caddy=2.9.1',
    running: async () => caddyRunning,
    stop: async () => {
      events.push('caddy-stop')
      caddyRunning = false
    },
    start: async () => {
      events.push('caddy-start')
      caddyRunning = true
    },
  }
  kernel.bin.installed.conda = new Set(['caddy'])
  kernel.bin.mod = { caddy }
  kernel.bin.mods = [{ name: 'caddy', mod: caddy }]
  kernel.bin.download = async () => events.push('download')
  kernel.bin.rm = async () => events.push('installer-cleanup')
  kernel.bin.exec = async (payload) => {
    if (payload && payload.conda && payload.conda.skip) {
      events.push('bootstrap')
      const miniforge = path.join(root, 'bin', 'miniforge')
      await fs.mkdir(path.join(miniforge, 'conda-meta'), { recursive: true })
      await fs.writeFile(path.join(miniforge, 'python.exe'), 'fake python\n')
      return
    }
    events.push('conda-install')
    condaInstall = payload
  }

  const conda = createConda(kernel)
  const removeInstallPath = conda.removeInstallPath.bind(conda)
  conda.removeInstallPath = async (target) => {
    assert.equal(caddyRunning, false)
    events.push('remove-miniforge')
    await removeInstallPath(target)
  }

  await conda._install({ dependencies: [] }, () => {})

  assert.ok(events.indexOf('caddy-stop') < events.indexOf('remove-miniforge'))
  assert.ok(events.indexOf('remove-miniforge') < events.indexOf('bootstrap'))
  assert.ok(events.indexOf('conda-install') < events.indexOf('caddy-start'))
  assert.match(condaInstall.message[1], / caddy=2\.9\.1$/)
  assert.equal(caddyRunning, true)
})

test('Conda install replaces legacy miniconda with a compatibility alias to miniforge', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-miniforge-alias-'))
  const legacy = await createLegacyMiniconda(root)
  await fs.writeFile(path.join(legacy, 'legacy.txt'), 'old runtime\n')
  const kernel = createKernel(root, 'darwin')

  kernel.bin.mods = []
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    if (payload && payload.conda && payload.conda.skip) {
      await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
    }
  }

  await createConda(kernel)._install({ dependencies: [] }, () => {})

  const miniforge = path.join(root, 'bin', 'miniforge')
  const miniconda = path.join(root, 'bin', 'miniconda')
  assert.equal(await pathExists(path.join(miniconda, 'legacy.txt')), false)
  assert.equal(await fs.realpath(miniconda), await fs.realpath(miniforge))
})

test('Conda install removes legacy miniconda symlinks without deleting their target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-legacy-symlink-'))
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-external-'))
  await fs.writeFile(path.join(external, 'keep.txt'), 'do not delete\n')
  await fs.mkdir(path.join(root, 'bin'), { recursive: true })
  await fs.symlink(external, path.join(root, 'bin', 'miniconda'), 'dir')
  const kernel = createKernel(root, 'darwin')

  kernel.bin.mods = []
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    if (payload && payload.conda && payload.conda.skip) {
      await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
    }
  }

  await createConda(kernel)._install({ dependencies: [] }, () => {})

  assert.equal(await pathExists(path.join(external, 'keep.txt')), true)
  assert.equal(await fs.realpath(path.join(root, 'bin', 'miniconda')), await fs.realpath(path.join(root, 'bin', 'miniforge')))
})

test('Conda installed stays false when metadata check already marked Conda invalid', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-metadata-invalid-'))
  await createMiniforge(root)
  const kernel = createKernel(root)
  kernel.bin.correct_conda = false

  assert.equal(await createConda(kernel).installed(), false)
})

test('Conda check rejects metadata-only Windows installs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-smoke-missing-'))
  await writeHealthyCondaMeta(root, 'win32')

  assert.equal(await createConda(createKernel(root, 'win32')).check(), false)
})

test('Conda check rejects a runnable runtime with the previous Conda version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-version-stale-'))
  await writeHealthyCondaMeta(root, 'win32', '26.3.2')
  await writeFakeManagedConda(root, 'win32')

  assert.equal(await createConda(createKernel(root, 'win32')).check(), false)
})

test('Conda check accepts a runnable managed Windows conda executable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-smoke-runnable-'))
  await writeHealthyCondaMeta(root, 'win32')
  await writeFakeManagedConda(root, 'win32')

  assert.equal(await createConda(createKernel(root, 'win32')).check(), true)
})

test('Bin readiness rejects the previous Conda version and accepts the pinned version', async () => {
  const staleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-bin-conda-version-stale-'))
  await writeHealthyCondaMeta(staleRoot, 'win32', '26.3.2')
  await writeFakeManagedConda(staleRoot, 'win32')
  const staleBin = createBin(staleRoot, 'win32')

  await staleBin.tryList()
  assert.equal(staleBin.correct_conda, false)

  const currentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-bin-conda-version-current-'))
  await writeHealthyCondaMeta(currentRoot, 'win32')
  await writeFakeManagedConda(currentRoot, 'win32')
  const currentBin = createBin(currentRoot, 'win32')

  await currentBin.tryList()
  assert.equal(currentBin.correct_conda, true)
})

test('Conda install keeps the old runtime when the replacement installer download fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-download-fails-'))
  const miniforge = await createMiniforge(root)
  const oldRuntimeFile = path.join(miniforge, 'old-runtime.txt')
  await fs.writeFile(oldRuntimeFile, 'keep me\n')
  const kernel = createKernel(root)

  kernel.bin.download = async () => {
    throw new Error('download failed')
  }

  await assert.rejects(
    createConda(kernel)._install({ dependencies: [] }, () => {}),
    /download failed/
  )
  assert.equal(await pathExists(oldRuntimeFile), true)
})

test('Conda install propagates bootstrap failure after replacing the runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-bootstrap-fails-'))
  await createMiniforge(root)
  const kernel = createKernel(root, 'darwin')

  kernel.bin.mods = []
  kernel.bin.download = async () => {}
  kernel.bin.rm = async () => {}
  kernel.bin.exec = async (payload) => {
    if (payload && payload.conda && payload.conda.skip) {
      await fs.mkdir(path.join(root, 'bin', 'miniforge', 'conda-meta'), { recursive: true })
      return
    }
    throw new Error('bootstrap failed')
  }

  await assert.rejects(
    createConda(kernel)._install({ dependencies: [] }, () => {}),
    /bootstrap failed/
  )
})

test('Conda install reports manual recovery when the old runtime cannot be removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-conda-runtime-locked-'))
  await createLegacyMiniconda(root)
  const kernel = createKernel(root)
  kernel.bin.download = async () => {}
  const conda = createConda(kernel)
  const originalRm = fsModule.promises.rm

  fsModule.promises.rm = async () => {
    const error = new Error('resource busy')
    error.code = 'EBUSY'
    throw error
  }

  try {
    await assert.rejects(
      conda._install({ dependencies: [] }, () => {}),
      /delete that folder manually/
    )
  } finally {
    fsModule.promises.rm = originalRm
  }
})
