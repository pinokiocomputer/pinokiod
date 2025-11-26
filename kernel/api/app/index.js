const fs = require('fs')
const { promisify } = require('util')
const { execFile } = require('child_process')
const HtmlModal = require('../htmlmodal')
const Util = require('../../util')

const DEFAULT_INSTALL_TIMEOUT = 5 * 60 * 1000
const DEFAULT_INSTALL_INTERVAL = 5000
const execFileAsync = promisify(execFile)

const escapeHtml = (value = '') => {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case '\'':
        return '&#39;'
      default:
        return char
    }
  })
}

class AppAPI {
  constructor() {
    this.htmlModal = new HtmlModal()
  }

  ensureService(kernel) {
    if (!kernel.appLauncher) {
      throw new Error('App launcher service is unavailable')
    }
    return kernel.appLauncher
  }

  async launch(req, ondata, kernel) {
    /*
      {
        "method": "app.launch",
        "params": {
          "id": <optional app id>,
          "app": <name when id missing>,
          "args": [<arg>, ...],
          "refresh": <force reindex boolean>,
          "install": <install url>,
          "installTimeout": <ms to wait>,
          "installPollInterval": <poll frequency ms>
        }
      }
    */
    const params = req.params || {}
    const launcher = this.ensureService(kernel)
    try {
      const result = await launcher.launch({
        id: params.id,
        app: params.app || params.name,
        args: params.args,
        refresh: params.refresh,
        install: params.install
      })
      return result
    } catch (error) {
      if (params.install && error && error.code === 'APP_NOT_FOUND') {
        return await this.handleInstallFlow({ req, ondata, kernel, launcher, params })
      }
      throw error
    }
  }

  async search(req, ondata, kernel) {
    /*
      {
        "method": "app.search",
        "params": {
          "query": <text>,
          "limit": <max results>,
          "refresh": <force reindex boolean>
        }
      }
    */
    const params = req.params || {}
    const launcher = this.ensureService(kernel)
    return launcher.search({
      query: params.query || params.app || params.name || '',
      limit: params.limit || 25,
      refresh: params.refresh
    })
  }

  async info(req, ondata, kernel) {
    /*
      {
        "method": "app.info",
        "params": {
          "id": <required app id>,
          "refresh": <force reindex boolean>
        }
      }
    */
    const params = req.params || {}
    if (!params.id) {
      throw new Error('app.info requires params.id')
    }
    const launcher = this.ensureService(kernel)
    return launcher.info({ id: params.id, refresh: params.refresh })
  }

  async refresh(req, ondata, kernel) {
    /*
      {
        "method": "app.refresh",
        "params": {
          "force": <optional flag propagated to adapter>
        }
      }
    */
    const launcher = this.ensureService(kernel)
    return launcher.refresh(req && req.params ? req.params : {})
  }
}

AppAPI.prototype.sleep = function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

AppAPI.prototype.modalRequest = function modalRequest(req, modalId, params = {}) {
  return {
    params: Object.assign({ id: modalId }, params),
    parent: req.parent,
    cwd: req.cwd
  }
}

AppAPI.prototype.buildInstallActions = function buildInstallActions(appName, installUrl, extraActions = []) {
  const actions = []
  if (installUrl) {
    actions.push({
      id: 'install-link',
      label: `Install ${appName}`,
      type: 'link',
      href: installUrl,
      variant: 'link',
      icon: 'fa-solid fa-arrow-up-right-from-square'
    })
  }
  return actions.concat(extraActions || [])
}

AppAPI.prototype.buildReadyActions = function buildReadyActions({ appName, installUrl, entry, needsManualLaunch }) {
  const actions = this.buildInstallActions(appName, installUrl)
  if (needsManualLaunch) {
    actions.push({
      id: 'reveal',
      label: 'Open in Finder',
      type: 'submit',
      variant: 'secondary',
      close: false
    })
    actions.push({
      id: 'confirm-launch',
      label: `I've opened ${entry.name || appName}`,
      type: 'submit',
      primary: true,
      close: false
    })
    actions.push({
      id: 'cancel',
      label: 'Cancel',
      type: 'submit',
      variant: 'secondary'
    })
  } else {
    actions.push({
      id: 'launch',
      label: `Open ${entry.name || appName}`,
      type: 'submit',
      primary: true
    })
    actions.push({
      id: 'cancel',
      label: 'Cancel',
      type: 'submit',
      variant: 'secondary'
    })
  }
  return actions
}

AppAPI.prototype.installIntroHtml = function installIntroHtml(appName, installUrl) {
  const safeName = escapeHtml(appName)
  const safeUrl = escapeHtml(installUrl)
  return `
    <p>Pinokio could not find <strong>${safeName}</strong> on this system.</p>
    <p>Click <em>Install ${safeName}</em> to open the official download page (${safeUrl}). Keep this window open; Pinokio will monitor for the installation automatically.</p>
  `
}

AppAPI.prototype.installReadyHtml = function installReadyHtml(appName) {
  const safeName = escapeHtml(appName)
  return `
    <p><strong>${safeName}</strong> was detected successfully.</p>
    <p>Click <em>Open ${safeName}</em> to launch the application now.</p>
  `
}

AppAPI.prototype.manualLaunchHtml = function manualLaunchHtml(appName) {
  const safeName = escapeHtml(appName)
  return `
    <p>macOS needs you to open <strong>${safeName}</strong> manually the first time.</p>
    <ol>
      <li>Click <em>Open in Finder</em> to reveal the app.</li>
      <li>Double-click ${safeName} in Finder and choose <em>Open</em> when macOS asks for confirmation.</li>
      <li>Return here and click <em>I've opened ${safeName}</em>.</li>
    </ol>
  `
}

AppAPI.prototype.buildManualConfirmActions = function buildManualConfirmActions(appName) {
  return [
    {
      id: 'reveal',
      label: 'Open in Finder',
      type: 'submit',
      variant: 'secondary',
      close: false
    },
    {
      id: 'confirm-open',
      label: `I've opened ${appName}`,
      type: 'submit',
      variant: 'primary',
      primary: true,
      close: false
    }
  ]
}

AppAPI.prototype.handleInstallFlow = async function handleInstallFlow({ req, ondata, kernel, launcher, params }) {
  const installUrl = params.install
  if (!installUrl) {
    throw new Error('Install URL is required when install flow is requested')
  }
  const appName = params.app || params.name || params.id || 'the application'
  const modalId = `app-install:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

  const pollInterval = Number(params.installPollInterval) > 0 ? Number(params.installPollInterval) : DEFAULT_INSTALL_INTERVAL
  const timeout = Number(params.installTimeout) > 0 ? Number(params.installTimeout) : DEFAULT_INSTALL_TIMEOUT

  const actions = this.buildInstallActions(appName, installUrl)

  await this.htmlModal.open(
    this.modalRequest(req, modalId, {
      title: `Install ${appName}`,
      html: this.installIntroHtml(appName, installUrl),
      status: { text: `Waiting for ${escapeHtml(appName)} to be installed...`, waiting: true },
      actions,
      dismissible: true
    }),
    ondata,
    kernel
  )

  const entry = await this.waitForInstall({
    req,
    ondata,
    kernel,
    launcher,
    appName,
    modalId,
    pollInterval,
    timeout,
    actions
  })

  if (!entry) {
    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        status: { text: `Still cannot find ${escapeHtml(appName)}. Please complete the installation and try again.`, variant: 'error' },
        actions: this.buildInstallActions(appName, installUrl, [{
          id: 'close',
          label: 'Close',
          type: 'submit',
          variant: 'secondary',
          close: true
        }]),
        await: true
      }),
      ondata,
      kernel
    )
    await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
    throw new Error(`Timed out waiting for ${appName} to be installed`)
  }

  const needsManualLaunch = await this.requiresManualLaunch(entry, kernel)
  const readyPayload = {
    title: entry.name || appName,
    html: needsManualLaunch ? this.manualLaunchHtml(entry.name || appName) : this.installReadyHtml(entry.name || appName),
    status: needsManualLaunch
      ? { text: `Open ${escapeHtml(entry.name || appName)} once from Finder, then confirm below.` }
      : { text: `${escapeHtml(entry.name || appName)} detected.`, variant: 'success' },
    actions: this.buildReadyActions({ appName, installUrl, entry, needsManualLaunch }),
    await: true,
    dismissible: true
  }

  let readyResponse
  while (true) {
    readyResponse = await this.htmlModal.update(
      this.modalRequest(req, modalId, readyPayload),
      ondata,
      kernel
    )
    if (!readyResponse) {
      continue
    }
    if (readyResponse.action === 'reveal') {
      await this.openInExplorer(entry.path, kernel)
      readyPayload.status = {
        text: `Opened Finder at ${escapeHtml(entry.name || appName)}. After approving it, click "I've opened it".`,
      }
      continue
    }
    if (['cancel', 'close', 'dismissed'].includes(readyResponse.action)) {
      await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
      throw new Error('Launch cancelled by user')
    }
    if (readyResponse.action === 'launch' || readyResponse.action === 'confirm-launch') {
      break
    }
  }

  try {
    const launchResult = await launcher.launch({
      id: entry.id,
      app: entry.name,
      args: params.args
    })
    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        status: { text: `Opening ${escapeHtml(entry.name || appName)}...`, variant: 'success' },
        actions: [],
        dismissible: true
      }),
      ondata,
      kernel
    )
    await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
    return launchResult
  } catch (err) {
    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        status: { text: `Failed to launch ${escapeHtml(entry.name || appName)}: ${escapeHtml(err.message || 'Unknown error')}`, variant: 'error' },
        actions: this.buildInstallActions(appName, installUrl, [{
          id: 'close',
          label: 'Close',
          type: 'submit',
          variant: 'secondary',
          close: true
        }]),
        await: true
      }),
      ondata,
      kernel
    )
    await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
    throw err
  }
}

AppAPI.prototype.waitForInstall = async function waitForInstall({ req, ondata, kernel, launcher, appName, modalId, pollInterval, timeout, actions }) {
  const start = Date.now()
  let attempt = 0
  while ((Date.now() - start) < timeout) {
    await this.sleep(pollInterval)
    attempt += 1
    try {
      await launcher.refresh({ force: true })
    } catch (_) {
    }
    const match = await launcher.findMatch(appName, { force: false })
    if (match && match.entry) {
      return match.entry
    }
    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        status: { text: `Waiting for ${escapeHtml(appName)} (check #${attempt})...`, waiting: true },
        actions
      }),
      ondata,
      kernel
    )
  }
  return null
}

AppAPI.prototype.waitForManualConfirmation = async function waitForManualConfirmation({ req, ondata, kernel, entry, appName, modalId }) {
  const safeName = escapeHtml(entry.name || appName)
  const readyId = modalId || `app-ready:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const payload = {
    title: entry.name || appName,
    html: this.manualLaunchHtml(entry.name || appName),
    status: { text: `Open ${safeName} once from Finder, then confirm below.` },
    actions: this.buildManualConfirmActions(entry.name || appName),
    actionsAlign: 'end',
    await: true,
    dismissible: false
  }

  while (true) {
    const response = modalId
      ? await this.htmlModal.update(this.modalRequest(req, readyId, payload), ondata, kernel)
      : await this.htmlModal.open(this.modalRequest(req, readyId, payload), ondata, kernel)
    if (!response) {
      continue
    }
    if (response.action === 'reveal') {
      await this.openInExplorer(entry.path, kernel)
      payload.status = {
        text: `Opened Finder at ${safeName}. After approving it, click "I've opened it".`
      }
      continue
    }
    if (['cancel', 'close', 'dismissed'].includes(response.action)) {
      await this.htmlModal.close(this.modalRequest(req, readyId, {}), ondata, kernel)
      throw new Error('Wait cancelled by user')
    }
    if (response.action === 'confirm-open') {
      await this.htmlModal.update(
        this.modalRequest(req, readyId, {
          status: { text: `${safeName} is ready.`, variant: 'success' },
          actions: [],
          dismissible: true
        }),
        ondata,
        kernel
      )
      await this.htmlModal.close(this.modalRequest(req, readyId, {}), ondata, kernel)
      return entry
    }
  }
}

AppAPI.prototype.waitForAppPresence = async function waitForAppPresence(req, ondata, kernel) {
  const params = req.params || {}
  const appName = params.app || params.name || params.id
  if (!appName) {
    throw new Error('process.wait requires params.app or params.id when using app presence mode')
  }
  const launcher = this.ensureService(kernel)
  const pollInterval = Number(params.installPollIntervalMs || params.installPollInterval) > 0
    ? Number(params.installPollIntervalMs || params.installPollInterval)
    : DEFAULT_INSTALL_INTERVAL
  const timeout = Number(params.installTimeoutMs || params.installTimeout) > 0
    ? Number(params.installTimeoutMs || params.installTimeout)
    : DEFAULT_INSTALL_TIMEOUT

  let entry = null
  if (params.id) {
    try {
      entry = await launcher.info({ id: params.id, refresh: params.refresh })
    } catch (_) {
    }
  }
  if (!entry) {
    const match = await launcher.findMatch(appName, { force: false })
    if (match && match.entry) {
      entry = match.entry
    }
  }

  if (entry) {
    return entry
  }

  const installUrl = params.install
  if (!installUrl) {
    const error = new Error(`Application "${appName}" was not found and no install URL was provided`)
    error.code = 'APP_NOT_FOUND'
    throw error
  }

  const modalId = `app-install:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const actions = this.buildInstallActions(appName, installUrl)

  await this.htmlModal.open(
    this.modalRequest(req, modalId, {
      title: `Install ${appName}`,
      html: this.installIntroHtml(appName, installUrl),
      status: { text: `Waiting for ${escapeHtml(appName)} to be installed...`, waiting: true },
      actions,
      dismissible: false
    }),
    ondata,
    kernel
  )

  entry = await this.waitForInstall({
    req,
    ondata,
    kernel,
    launcher,
    appName,
    modalId,
    pollInterval,
    timeout,
    actions
  })

  if (!entry) {
    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        status: { text: `Still cannot find ${escapeHtml(appName)}. Please complete the installation and try again.`, variant: 'error' },
        actions: this.buildInstallActions(appName, installUrl, [{
          id: 'close',
          label: 'Close',
          type: 'submit',
          variant: 'secondary',
          close: true
        }]),
        await: true
      }),
      ondata,
      kernel
    )
    await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
    throw new Error(`Timed out waiting for ${appName} to be installed`)
  }

  const needsManualLaunch = await this.requiresManualLaunch(entry, kernel)
  await this.htmlModal.update(
    this.modalRequest(req, modalId, {
      status: { text: `${escapeHtml(entry.name || appName)} detected.`, variant: 'success' },
      actions: [],
      dismissible: true
    }),
    ondata,
    kernel
  )
  await this.htmlModal.close(this.modalRequest(req, modalId, {}), ondata, kernel)
  return entry
}

AppAPI.prototype.requiresManualLaunch = async function requiresManualLaunch(entry, kernel) {
  if (!entry || kernel.platform !== 'darwin') {
    return false
  }
  if (!entry.path) {
    return false
  }
  try {
    await fs.promises.access(entry.path)
  } catch (_) {
    return false
  }
  try {
    await execFileAsync('xattr', ['-p', 'com.apple.quarantine', entry.path])
    return true
  } catch (error) {
    if (error && typeof error.code !== 'undefined') {
      if (error.code === 1) {
        return false
      }
    }
    if (error && error.stderr && /No such xattr/i.test(error.stderr)) {
      return false
    }
  }
  return false
}

AppAPI.prototype.openInExplorer = async function openInExplorer(targetPath, kernel) {
  if (!targetPath) {
    return
  }
  try {
    Util.openfs(targetPath, { action: 'view' }, kernel)
  } catch (error) {
    console.warn('[app.launch] Failed to open file explorer:', error && error.message ? error.message : error)
  }
}

module.exports = AppAPI
