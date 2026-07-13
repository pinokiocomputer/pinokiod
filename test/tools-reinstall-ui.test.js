const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const test = require("node:test")
const ejs = require("ejs")
const { JSDOM } = require("jsdom")

const viewPath = path.resolve(__dirname, "../server/views/tools.ejs")
const setupViewPath = path.resolve(__dirname, "../server/views/setup.ejs")

async function renderTools() {
  const source = await fs.readFile(viewPath, "utf8")
  return ejs.render(source, {
    agent: "web",
    bundles: [{
      name: "dev",
      title: "Coding (Essential)",
      description: "Essential tools",
      install_required: false,
      requirements: [{ name: "conda", type: "bin", installed: true }],
    }],
    installs: [],
    pending: false,
    theme: "dark",
  }, {
    filename: viewPath,
    includer: () => ({ template: "" }),
  })
}

test("Tools reinstall immediately submits a fresh install request", async (t) => {
  const html = await renderTools()
  let submission
  const dom = new JSDOM(html, {
    url: "http://localhost/tools",
  })
  t.after(() => dom.window.close())

  const form = dom.window.document.querySelector('.tools-bundle-actions form[action="/pinokio/install?fresh=1"]')
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    submission = {
      action: `${new URL(form.action).pathname}${new URL(form.action).search}`,
      fields: Object.fromEntries(new dom.window.FormData(form)),
    }
  })
  const button = form.querySelector("button[type=submit]")
  button.click()

  assert.deepEqual(submission, {
    action: "/pinokio/install?fresh=1",
    fields: {
      requirements: '[{"name":"conda","type":"bin","installed":true}]',
      callback: "/tools",
    },
  })
})

test("setup fresh install immediately submits the existing install form", async () => {
  const source = await fs.readFile(setupViewPath, "utf8")
  assert.match(source, /<button class="task-button" type="submit" form="install-form" formaction="\/pinokio\/install\?fresh=1">/)
  assert.doesNotMatch(source, /id="del-bin"|setup-reset-loading/)
})
