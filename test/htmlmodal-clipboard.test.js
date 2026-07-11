const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const htmlModalPath = path.resolve(__dirname, '../server/public/htmlmodal.js')

async function createModalDom(options = {}) {
  const script = await fs.readFile(htmlModalPath, 'utf8')
  const opened = []
  const dom = new JSDOM(`<!doctype html><html><head></head><body><script>${script}</script></body></html>`, {
    url: 'http://127.0.0.1:42000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (options.clipboard) {
        Object.defineProperty(window.navigator, 'clipboard', {
          configurable: true,
          value: options.clipboard
        })
      }
      if (options.execCommand) {
        window.document.execCommand = options.execCommand
      }
      window.open = (...args) => {
        opened.push(args)
      }
    }
  })

  if (!dom.window.HtmlModal) {
    await new Promise((resolve) => dom.window.addEventListener('DOMContentLoaded', resolve, { once: true }))
  }
  if (options.agent) {
    dom.window.document.body.setAttribute('data-agent', options.agent)
  }
  return { dom, manager: dom.window.HtmlModal, opened }
}

function openCopyModal(manager) {
  manager.handle({
    id: 'packet',
    data: {
      action: 'open',
      id: 'hf-login:test',
      html: '<div class="hf-login-modal-copy custom-class">Copy this code.</div>',
      actions: [{
        id: 'open',
        label: 'Open Hugging Face',
        type: 'submit',
        href: 'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
        target: '_blank',
        features: 'browser',
        copyText: 'ABCD-EFGH',
        copyFeedbackSelector: '.hf-login-modal-copy'
      }]
    }
  }, null)
  manager.actions.querySelector('button').click()
}

test('html modal copies action text from the user click and opens a client-side web tab', async () => {
  const copied = []
  const { manager, opened } = await createModalDom({
    clipboard: {
      async writeText(value) {
        copied.push(value)
      }
    }
  })
  openCopyModal(manager)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(copied, ['ABCD-EFGH'])
  assert.deepEqual(opened, [[
    'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
    '_blank'
  ]])
  const feedback = manager.body.querySelector('.hf-login-modal-copy')
  assert.equal(feedback.textContent, 'The code has been copied to your clipboard.')
  assert.equal(feedback.classList.contains('custom-class'), true)
  assert.equal(feedback.classList.contains('success'), true)
})

test('html modal keeps the Electron external-browser hint', async () => {
  const { manager, opened } = await createModalDom({
    agent: 'electron',
    clipboard: { async writeText() {} }
  })
  openCopyModal(manager)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(opened, [[
    'https://huggingface.co/oauth/device?user_code=ABCD-EFGH',
    '_blank',
    'browser'
  ]])
})

test('html modal reports fallback copy failure and removes its temporary textarea', async () => {
  const { dom, manager } = await createModalDom({
    execCommand() {
      throw new Error('copy denied')
    }
  })
  openCopyModal(manager)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const feedback = manager.body.querySelector('.hf-login-modal-copy')
  assert.equal(feedback.textContent, 'Clipboard copy failed. Copy the displayed code manually.')
  assert.equal(feedback.classList.contains('custom-class'), true)
  assert.equal(feedback.classList.contains('warning'), true)
  assert.equal(dom.window.document.querySelectorAll('body > textarea').length, 0)
})
