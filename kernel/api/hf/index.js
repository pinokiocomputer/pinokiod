const unparse = require('yargs-unparser-custom-flag');
const Shell = require('../shell')
const Util = require('../../util')
const HtmlModal = require('../htmlmodal')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const positiveNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
const escapeHtml = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;")

class HF {
  constructor() {
    this.htmlModal = new HtmlModal()
  }
  connect(kernel, method) {
    if (!kernel || !kernel.connect || typeof kernel.connect[method] !== "function") {
      throw new Error(`Hugging Face connect ${method} is not available`)
    }
    return kernel.connect
  }
  safeKeys(keys) {
    if (!keys || !keys.access_token) {
      return keys
    }
    return {
      token_path: keys.token_path
    }
  }
  async copyCode(login, ondata, options = {}) {
    if (!login || !login.user_code) {
      return null
    }
    try {
      await Util.clipboard({
        type: "copy",
        text: login.user_code
      })
      if (ondata && !options.silent) {
        ondata({ raw: `\r\nHugging Face code copied to clipboard: ${login.user_code}\r\n` })
      }
      return { ok: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      if (ondata && !options.silent) {
        ondata({ raw: `\r\nCopy this Hugging Face code into the browser: ${login.user_code}\r\n` })
        ondata({ raw: `Clipboard copy failed: ${message}\r\n` })
      }
      return { ok: false, error: message }
    }
  }
  canDispatchModal(req, ondata, kernel) {
    return !!(
      ondata
      && kernel
      && kernel.api
      && typeof kernel.api.wait === "function"
      && req
      && req.parent
      && (req.parent.id || req.parent.path)
    )
  }
  canUseModal(req, ondata, kernel, url) {
    return !!(url && this.canDispatchModal(req, ondata, kernel))
  }
  modalRequest(req, modalId, params = {}) {
    return {
      params: Object.assign({ id: modalId }, params),
      parent: req.parent,
      cwd: req.cwd
    }
  }
  modalId(req) {
    const id = req && req.parent ? (req.parent.id || req.parent.path) : "hf-login"
    return `hf-login:${id}`
  }
  loginModalHtml(login, clipboard) {
    const code = escapeHtml(login.user_code || "")
    const expires = login.expires_in
      ? `<p class="hf-login-modal-note">Expires in ${escapeHtml(login.expires_in)} seconds.</p>`
      : ""
    let copyText = "Copy this code if Hugging Face asks for it."
    let copyClass = "neutral"
    if (clipboard && clipboard.ok) {
      copyText = "The code has been copied to your clipboard."
      copyClass = "success"
    } else if (clipboard && clipboard.ok === false) {
      copyText = `Clipboard copy failed. The code is displayed below.`
      copyClass = "warning"
    }
    return `
      <div class="hf-login-modal">
        <div class="hf-login-modal-copy ${copyClass}">${escapeHtml(copyText)}</div>
        <div class="hf-login-modal-code" aria-label="Hugging Face device code">${code}</div>
        ${expires}
        <p>Open Hugging Face to finish login. Pinokio will continue automatically.</p>
      </div>
    `
  }
  async promptLoginModal(req, ondata, kernel, login, clipboard) {
    const modalId = this.modalId(req)
    const response = await this.htmlModal.open(
      this.modalRequest(req, modalId, {
        title: "Log in to Hugging Face",
        variant: "minimal",
        html: this.loginModalHtml(login, clipboard),
        status: { text: "Waiting for you to open Hugging Face.", waiting: false },
        actions: [{
          id: "open",
          label: "Open Hugging Face",
          type: "submit",
          href: login.verification_uri_complete,
          target: "_blank",
          features: "browser",
          primary: true,
          close: false,
          icon: "fa-solid fa-arrow-up-right-from-square"
        }, {
          id: "cancel",
          label: "Cancel",
          type: "submit",
          variant: "secondary"
        }],
        actionsAlign: "end",
        await: true,
        dismissible: false
      }),
      ondata,
      kernel
    )

    if (!response || response.action === "cancel" || response.action === "dismissed") {
      await this.htmlModal.close(this.modalRequest(req, modalId), ondata, kernel)
      throw new Error("Hugging Face login canceled.")
    }

    await this.htmlModal.update(
      this.modalRequest(req, modalId, {
        variant: "minimal",
        status: { text: "Waiting for Hugging Face authorization to finish...", waiting: true },
        actions: [{
          id: "open-again",
          label: "Open Again",
          type: "link",
          href: login.verification_uri_complete,
          target: "_blank",
          features: "browser",
          variant: "secondary",
          icon: "fa-solid fa-arrow-up-right-from-square"
        }],
        actionsAlign: "end",
        dismissible: false
      }),
      ondata,
      kernel
    )
    return response
  }
  async closeLoginModal(req, ondata, kernel) {
    if (!this.canDispatchModal(req, ondata, kernel)) {
      return
    }
    await this.htmlModal.close(this.modalRequest(req, this.modalId(req)), ondata, kernel)
  }
  authContext(req = {}, params = {}) {
    return {
      parentPath: req.parent && req.parent.path,
      cwd: req.cwd,
      env: params.env,
    }
  }
  async cancelLogin(connect, params) {
    if (connect && typeof connect.cancelLogin === "function") {
      await connect.cancelLogin("huggingface", params || {})
    }
  }
  /*
  {
    "method": "hf.login",
    "params": {
      "force": false,
      "open": true,
      "modal": true,
      "clipboard": true,
      "wait": true,
      "timeout": 120000,
      "interval": 2000
    }
  }

  Starts the existing Hugging Face device login provider. By default it shows a
  blocking modal with the copied code and waits for the user to open the
  verification URL before polling for the managed token.
  */
  async login(req, ondata, kernel) {
    const connect = this.connect(kernel, "keys")
    const params = req.params || {}
    const force = params.force === true
    const shouldOpen = params.open !== false
    const shouldModal = params.modal !== false
    const shouldCopy = params.clipboard !== false
    const shouldWait = params.wait !== false
    const timeout = positiveNumber(params.timeout, 120000)
    const interval = positiveNumber(params.interval, 2000)
    const authContext = this.authContext(req, params)

    if (!force) {
      const existing = await connect.keys("huggingface", authContext)
      if (existing && existing.access_token) {
        return {
          status: "success",
          already_logged_in: true,
          ...this.safeKeys(existing)
        }
      }
    }

    if (typeof connect.login !== "function") {
      throw new Error("Hugging Face connect login is not available")
    }
    const response = await connect.login("huggingface", params, authContext)
    if (!response || response.status === "error") {
      return response
    }

    const login = response.login || {}
    const url = login.verification_uri_complete
    const useModal = shouldModal && this.canUseModal(req, ondata, kernel, url)
    if (shouldCopy && login.user_code) {
      response.clipboard = await this.copyCode(login, ondata, { silent: useModal })
    } else if (login.user_code && ondata && !useModal) {
      ondata({ raw: `\r\nHugging Face code: ${login.user_code}\r\n` })
    }

    if (useModal) {
      try {
        response.open = await this.promptLoginModal(req, ondata, kernel, login, response.clipboard)
      } catch (error) {
        await this.cancelLogin(connect, params)
        throw error
      }
    } else if (shouldOpen && url) {
      if (ondata) {
        if (!shouldModal) {
          ondata({ raw: "\r\nHugging Face login modal disabled.\r\n" })
        }
        const codeHint = response.clipboard && response.clipboard.ok
          ? "The code is already on your clipboard; paste it if Hugging Face asks."
          : "If Hugging Face asks for a code, use the code printed above."
        ondata({ raw: `Opening Hugging Face login: ${url}\r\n${codeHint}\r\n` })
        if (response.clipboard && response.clipboard.ok === false) {
          ondata({ raw: "The browser is opening even though clipboard copy failed.\r\n" })
        }
      }
      response.open = await Util.openURI(url)
    }

    if (!shouldWait) {
      if (useModal) {
        await this.closeLoginModal(req, ondata, kernel)
      }
      return response
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      const keys = await connect.keys("huggingface", authContext)
      if (keys && keys.access_token) {
        if (useModal) {
          await this.closeLoginModal(req, ondata, kernel)
        }
        return {
          ...response,
          status: "success",
          ...this.safeKeys(keys)
        }
      }
      await delay(interval)
    }

    if (useModal) {
      await this.closeLoginModal(req, ondata, kernel)
    }
    await this.cancelLogin(connect, params)
    return {
      ...response,
      status: "timeout",
      error: "Timed out waiting for Hugging Face login to finish."
    }
  }
  /*
  {
    "method": "hf.logout"
  }
  */
  async logout(req, ondata, kernel) {
    const connect = this.connect(kernel, "logout")
    const params = req.params || {}
    await connect.logout("huggingface", params, this.authContext(req, params))
    return { status: "success" }
  }
  /*
  {
    "method": "hf.download",
    "params": {
      path: <cwd>,
      env: {
        <env1>: <val1>,
        <env1>: <val1>,
        <env1>: <val1>,
      },
      _: [<command line args>'],
      <arg1>: <val1>,
      <arg2>: <val2>,
      ...
    }
  }
  */
  async download(req, ondata, kernel) {
    const shell = new Shell()
    let params = Object.assign({}, req.params)
    delete params.env
    delete params.path
    let chunks = unparse(params)
    let message = [
      `hf download ${chunks.join(" ")}` + (kernel.platform === "win32" ? " && dir" : " ; ls")
    ]
    console.log({ message, before: req.params.message })
    req.params.message = message
    let res = await shell.run(req, ondata, kernel)
    return res
  }
  /*
  {
    "method": "hf.upload",
    "params": {
      path: <cwd>,
      env: {
        <env1>: <val1>,
        <env1>: <val1>,
        <env1>: <val1>,
      },
      _: [<command line args>'],
      <arg1>: <val1>,
      <arg2>: <val2>,
      ...
    }
  }
  */
  async upload(req, ondata, kernel) {
    const shell = new Shell()
    let params = Object.assign({}, req.params)
    delete params.env
    delete params.path
    const positional = Array.isArray(params._) ? params._ : (params._ == null ? [] : [params._])
    params._ = ["hf", "upload", ...positional]
    let message = [
      params
    ]
    req.params.message = message
    let res = await shell.run(req, ondata, kernel)
    return res
  }
}
module.exports = HF
