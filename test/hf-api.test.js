const assert = require('node:assert/strict')
const test = require('node:test')

const HF = require('../kernel/api/hf')
const Util = require('../kernel/util')

const login = {
  verification_uri_complete: 'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
  user_code: 'ABCD-EFGH',
  expires_in: 300
}

test('hf.login shows a modal, waits for the user to open Hugging Face, then closes after saved keys', async () => {
  const hf = new HF()
  const packets = []
  const actions = []
  const originalOpenURI = Util.openURI
  const originalClipboard = Util.clipboard
  let keyReads = 0
  const keyContexts = []
  const loginCalls = []
  const waitCalls = []
  const kernel = {
    connect: {
      async keys(provider, context) {
        assert.equal(provider, 'huggingface')
        keyContexts.push(context)
        keyReads += 1
        if (keyReads < 3) {
          return null
        }
        return {
          access_token: 'hf_secret',
          token_path: '/tmp/pinokio/hf-token'
        }
      },
      async login(provider, params, context) {
        loginCalls.push({ provider, params, context })
        return {
          status: 'pending',
          login,
          token_path: '/tmp/pinokio/hf-token'
        }
      }
    },
    api: {
      async wait(key) {
        waitCalls.push(key)
        return { action: 'open' }
      }
    }
  }

  Util.clipboard = async (req) => {
    actions.push({ type: 'clipboard', req })
  }
  Util.openURI = async (uri) => {
    actions.push({ type: 'openURI', uri })
    return { ok: true, status: 'stubbed' }
  }

  try {
    const request = {
      parent: { id: 'test-script', path: '/pinokio/api/test/hf-login.js' },
      params: {
        timeout: 100,
        interval: 1
      }
    }
    const result = await hf.login(request, (stream, type) => packets.push({ type, stream }), kernel)

    const authContext = {
      parentPath: '/pinokio/api/test/hf-login.js',
      cwd: undefined,
      env: undefined
    }
    assert.deepEqual(loginCalls, [{
      provider: 'huggingface',
      params: request.params,
      context: authContext
    }])
    assert.equal(loginCalls[0].params, request.params)
    assert.equal(keyContexts.length, 3)
    assert.equal(keyContexts.every((context) => context === loginCalls[0].context), true)
    assert.deepEqual(waitCalls, ['/pinokio/api/test/hf-login.js'])
    assert.deepEqual(actions, [{
      type: 'clipboard',
      req: {
        type: 'copy',
        text: 'ABCD-EFGH'
      }
    }])

    assert.equal(packets.length, 3)
    assert.equal(packets[0].type, 'htmlmodal')
    assert.equal(packets[0].stream.action, 'open')
    assert.equal(packets[0].stream.variant, 'minimal')
    assert.equal(packets[0].stream.actionsAlign, 'end')
    assert.equal(packets[0].stream.await, true)
    assert.equal(packets[0].stream.awaitKey, '/pinokio/api/test/hf-login.js')
    assert.equal(packets[0].stream.dismissible, false)
    assert.match(packets[0].stream.html, /ABCD-EFGH/)
    assert.match(packets[0].stream.html, /copied to your clipboard/)
    assert.deepEqual(packets[0].stream.actions[0], {
      id: 'open',
      label: 'Open Hugging Face',
      type: 'submit',
      href: 'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
      target: '_blank',
      features: 'browser',
      copyText: 'ABCD-EFGH',
      copyFeedbackSelector: '.hf-login-modal-copy',
      primary: true,
      close: false,
      icon: 'fa-solid fa-arrow-up-right-from-square'
    })

    assert.equal(packets[1].type, 'htmlmodal')
    assert.equal(packets[1].stream.action, 'update')
    assert.equal(packets[1].stream.variant, 'minimal')
    assert.equal(packets[1].stream.actionsAlign, 'end')
    assert.equal(packets[1].stream.status.waiting, true)
    assert.deepEqual(packets[1].stream.actions[0], {
      id: 'open-again',
      label: 'Open Again',
      type: 'link',
      href: 'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
      target: '_blank',
      features: 'browser',
      variant: 'secondary',
      icon: 'fa-solid fa-arrow-up-right-from-square'
    })

    assert.equal(packets[2].type, 'htmlmodal')
    assert.equal(packets[2].stream.action, 'close')

    assert.deepEqual(result, {
      status: 'success',
      login,
      token_path: '/tmp/pinokio/hf-token',
      clipboard: { ok: true },
      open: { action: 'open' }
    })
  } finally {
    Util.openURI = originalOpenURI
    Util.clipboard = originalClipboard
  }
})

test('hf.login returns success without opening anything when already logged in', async () => {
  const hf = new HF()
  const opened = []
  const copied = []
  const originalOpenURI = Util.openURI
  const originalClipboard = Util.clipboard
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return {
          access_token: 'hf_secret',
          token_path: '/tmp/pinokio/hf-token'
        }
      }
    }
  }

  Util.openURI = async (uri) => {
    opened.push(uri)
    return { ok: true, status: 'stubbed' }
  }
  Util.clipboard = async (req) => {
    copied.push(req)
  }

  try {
    const result = await hf.login({ params: {} }, () => {}, kernel)

    assert.deepEqual(opened, [])
    assert.deepEqual(copied, [])
    assert.deepEqual(result, {
      status: 'success',
      already_logged_in: true,
      token_path: '/tmp/pinokio/hf-token'
    })
  } finally {
    Util.openURI = originalOpenURI
    Util.clipboard = originalClipboard
  }
})

test('hf.login can use the non-modal browser fallback when modal is disabled', async () => {
  const hf = new HF()
  const opened = []
  const copied = []
  const output = []
  const originalOpenURI = Util.openURI
  const originalClipboard = Util.clipboard
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return null
      },
      async login(provider, params, context) {
        assert.equal(provider, 'huggingface')
        assert.deepEqual(params, { modal: false, wait: false })
        assert.deepEqual(context, {
          parentPath: undefined,
          cwd: undefined,
          env: undefined
        })
        return {
          status: 'pending',
          login,
          token_path: '/tmp/pinokio/hf-token'
        }
      }
    }
  }

  Util.clipboard = async (req) => {
    copied.push(req)
  }
  Util.openURI = async (uri) => {
    opened.push(uri)
    return { ok: true, status: 'stubbed' }
  }

  try {
    const result = await hf.login({ params: { modal: false, wait: false } }, (chunk) => output.push(chunk), kernel)

    assert.deepEqual(copied, [{
      type: 'copy',
      text: 'ABCD-EFGH'
    }])
    assert.deepEqual(opened, ['https://huggingface.co/oauth/device?user_code=ABCD-EFGH'])
    assert.deepEqual(output, [
      { raw: '\r\nHugging Face code copied to clipboard: ABCD-EFGH\r\n' },
      { raw: '\r\nHugging Face login modal disabled.\r\n' },
      { raw: 'Opening Hugging Face login: https://huggingface.co/oauth/device?user_code=ABCD-EFGH\r\nThe code is already on your clipboard; paste it if Hugging Face asks.\r\n' }
    ])
    assert.deepEqual(result, {
      status: 'pending',
      login,
      token_path: '/tmp/pinokio/hf-token',
      clipboard: { ok: true },
      open: { ok: true, status: 'stubbed' }
    })
  } finally {
    Util.openURI = originalOpenURI
    Util.clipboard = originalClipboard
  }
})

test('hf.login modal displays clipboard failure without opening the browser automatically', async () => {
  const hf = new HF()
  const packets = []
  const opened = []
  const originalOpenURI = Util.openURI
  const originalClipboard = Util.clipboard
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return null
      },
      async login(provider) {
        assert.equal(provider, 'huggingface')
        return {
          status: 'pending',
          login,
          token_path: '/tmp/pinokio/hf-token'
        }
      }
    },
    api: {
      async wait() {
        return { action: 'open' }
      }
    }
  }

  Util.clipboard = async () => {
    throw new Error('clipboard denied')
  }
  Util.openURI = async (uri) => {
    opened.push(uri)
    return { ok: true, status: 'stubbed' }
  }

  try {
    const result = await hf.login({
      parent: { id: 'test-script' },
      params: { wait: false }
    }, (stream, type) => packets.push({ type, stream }), kernel)

    assert.deepEqual(opened, [])
    assert.equal(packets.length, 3)
    assert.match(packets[0].stream.html, /Clipboard copy failed/)
    assert.match(packets[0].stream.html, /ABCD-EFGH/)
    assert.equal(packets[1].stream.action, 'update')
    assert.equal(packets[2].stream.action, 'close')
    assert.deepEqual(result, {
      status: 'pending',
      login,
      token_path: '/tmp/pinokio/hf-token',
      clipboard: { ok: false, error: 'clipboard denied' },
      open: { action: 'open' }
    })
  } finally {
    Util.openURI = originalOpenURI
    Util.clipboard = originalClipboard
  }
})

test('hf.login cancels the pending provider login when the modal is canceled', async () => {
  const hf = new HF()
  const packets = []
  const cancelCalls = []
  const originalClipboard = Util.clipboard
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return null
      },
      async login(provider) {
        assert.equal(provider, 'huggingface')
        return {
          status: 'pending',
          login,
          token_path: '/tmp/pinokio/hf-token'
        }
      },
      async cancelLogin(provider, params) {
        cancelCalls.push({ provider, params })
      }
    },
    api: {
      async wait() {
        return { action: 'cancel' }
      }
    }
  }

  Util.clipboard = async () => {}

  try {
    await assert.rejects(
      () => hf.login({
        parent: { id: 'test-script' },
        params: { force: true }
      }, (stream, type) => packets.push({ type, stream }), kernel),
      /Hugging Face login canceled/
    )

    assert.deepEqual(cancelCalls, [{
      provider: 'huggingface',
      params: { force: true }
    }])
    assert.equal(packets.at(-1).stream.action, 'close')
  } finally {
    Util.clipboard = originalClipboard
  }
})

test('hf.login cancels the pending provider login after timeout', async () => {
  const hf = new HF()
  const cancelCalls = []
  const originalClipboard = Util.clipboard
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return null
      },
      async login(provider) {
        assert.equal(provider, 'huggingface')
        return {
          status: 'pending',
          login,
          token_path: '/tmp/pinokio/hf-token'
        }
      },
      async cancelLogin(provider, params) {
        cancelCalls.push({ provider, params })
      }
    },
    api: {
      async wait() {
        return { action: 'open' }
      }
    }
  }

  Util.clipboard = async () => {}

  try {
    const result = await hf.login({
      parent: { id: 'test-script' },
      params: { timeout: 1, interval: 1 }
    }, () => {}, kernel)

    assert.equal(result.status, 'timeout')
    assert.deepEqual(cancelCalls, [{
      provider: 'huggingface',
      params: { timeout: 1, interval: 1 }
    }])
  } finally {
    Util.clipboard = originalClipboard
  }
})

test('hf.logout delegates to the Hugging Face connect provider and returns success', async () => {
  const hf = new HF()
  const req = { params: {} }
  const calls = []
  const kernel = {
    connect: {
      async logout(provider, params, context) {
        calls.push({ method: 'logout', provider, params, context })
      }
    }
  }

  const result = await hf.logout(req, () => {}, kernel)

  assert.deepEqual(result, { status: 'success' })
  assert.deepEqual(calls, [{
    method: 'logout',
    provider: 'huggingface',
    params: req.params,
    context: {
      parentPath: undefined,
      cwd: undefined,
      env: undefined
    }
  }])
})

test('hf.upload runs hf upload through shell.run with Hugging Face CLI args', async () => {
  const hf = new HF()
  const calls = []
  const kernel = {
    platform: 'darwin',
    shell: {
      async run(params, options) {
        calls.push({
          params,
          options
        })
        return { status: 'success' }
      }
    }
  }
  const req = {
    cwd: '/pinokio/api/test',
    parent: { id: 'test-script' },
    params: {
      path: '/pinokio/api/test/output',
      env: { TEST_ENV: '1' },
      _: ['cocktailpeanut/privatetest', './output', '.'],
      'repo-type': 'dataset',
      private: true,
      'commit-message': 'initial upload'
    }
  }

  const result = await hf.upload(req, () => {}, kernel)

  assert.deepEqual(result, { status: 'success' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].params.message, [
    {
      _: ['hf', 'upload', 'cocktailpeanut/privatetest', './output', '.'],
      'repo-type': 'dataset',
      private: true,
      'commit-message': 'initial upload'
    }
  ])
  assert.deepEqual(calls[0].params.env, { TEST_ENV: '1' })
  assert.equal(calls[0].params.path, '/pinokio/api/test/output')
  assert.equal(calls[0].params.bluefairy, 'off')
  assert.equal(calls[0].options.cwd, '/pinokio/api/test')
  assert.equal(calls[0].options.group, 'test-script')
})

test('hf.login reports unavailable Hugging Face connect provider', async () => {
  const hf = new HF()

  await assert.rejects(
    () => hf.login({ params: {} }, () => {}, {}),
    /Hugging Face connect keys is not available/
  )
})

test('hf.login reports unavailable Hugging Face login starter after checking existing keys', async () => {
  const hf = new HF()
  const kernel = {
    connect: {
      async keys(provider) {
        assert.equal(provider, 'huggingface')
        return null
      }
    }
  }

  await assert.rejects(
    () => hf.login({ params: {} }, () => {}, kernel),
    /Hugging Face connect login is not available/
  )
})
