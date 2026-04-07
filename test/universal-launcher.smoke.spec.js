const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.PINOKIO_BASE_URL || 'http://127.0.0.1:42000';

async function createTask(request, { title, target, template }) {
  const createResponse = await request.post(`${BASE_URL}/tasks`, {
    form: {
      title,
      description: '',
      target,
      template,
      inputsJson: '[]',
    },
  });
  expect(createResponse.ok()).toBeTruthy();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listResponse = await request.get(
      `${BASE_URL}/api/tasks?target=${encodeURIComponent(target)}&q=${encodeURIComponent(title)}`
    );
    expect(listResponse.ok()).toBeTruthy();
    const payload = await listResponse.json();
    const match = Array.isArray(payload.items)
      ? payload.items.find((item) => item && item.title === title)
      : null;
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Failed to create task: ${title}`);
}

async function deleteTask(request, id) {
  if (!id) {
    return;
  }
  await request.post(`${BASE_URL}/tasks/${encodeURIComponent(id)}/delete`);
}

async function getHomeFrame(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const homeFrame = page.frames().find((frame) => frame.url() && frame.url().startsWith(`${BASE_URL}/home`));
  if (!homeFrame) {
    throw new Error('Could not find /home frame.');
  }
  return homeFrame;
}

async function openLauncher(page, intent) {
  const homeFrame = await getHomeFrame(page);
  const trigger = homeFrame.locator(`[data-universal-launcher-open="${intent}"]`);
  await expect(trigger).toHaveCount(1);
  await trigger.dispatchEvent('click');
  const overlay = homeFrame.locator('.universal-launcher-overlay:not([hidden])').first();
  await expect(overlay).toBeVisible();
  return homeFrame;
}

test.describe('universal launcher smoke', () => {
  test('create app, create plugin, and ask launch without runtime errors', async ({ page, request }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const uniqueToken = Date.now().toString(36);
    const tempApiTaskTitle = `Codex API Smoke ${uniqueToken}`;
    const tempPluginTaskTitle = `Codex Plugin Smoke ${uniqueToken}`;
    let tempApiTask = null;
    let tempPluginTask = null;

    page.on('pageerror', (error) => {
      pageErrors.push(String(error));
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    try {
      tempApiTask = await createTask(request, {
        title: tempApiTaskTitle,
        target: 'api',
        template: 'Create an API app from this template.',
      });
      tempPluginTask = await createTask(request, {
        title: tempPluginTaskTitle,
        target: 'plugin',
        template: 'Create a plugin from this template.',
      });

      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

      const homeFrame = await openLauncher(page, 'create_app');
      const createAppTemplateToggle = homeFrame.locator('.universal-launcher-template-toggle:not([hidden])').first();
      const nameInput = homeFrame.locator('.universal-launcher-section-name .universal-launcher-input').first();
      const promptTextarea = homeFrame.locator('.universal-launcher-textarea').first();
      await expect(createAppTemplateToggle).toContainText('Use template');
      await createAppTemplateToggle.click();
      await expect(homeFrame.getByText(tempApiTaskTitle)).toBeVisible();
      await expect(homeFrame.getByText(tempPluginTaskTitle)).toHaveCount(0);
      await homeFrame.getByText(tempApiTaskTitle).click();
      await homeFrame.locator('.universal-launcher-template-modal').getByRole('button', { name: 'Use template' }).click();
      await expect(promptTextarea).toHaveValue('Create an API app from this template.');
      await expect(nameInput).toHaveValue('');

      await openLauncher(page, 'create_plugin');
      const createPluginTemplateToggle = homeFrame.locator('.universal-launcher-template-toggle:not([hidden])').first();
      await expect(createPluginTemplateToggle).toContainText('Use template');
      await createPluginTemplateToggle.click();
      await expect(homeFrame.getByText(tempPluginTaskTitle)).toBeVisible();
      await expect(homeFrame.getByText(tempApiTaskTitle)).toHaveCount(0);
      await homeFrame.getByText(tempPluginTaskTitle).click();
      await homeFrame.locator('.universal-launcher-template-modal').getByRole('button', { name: 'Use template' }).click();
      await expect(promptTextarea).toHaveValue('Create a plugin from this template.');
      await expect(nameInput).toHaveValue('');

      await openLauncher(page, 'ask');
      const askTemplateToggle = homeFrame.locator('.universal-launcher-template-toggle').first();
      await expect(askTemplateToggle).toBeHidden();
      await expect(homeFrame.locator('.universal-launcher-suggestion-row').first()).toBeVisible();
      await expect(homeFrame.locator('.universal-launcher-template-label').first()).toContainText('Pinokio Researcher');
      await expect(homeFrame.getByText(tempApiTaskTitle)).toHaveCount(0);
      await expect(homeFrame.getByText(tempPluginTaskTitle)).toHaveCount(0);

      expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
      expect(
        consoleErrors.filter((line) => !line.includes('favicon')),
        `console errors: ${consoleErrors.join('\n')}`
      ).toEqual([]);
    } finally {
      await deleteTask(request, tempApiTask && tempApiTask.id);
      await deleteTask(request, tempPluginTask && tempPluginTask.id);
    }
  });
});
