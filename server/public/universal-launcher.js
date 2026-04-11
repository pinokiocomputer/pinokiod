(function(window, document) {
  'use strict';

  if (window.UniversalLauncher) {
    return;
  }

  const CATEGORY_ORDER = ['CLI', 'IDE'];
  const TOOL_PREFERENCE_KEY = 'pinokio.universalLauncher.tool';
  const NAME_VALIDATION_DEBOUNCE_MS = 260;
  const ATTACHMENTS_ENABLED = false;
  const RECENT_TASK_LIMIT = 5;
  const DOWNLOAD_SHELL_CLIENT = {
    cols: 120,
    rows: 32,
  };
  const NON_INTERACTIVE_GIT_ENV = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
  };
  const FALLBACK_TOOLS = [
    {
      value: 'code/claude',
      label: 'Claude Code',
      iconSrc: '/asset/plugin/code/claude/claude.png',
      isDefault: true,
      category: 'CLI',
    },
    {
      value: 'code/codex',
      label: 'OpenAI Codex',
      iconSrc: '/asset/plugin/code/codex/openai.webp',
      isDefault: false,
      category: 'CLI',
    },
    {
      value: 'code/gemini',
      label: 'Google Gemini CLI',
      iconSrc: '/asset/plugin/code/gemini/gemini.jpeg',
      isDefault: false,
      category: 'CLI',
    },
  ];
  const INTENTS = {
    create_app: {
      label: 'Create app',
      title: 'Create App',
      description: 'Create a reusable Pinokio app.',
      usesName: true,
      targetLabel: 'Creates in PINOKIO_HOME/api',
      promptLabel: 'What should this app do?',
      promptPlaceholder: 'Examples: "a 1-click launcher for ComfyUI", "I want to clone a website to run locally", "convert files from one format to another".',
      confirmLabel: 'Create',
      advancedLabel: 'Advanced',
      advancedHref: '/init',
    },
    ask: {
      label: 'Ask Pinokio',
      title: 'Ask Pinokio',
      description: 'Ask Pinokio anything. Pinokio can work with tools and agents to answer questions and get things done.',
      usesName: false,
      targetLabel: '',
      promptLabel: 'What should Pinokio do?',
      promptPlaceholder: 'Examples: "Would llama.cpp work on my machine?", "What is using the most memory right now?", "Generate a video of a cat.", "Is https://github.com/foo/bar safe to install?"',
      toolLabel: 'Choose tool',
      confirmLabel: 'Run',
    },
    create_plugin: {
      label: 'Create plugin',
      title: 'Create Plugin',
      description: 'Create a new Pinokio plugin folder and open it with the selected tool.',
      usesName: true,
      targetLabel: 'Creates in PINOKIO_HOME/plugin',
      promptLabel: 'What should this plugin do?',
      promptPlaceholder: 'Describe the Pinokio plugin you want to build.',
      promptSeed: 'A Pinokio plugin for: ',
      confirmLabel: 'Create',
    },
  };

  let cachedTools = null;
  let loadingTools = null;
  let cachedTasks = null;
  let loadingTasks = null;
  let modalPromise = null;
  let modalInstance = null;
  let keydownHandler = null;
  let previousFocus = null;
  let modalOpen = false;

  function normalizeIntent(value) {
    return Object.prototype.hasOwnProperty.call(INTENTS, value) ? value : 'create_app';
  }

  function generateNameSuggestion(prompt) {
    if (!prompt) return '';
    return prompt
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resizePromptTextarea(ui) {
    if (!ui || !ui.promptTextarea) {
      return;
    }
    const textarea = ui.promptTextarea;
    if (textarea.hidden || textarea.readOnly) {
      textarea.style.removeProperty('height');
      return;
    }
    const minHeight = normalizeIntent(ui.intent) === 'ask' ? 72 : 88;
    const maxHeight = normalizeIntent(ui.intent) === 'ask' ? 220 : 260;
    textarea.style.height = 'auto';
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${nextHeight}px`;
  }

  function isValidWorkspaceName(value) {
    if (typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 80) {
      return false;
    }
    if (trimmed === '.' || trimmed === '..') {
      return false;
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
      return false;
    }
    return /^[A-Za-z0-9._-]+$/.test(trimmed);
  }

  function getSuggestedTaskWorkspaceName(task, workspaces) {
    const taskName = task && (task.title || task.id) ? String(task.title || task.id) : '';
    const baseName = generateNameSuggestion(taskName) || 'task';
    const existingNames = new Set(
      (Array.isArray(workspaces) ? workspaces : [])
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return '';
          }
          if (typeof item.relative === 'string' && item.relative.trim()) {
            return item.relative.split('/').filter(Boolean)[0] || '';
          }
          return typeof item.name === 'string' ? item.name.trim() : '';
        })
        .filter(Boolean)
        .map((value) => value.toLowerCase())
    );

    let attempt = 0;
    while (attempt < 1000) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const maxBaseLength = Math.max(1, 80 - suffix.length);
      const candidateBase = baseName.slice(0, maxBaseLength) || 'task';
      const candidate = `${candidateBase}${suffix}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      attempt += 1;
    }

    return `${(baseName || 'task').slice(0, 68)}-${Date.now().toString(36).slice(-8)}`;
  }

  function getIntentPromptSeed(intent) {
    const intentConfig = INTENTS[normalizeIntent(intent)];
    return intentConfig && typeof intentConfig.promptSeed === 'string' ? intentConfig.promptSeed : '';
  }

  function intentUsesName(intent) {
    const intentConfig = INTENTS[normalizeIntent(intent)];
    return intentConfig.usesName !== false;
  }

  function buildInitialPrompt(intent, prompt) {
    const seed = getIntentPromptSeed(intent);
    const normalizedPrompt = typeof prompt === 'string' ? prompt : '';
    if (!seed) {
      return normalizedPrompt;
    }
    if (!normalizedPrompt.trim()) {
      return seed;
    }
    return normalizedPrompt.startsWith(seed) ? normalizedPrompt : `${seed}${normalizedPrompt}`;
  }

  function getPromptForNameSuggestion(intent, prompt) {
    const seed = getIntentPromptSeed(intent);
    const normalizedPrompt = typeof prompt === 'string' ? prompt : '';
    if (!seed) {
      return normalizedPrompt.trim();
    }
    return (normalizedPrompt.startsWith(seed)
      ? normalizedPrompt.slice(seed.length)
      : normalizedPrompt).trim();
  }

  function mapPluginMenuToTools(menu) {
    if (!Array.isArray(menu)) return [];

    return menu.map((plugin) => {
      if (!plugin || typeof plugin !== 'object') return null;
      const href = typeof plugin.href === 'string' ? plugin.href.trim() : '';
      if (!href) return null;

      const normalized = href.replace(/^\/run/, '').replace(/^\/+/, '');
      const parts = normalized.split('/').filter(Boolean);
      let value = '';
      if (parts[0] === 'plugin' && parts.length >= 3) {
        value = parts.slice(1, -1).join('/');
      } else {
        value = normalized;
      }
      if (value.endsWith('/pinokio.js')) {
        value = value.replace(/\/pinokio\.js$/i, '');
      }
      if (!value) return null;

      const explicitCategory = typeof plugin.category === 'string' ? plugin.category.trim().toLowerCase() : '';
      const launchType = typeof plugin.launch_type === 'string' ? plugin.launch_type.trim().toLowerCase() : '';
      const runs = Array.isArray(plugin.run) ? plugin.run : [];
      const hasExec = runs.some((step) => step && step.method === 'exec');
      let category = 'CLI';
      if (explicitCategory === 'ide' || launchType === 'desktop' || hasExec) {
        category = 'IDE';
      }

      return {
        value,
        label: plugin.title || plugin.text || plugin.name || value,
        iconSrc: plugin.image || null,
        isDefault: plugin.default === true,
        category,
      };
    }).filter(Boolean);
  }

  async function getTools() {
    if (Array.isArray(cachedTools) && cachedTools.length > 0) {
      return cachedTools;
    }
    if (loadingTools) {
      return loadingTools;
    }
    loadingTools = fetch('/api/plugin/menu')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load plugin menu: ${res.status}`);
        }
        return res.json();
      })
      .then((payload) => {
        const tools = mapPluginMenuToTools(payload && Array.isArray(payload.menu) ? payload.menu : []);
        return tools.length > 0 ? tools : FALLBACK_TOOLS.slice();
      })
      .catch((error) => {
        console.warn('Falling back to default tools for universal launcher', error);
        return FALLBACK_TOOLS.slice();
      })
      .finally(() => {
        loadingTools = null;
      });
    const tools = await loadingTools;
    cachedTools = tools;
    return tools;
  }

  async function getTasks() {
    if (Array.isArray(cachedTasks)) {
      return cachedTasks;
    }
    if (loadingTasks) {
      return loadingTasks;
    }
    loadingTasks = fetch('/api/tasks')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load tasks: ${res.status}`);
        }
        return res.json();
      })
      .then((payload) => {
        return payload && Array.isArray(payload.items) ? payload.items : [];
      })
      .catch((error) => {
        console.warn('Failed to load saved prompts for universal launcher', error);
        return [];
      })
      .finally(() => {
        loadingTasks = null;
      });
    cachedTasks = await loadingTasks;
    return cachedTasks;
  }

  async function getTaskWorkspaces(taskId) {
    const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
    if (!normalizedTaskId) {
      return {
        task: null,
        last_used_ref: '',
        items: [],
      };
    }
    const response = await fetch(`/api/tasks/${encodeURIComponent(normalizedTaskId)}/workspaces`);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload && payload.error ? payload.error : 'Failed to load workspaces.');
    }
    return payload;
  }

  function formatLauncherTimestamp(value) {
    const timestamp = Date.parse(typeof value === 'string' ? value : '');
    if (!Number.isFinite(timestamp)) {
      return '';
    }
    try {
      return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (_) {
      return new Date(timestamp).toISOString();
    }
  }

  function formatRecentLauncherUsage(value) {
    const timestamp = Date.parse(typeof value === 'string' ? value : '');
    if (!Number.isFinite(timestamp)) {
      return '';
    }
    const now = Date.now();
    const diffMs = Math.max(0, now - timestamp);
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor(diffMs / dayMs);
    if (diffDays === 0) {
      return 'Used today';
    }
    if (diffDays === 1) {
      return 'Used yesterday';
    }
    if (diffDays < 7) {
      return `Used ${diffDays}d ago`;
    }
    if (diffDays < 30) {
      return `Used ${Math.floor(diffDays / 7)}w ago`;
    }
    if (diffDays < 365) {
      return `Used ${Math.floor(diffDays / 30)}mo ago`;
    }
    return `Used ${Math.floor(diffDays / 365)}y ago`;
  }

  function getToolCategoryLabel(category) {
    return category === 'IDE' ? 'Desktop app' : category;
  }

  function getStoredToolPreference() {
    try {
      const value = window.localStorage.getItem(TOOL_PREFERENCE_KEY);
      return typeof value === 'string' ? value.trim() : '';
    } catch (_) {
      return '';
    }
  }

  function setStoredToolPreference(value) {
    try {
      if (typeof value === 'string' && value.trim()) {
        window.localStorage.setItem(TOOL_PREFERENCE_KEY, value.trim());
      } else {
        window.localStorage.removeItem(TOOL_PREFERENCE_KEY);
      }
    } catch (_) {}
  }

  function getIntentTaskTarget(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') return 'api';
    if (normalizedIntent === 'create_plugin') return 'plugin';
    return 'workspaces';
  }

  function resolveTaskTarget(task) {
    if (!task || typeof task !== 'object') {
      return '';
    }
    const target = typeof task.target === 'string' ? task.target.trim() : '';
    return target || 'workspaces';
  }

  function taskMatchesSelectionTarget(task, currentTarget) {
    if (!task) {
      return false;
    }
    return resolveTaskTarget(task) === (currentTarget || '');
  }

  function getIntentNameRelativePath(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') return 'api';
    if (normalizedIntent === 'create_plugin') return 'plugin';
    return '';
  }

  function getIntentDownloadPath(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') return 'api';
    if (normalizedIntent === 'create_plugin') return 'plugin';
    return 'tasks';
  }

  function getIntentPrimaryModeLabel(intent) {
    return normalizeIntent(intent) === 'ask' ? 'Ask' : 'Create';
  }

  function getIntentDownloadModeLabel(intent) {
    return 'Download';
  }

  function getIntentImportTitle(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') {
      return 'Import Pinokio app repo';
    }
    if (normalizedIntent === 'create_plugin') {
      return 'Import Pinokio plugin repo';
    }
    return 'Import task repo';
  }

  function getIntentImportIntro(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') {
      return 'Only repositories already structured as Pinokio apps will work here.';
    }
    if (normalizedIntent === 'create_plugin') {
      return 'Only repositories already structured as Pinokio plugins will work here.';
    }
    return 'Only repositories already structured as Pinokio task packages will work here.';
  }

  function getIntentImportHelpHtml(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') {
      return '<p>This is for importing an existing Pinokio launcher repo into <code>PINOKIO_HOME/api</code>.</p><p>Arbitrary GitHub repos will not work unless they already follow the Pinokio app format.</p><p>To make your own from scratch, switch back to <strong>Create</strong>.</p>';
    }
    if (normalizedIntent === 'create_plugin') {
      return '<p>This is for importing an existing Pinokio plugin repo into <code>PINOKIO_HOME/plugin</code>.</p><p>Arbitrary GitHub repos will not work unless they already follow the Pinokio plugin format.</p><p>To make your own from scratch, switch back to <strong>Create</strong>.</p>';
    }
    return '<p>This is for importing an existing task package into <code>PINOKIO_HOME/tasks</code>.</p><p>Arbitrary GitHub repos will not work unless they already follow the Pinokio task package format.</p><p>To make your own from scratch, switch back to <strong>Ask</strong> or save a prompt as a task.</p>';
  }

  function extractUrlLikeNameSuggestion(value) {
    const rawValue = typeof value === 'string' ? value.trim() : '';
    if (!rawValue) {
      return '';
    }

    const scpMatch = rawValue.match(/^(?:[^@\s]+@)?[^:\s/]+:(.+)$/);
    if (scpMatch && scpMatch[1]) {
      const scpSegments = scpMatch[1].split('/').filter(Boolean);
      const scpCandidate = scpSegments.length > 0 ? scpSegments[scpSegments.length - 1] : '';
      return generateNameSuggestion(String(scpCandidate).replace(/\.git$/i, ''));
    }

    let normalizedUrl = rawValue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedUrl)) {
      if (/^[\w.-]+\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`;
      } else {
        return '';
      }
    }

    try {
      const url = new URL(normalizedUrl);
      const segments = url.pathname.split('/').filter(Boolean);
      const genericTrailingSegments = new Set(['index', 'docs', 'documentation', 'readme']);
      let candidate = '';

      if (segments.length > 0) {
        candidate = segments[segments.length - 1];
        const normalizedCandidate = String(candidate).toLowerCase().replace(/\.(html?|md|txt)$/i, '');
        if (segments.length > 1 && genericTrailingSegments.has(normalizedCandidate)) {
          candidate = segments[segments.length - 2];
        }
      }
      if (!candidate) {
        candidate = url.hostname.split('.').filter(Boolean)[0] || '';
      }
      candidate = decodeURIComponent(String(candidate || ''))
        .replace(/\.git$/i, '')
        .replace(/\.(html?|md|txt)$/i, '');
      return generateNameSuggestion(candidate);
    } catch (_) {
      return '';
    }
  }

  function validateLauncherDownloadUrl(value) {
    const rawValue = typeof value === 'string' ? value.trim() : '';
    if (!rawValue) {
      return 'Git URL is required.';
    }
    try {
      const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)
        ? rawValue
        : `https://${rawValue}`;
      const parsed = new URL(normalized);
      if (!parsed.hostname) {
        return 'Enter a valid Git URL.';
      }
      return '';
    } catch (_) {
      return 'Enter a valid Git URL.';
    }
  }

  async function checkLauncherInstallDestinationExists(relativePath, folderName) {
    const response = await fetch('/pinokio/install/exists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        relativePath,
        folderName,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error : 'Could not check destination folder.');
    }
    return Boolean(payload && payload.exists);
  }

  async function suggestAvailableLauncherFolderName(relativePath, baseName) {
    const normalizedBase = generateNameSuggestion(baseName);
    if (!normalizedBase) {
      return '';
    }
    let attempt = 0;
    while (attempt < 100) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const maxBaseLength = Math.max(1, 80 - suffix.length);
      const candidate = `${normalizedBase.slice(0, maxBaseLength)}${suffix}`;
      // eslint-disable-next-line no-await-in-loop
      const exists = await checkLauncherInstallDestinationExists(relativePath, candidate);
      if (!exists) {
        return candidate;
      }
      attempt += 1;
    }
    return normalizedBase;
  }

  function buildDownloadModalShell(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const title = typeof opts.title === 'string' ? opts.title : 'Download from Git URL';
    const subtitle = typeof opts.subtitle === 'string' ? opts.subtitle : '';
    const note = typeof opts.note === 'string' ? opts.note : '';
    const fields = Array.isArray(opts.fields) ? opts.fields : [];
    return `
      <div class="universal-launcher-download-shell">
        <div class="universal-launcher-download-header">
          <div class="universal-launcher-download-icon" aria-hidden="true">
            <i class="fa-solid fa-download"></i>
          </div>
          <div class="universal-launcher-download-heading">
            <div class="universal-launcher-download-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="universal-launcher-download-subtitle">${escapeHtml(subtitle)}</div>` : ''}
          </div>
        </div>
        ${note ? `<div class="universal-launcher-download-note">${note}</div>` : ''}
        <div class="universal-launcher-download-fields">
          ${fields.map((field) => `
            <label class="universal-launcher-download-field" for="${escapeHtml(field.id)}">
              <span class="universal-launcher-download-label">${escapeHtml(field.label)}</span>
              <input
                id="${escapeHtml(field.id)}"
                class="universal-launcher-download-input"
                type="${escapeHtml(field.type || 'text')}"
                placeholder="${escapeHtml(field.placeholder || '')}"
                autocomplete="off"
                spellcheck="false"
              >
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  async function openLauncherDownloadModal(ui) {
    if (!ui || ui.isSubmitting || typeof Swal === 'undefined') {
      return;
    }
    const intent = normalizeIntent(ui.intent);
    const isTaskDownload = intent === 'ask';
    const relativePath = getIntentDownloadPath(intent);
    const title = isTaskDownload ? 'Download task from Git URL' : 'Download from Git URL';
    const subtitle = isTaskDownload
      ? 'Install a reusable task package into your task library.'
      : `Clone a ${intent === 'create_plugin' ? 'plugin' : 'project'} repo into Pinokio.`;
    const note = isTaskDownload
      ? '<span>Will install into <code>~/tasks</code>.</span>'
      : `<span>Will save into <code>~/${escapeHtml(relativePath)}</code>.</span>`;
    const fields = isTaskDownload
      ? [
          {
            id: 'universal-launcher-download-url',
            label: 'Git URL',
            type: 'url',
            placeholder: 'https://github.com/owner/repo',
          },
        ]
      : [
          {
            id: 'universal-launcher-download-url',
            label: 'Git URL',
            type: 'url',
            placeholder: 'https://github.com/owner/repo',
          },
          {
            id: 'universal-launcher-download-name',
            label: 'Folder name',
            type: 'text',
            placeholder: 'repo-name',
          },
        ];

    let folderNameTouched = false;

    const result = await Swal.fire({
      html: buildDownloadModalShell({ title, subtitle, note, fields }),
      showCloseButton: true,
      showCancelButton: true,
      confirmButtonText: 'Download',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusConfirm: false,
      showLoaderOnConfirm: true,
      backdrop: 'rgba(9, 11, 15, 0.58)',
      width: 'min(520px, 92vw)',
      customClass: {
        container: 'universal-launcher-download-container',
        popup: 'pinokio-modern-modal universal-launcher-download-modal',
        htmlContainer: 'pinokio-modern-html universal-launcher-download-html',
        confirmButton: 'pinokio-download-confirm',
        cancelButton: 'pinokio-download-cancel',
        actions: 'pinokio-download-actions',
        closeButton: 'pinokio-modern-close',
        validationMessage: 'pinokio-download-validation',
        loader: 'pinokio-download-loader',
      },
      didOpen: () => {
        const urlInput = document.getElementById('universal-launcher-download-url');
        const nameInput = document.getElementById('universal-launcher-download-name');
        if (urlInput) {
          urlInput.focus();
          urlInput.addEventListener('input', () => {
            if (!nameInput || folderNameTouched) {
              return;
            }
            nameInput.value = extractUrlLikeNameSuggestion(urlInput.value);
          });
        }
        if (nameInput) {
          nameInput.addEventListener('input', () => {
            folderNameTouched = true;
          });
        }
      },
      preConfirm: async () => {
        const urlInput = document.getElementById('universal-launcher-download-url');
        const nameInput = document.getElementById('universal-launcher-download-name');
        const gitUrl = urlInput ? String(urlInput.value || '').trim() : '';
        const urlError = validateLauncherDownloadUrl(gitUrl);
        if (urlError) {
          Swal.showValidationMessage(urlError);
          return false;
        }

        if (!isTaskDownload) {
          const folderName = nameInput ? String(nameInput.value || '').trim() : '';
          if (!folderName) {
            Swal.showValidationMessage('Folder name is required.');
            return false;
          }
          if (!/^[A-Za-z0-9._-]+$/.test(folderName) || folderName === '.' || folderName === '..') {
            Swal.showValidationMessage('Use letters, numbers, ., _, or - for the folder name.');
            return false;
          }
          try {
            const exists = await checkLauncherInstallDestinationExists(relativePath, folderName);
            if (exists) {
              Swal.showValidationMessage('Folder already exists. Choose a different name.');
              return false;
            }
          } catch (error) {
            Swal.showValidationMessage(error && error.message ? error.message : 'Could not check destination folder.');
            return false;
          }
        }

        const response = await fetch('/launcher/download', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            intent,
            ref: gitUrl,
            name: nameInput ? String(nameInput.value || '').trim() : '',
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload || !payload.ok || !payload.url) {
          Swal.showValidationMessage(payload && payload.error ? payload.error : 'Failed to download from Git URL.');
          return false;
        }
        return payload;
      },
    });

    if (result && result.value && result.value.url) {
      window.location.href = result.value.url;
    }
  }

  function buildInlineDownloadSection() {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section universal-launcher-section-download';
    section.hidden = true;

    const { heading, title, note } = buildSectionHeading('', '');
    section.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'universal-launcher-download-inline';
    section.appendChild(body);

    const urlField = document.createElement('label');
    urlField.className = 'universal-launcher-download-field';
    body.appendChild(urlField);

    const urlLabel = document.createElement('span');
    urlLabel.className = 'universal-launcher-download-label';
    urlLabel.textContent = 'Git URL';
    urlField.appendChild(urlLabel);

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'universal-launcher-input universal-launcher-download-input';
    urlInput.placeholder = 'https://github.com/owner/repo';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlField.appendChild(urlInput);

    const nameField = document.createElement('label');
    nameField.className = 'universal-launcher-download-field';
    body.appendChild(nameField);

    const nameLabel = document.createElement('span');
    nameLabel.className = 'universal-launcher-download-label';
    nameLabel.textContent = 'Folder name';
    nameField.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'universal-launcher-input universal-launcher-download-input';
    nameInput.placeholder = 'repo-name';
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameField.appendChild(nameInput);

    const nameStatus = document.createElement('div');
    nameStatus.className = 'universal-launcher-field-status universal-launcher-download-status';
    nameStatus.hidden = true;
    nameField.appendChild(nameStatus);

    const help = document.createElement('details');
    help.className = 'universal-launcher-download-help';
    body.appendChild(help);

    const helpSummary = document.createElement('summary');
    helpSummary.className = 'universal-launcher-download-help-toggle';
    helpSummary.textContent = 'What format is expected?';
    help.appendChild(helpSummary);

    const helpBody = document.createElement('div');
    helpBody.className = 'universal-launcher-download-help-body';
    help.appendChild(helpBody);

    const state = {
      intent: 'create_app',
      drafts: {
        create_app: { url: '', name: '', nameEdited: false },
        ask: { url: '', name: '', nameEdited: false },
        create_plugin: { url: '', name: '', nameEdited: false },
      },
      suggestionToken: 0,
      nameValidationState: 'idle',
      nameValidationMessage: '',
      nameValidationTimer: null,
      nameValidationSeq: 0,
      nameValidationCheckedName: '',
      nameValidationCheckedPath: '',
      onChange: null,
    };

    function getDraft() {
      return state.drafts[normalizeIntent(state.intent)];
    }

    function requiresName() {
      return normalizeIntent(state.intent) !== 'ask';
    }

    function getTargetLabel() {
      const relativePath = getIntentDownloadPath(state.intent);
      return normalizeIntent(state.intent) === 'ask'
        ? `Installs in PINOKIO_HOME/${relativePath}`
        : `Creates in PINOKIO_HOME/${relativePath}`;
    }

    async function maybeAutofillNameFromUrl() {
      if (!requiresName()) {
        return;
      }
      const draft = getDraft();
      if (draft.nameEdited) {
        return;
      }
      const baseSuggestion = extractUrlLikeNameSuggestion(urlInput.value);
      if (!baseSuggestion) {
        draft.name = '';
        nameInput.value = '';
        scheduleNameValidation();
        return;
      }
      const relativePath = getIntentDownloadPath(state.intent);
      const token = (state.suggestionToken || 0) + 1;
      state.suggestionToken = token;
      try {
        const availableSuggestion = await suggestAvailableLauncherFolderName(relativePath, baseSuggestion);
        if (state.suggestionToken !== token || draft.nameEdited) {
          return;
        }
        draft.name = availableSuggestion;
        nameInput.value = availableSuggestion;
        scheduleNameValidation();
      } catch (_) {
        if (state.suggestionToken !== token || draft.nameEdited) {
          return;
        }
        draft.name = baseSuggestion;
        nameInput.value = baseSuggestion;
        scheduleNameValidation();
      }
    }

    function clearNameValidationTimer() {
      if (!state.nameValidationTimer) {
        return;
      }
      window.clearTimeout(state.nameValidationTimer);
      state.nameValidationTimer = null;
    }

    function setNameValidationState(nextState, message) {
      state.nameValidationState = nextState || 'idle';
      state.nameValidationMessage = typeof message === 'string' ? message : '';
      nameStatus.hidden = !state.nameValidationMessage || !requiresName();
      nameStatus.textContent = state.nameValidationMessage;
      nameStatus.className = 'universal-launcher-field-status universal-launcher-download-status';
      if (!nameStatus.hidden && state.nameValidationState) {
        nameStatus.classList.add(`is-${state.nameValidationState}`);
      }
      if (typeof state.onChange === 'function') {
        state.onChange();
      }
    }

    async function runNameValidation(options = {}) {
      clearNameValidationTimer();
      if (!requiresName()) {
        setNameValidationState('idle', '');
        return true;
      }

      const relativePath = getIntentDownloadPath(state.intent);
      const folderName = nameInput.value.trim();
      const shouldShowEmpty = options.showEmpty !== false;

      if (!folderName) {
        state.nameValidationCheckedName = '';
        state.nameValidationCheckedPath = '';
        setNameValidationState(
          shouldShowEmpty ? 'error' : 'idle',
          shouldShowEmpty ? 'Please enter a folder name.' : 'Required. Choose the folder name to create.'
        );
        return false;
      }

      if (!isValidWorkspaceName(folderName)) {
        state.nameValidationCheckedName = '';
        state.nameValidationCheckedPath = '';
        setNameValidationState('error', 'Use letters, numbers, dots, dashes, or underscores only.');
        return false;
      }

      if (
        state.nameValidationState === 'success'
        && state.nameValidationCheckedName === folderName
        && state.nameValidationCheckedPath === relativePath
      ) {
        return true;
      }

      state.nameValidationCheckedName = '';
      state.nameValidationCheckedPath = '';
      const requestId = (state.nameValidationSeq || 0) + 1;
      state.nameValidationSeq = requestId;
      setNameValidationState('checking', 'Checking availability...');

      try {
        const exists = await checkLauncherInstallDestinationExists(relativePath, folderName);
        if (state.nameValidationSeq !== requestId) {
          return false;
        }
        if (exists) {
          setNameValidationState('error', 'A folder with this name already exists.');
          return false;
        }
        state.nameValidationCheckedName = folderName;
        state.nameValidationCheckedPath = relativePath;
        setNameValidationState('success', `Available in PINOKIO_HOME/${relativePath}`);
        return true;
      } catch (error) {
        if (state.nameValidationSeq !== requestId) {
          return false;
        }
        setNameValidationState(
          'error',
          error && error.message ? error.message : 'Failed to check name availability.'
        );
        return false;
      }
    }

    function scheduleNameValidation() {
      clearNameValidationTimer();
      if (!requiresName()) {
        setNameValidationState('idle', '');
        return;
      }

      const relativePath = getIntentDownloadPath(state.intent);
      const folderName = nameInput.value.trim();
      if (!folderName) {
        state.nameValidationSeq = (state.nameValidationSeq || 0) + 1;
        state.nameValidationCheckedName = '';
        state.nameValidationCheckedPath = '';
        setNameValidationState('idle', 'Required. Choose the folder name to create.');
        return;
      }
      if (!isValidWorkspaceName(folderName)) {
        state.nameValidationSeq = (state.nameValidationSeq || 0) + 1;
        state.nameValidationCheckedName = '';
        state.nameValidationCheckedPath = '';
        setNameValidationState('error', 'Use letters, numbers, dots, dashes, or underscores only.');
        return;
      }
      if (
        state.nameValidationState === 'success'
        && state.nameValidationCheckedName === folderName
        && state.nameValidationCheckedPath === relativePath
      ) {
        if (typeof state.onChange === 'function') {
          state.onChange();
        }
        return;
      }
      state.nameValidationSeq = (state.nameValidationSeq || 0) + 1;
      state.nameValidationCheckedName = '';
      state.nameValidationCheckedPath = '';
      state.nameValidationTimer = window.setTimeout(() => {
        state.nameValidationTimer = null;
        runNameValidation({ showEmpty: false });
      }, NAME_VALIDATION_DEBOUNCE_MS);
      if (typeof state.onChange === 'function') {
        state.onChange();
      }
    }

    function syncDraftFromInputs() {
      const draft = getDraft();
      draft.url = urlInput.value;
      draft.name = nameInput.value;
    }

    function render() {
      const draft = getDraft();
      const isTaskDownload = normalizeIntent(state.intent) === 'ask';
      title.textContent = '';
      note.textContent = '';
      note.hidden = true;
      heading.hidden = true;
      heading.classList.add('is-compact');
      helpBody.innerHTML = getIntentImportHelpHtml(state.intent);
      urlInput.value = draft.url || '';
      nameInput.value = draft.name || '';
      nameField.hidden = isTaskDownload;
      nameField.setAttribute('aria-hidden', isTaskDownload ? 'true' : 'false');
      nameInput.placeholder = 'repo-name';
      if (isTaskDownload) {
        setNameValidationState('idle', '');
      } else if (!nameInput.value.trim()) {
        setNameValidationState('idle', 'Required. Choose the folder name to create.');
      } else if (
        state.nameValidationState === 'success'
        && state.nameValidationCheckedName === nameInput.value.trim()
        && state.nameValidationCheckedPath === getIntentDownloadPath(state.intent)
      ) {
        setNameValidationState('success', `Available in PINOKIO_HOME/${getIntentDownloadPath(state.intent)}`);
      } else if (state.nameValidationState === 'error' && state.nameValidationMessage) {
        setNameValidationState('error', state.nameValidationMessage);
      } else {
        setNameValidationState('idle', '');
      }
    }

    urlInput.addEventListener('input', () => {
      const draft = getDraft();
      draft.url = urlInput.value;
      if (requiresName()) {
        maybeAutofillNameFromUrl();
      }
      if (typeof state.onChange === 'function') {
        state.onChange();
      }
    });

    nameInput.addEventListener('input', () => {
      const draft = getDraft();
      draft.nameEdited = true;
      state.suggestionToken = (state.suggestionToken || 0) + 1;
      draft.name = nameInput.value;
      scheduleNameValidation();
    });

    return {
      section,
      urlInput,
      nameInput,
      setIntent(nextIntent) {
        state.intent = normalizeIntent(nextIntent);
        render();
      },
      reset() {
        state.intent = 'create_app';
        state.drafts = {
          create_app: { url: '', name: '', nameEdited: false },
          ask: { url: '', name: '', nameEdited: false },
          create_plugin: { url: '', name: '', nameEdited: false },
        };
        state.suggestionToken = 0;
        clearNameValidationTimer();
        state.nameValidationState = 'idle';
        state.nameValidationMessage = '';
        state.nameValidationSeq = 0;
        state.nameValidationCheckedName = '';
        state.nameValidationCheckedPath = '';
        render();
      },
      isReady() {
        const urlError = validateLauncherDownloadUrl(urlInput.value);
        if (urlError) {
          return false;
        }
        if (!requiresName()) {
          return true;
        }
        return Boolean(nameInput.value.trim())
          && state.nameValidationState === 'success'
          && !state.nameValidationTimer;
      },
      async validateForSubmit() {
        const gitUrl = String(urlInput.value || '').trim();
        const urlError = validateLauncherDownloadUrl(gitUrl);
        if (urlError) {
          return {
            ok: false,
            error: urlError,
            focus: 'url',
          };
        }
        if (!requiresName()) {
          return {
            ok: true,
            payload: {
              ref: gitUrl,
              name: '',
            },
          };
        }
        const isNameReady = await runNameValidation({ showEmpty: true });
        if (!isNameReady) {
          return {
            ok: false,
            error: state.nameValidationMessage || 'Please choose a different name.',
            focus: 'name',
          };
        }
        return {
          ok: true,
          payload: {
            ref: gitUrl,
            name: String(nameInput.value || '').trim(),
          },
        };
      },
      focusPrimaryControl() {
        if (urlInput && typeof urlInput.focus === 'function') {
          urlInput.focus();
          try {
            urlInput.setSelectionRange(urlInput.value.length, urlInput.value.length);
          } catch (_) {}
          return true;
        }
        return false;
      },
      setDisabled(disabled) {
        const nextDisabled = disabled === true;
        urlInput.disabled = nextDisabled;
        nameInput.disabled = nextDisabled;
      },
      set onChange(handler) {
        state.onChange = typeof handler === 'function' ? handler : null;
      },
    };
  }

  function getTaskInputNameSuggestion(task, draftValues) {
    if (!task || !Array.isArray(task.inputs) || !draftValues || typeof draftValues !== 'object') {
      return '';
    }
    const rankedInputs = task.inputs
      .map((input, index) => {
        if (!input || typeof input.name !== 'string') {
          return null;
        }
        const value = typeof draftValues[input.name] === 'string' ? draftValues[input.name].trim() : '';
        if (!value) {
          return null;
        }
        const inputCopy = `${input.name || ''} ${input.label || ''}`.toLowerCase();
        let score = 0;
        if (inputCopy.includes('git') || inputCopy.includes('repo')) score += 4;
        if (inputCopy.includes('url') || inputCopy.includes('uri') || inputCopy.includes('link')) score += 3;
        if (inputCopy.includes('doc')) score += 1;
        return {
          index,
          score,
          value,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.index - b.index;
      });

    for (const candidate of rankedInputs) {
      const suggestion = extractUrlLikeNameSuggestion(candidate.value);
      if (suggestion) {
        return suggestion;
      }
    }
    return '';
  }

  function openTaskTemplateBuilder(defaults) {
    const options = defaults && typeof defaults === 'object' ? defaults : {};
    const url = new URL('/tasks/new', window.location.origin);
    const taskTarget = typeof options.target === 'string' && options.target.trim()
      ? options.target.trim()
      : 'workspaces';
    const template = typeof options.template === 'string'
      ? options.template.trim()
      : '';
    const title = typeof options.title === 'string'
      ? options.title.trim()
      : '';
    url.searchParams.set('target', taskTarget);
    if (options.lockTarget === true) {
      url.searchParams.set('lockTarget', '1');
    }
    if (template) {
      url.searchParams.set('template', template);
    }
    if (title) {
      url.searchParams.set('title', title);
    }
    const popup = window.open(url.toString(), '_blank');
    if (!popup) {
      window.location.href = url.toString();
    }
  }

  function syncShareLink(ui) {
    if (!ui || !ui.shareLink) {
      return;
    }
    if (ui.mode === 'download') {
      ui.shareLink.hidden = true;
      ui.shareLink.setAttribute('aria-hidden', 'true');
      return;
    }
    const meaningfulPrompt = getPromptForNameSuggestion(
      ui.intent,
      ui.promptTextarea ? ui.promptTextarea.value : ''
    ).trim();
    const hideLink = Boolean(
      !meaningfulPrompt
      || (ui.askTaskSection
        && typeof ui.askTaskSection.isTaskMode === 'function'
        && ui.askTaskSection.isTaskMode())
    );
    ui.shareLink.hidden = hideLink;
    ui.shareLink.setAttribute('aria-hidden', hideLink ? 'true' : 'false');
    if (hideLink) {
      return;
    }
    ui.shareLink.href = '#';
    ui.shareLink.dataset.mode = 'task';
    ui.shareLink.textContent = 'Save task';
  }

  function getInlineTaskNameSuggestion(ui) {
    if (!ui || !ui.askTaskSection || typeof ui.askTaskSection.isTaskMode !== 'function' || !ui.askTaskSection.isTaskMode()) {
      return '';
    }
    if (typeof ui.askTaskSection.getSuggestedNameSource === 'function') {
      return ui.askTaskSection.getSuggestedNameSource();
    }
    if (typeof ui.askTaskSection.getRenderedPrompt === 'function') {
      return ui.askTaskSection.getRenderedPrompt();
    }
    return '';
  }

  function shouldAutoPopulateName(intent) {
    return false;
  }

  function syncDerivedName(ui) {
    if (
      !ui
      || ui.mode === 'download'
      || !intentUsesName(ui.intent)
      || !ui.nameInput
      || ui.nameEdited
      || !shouldAutoPopulateName(ui.intent)
    ) {
      return;
    }
    const taskSuggestion = getInlineTaskNameSuggestion(ui);
    const promptSuggestion = (
      ui.askTaskSection
      && typeof ui.askTaskSection.isTaskMode === 'function'
      && ui.askTaskSection.isTaskMode()
    ) ? '' : getPromptForNameSuggestion(
      ui.intent,
      ui.promptTextarea ? ui.promptTextarea.value : ''
    );
    const seed = taskSuggestion || promptSuggestion;
    const nextValue = generateNameSuggestion(seed);
    if (ui.nameInput.value !== nextValue) {
      ui.nameInput.value = nextValue;
    }
    scheduleNameValidation(ui);
  }

  function setNameValidationState(ui, validationState, message) {
    if (!ui || !ui.nameStatus) {
      return;
    }
    ui.nameValidationState = validationState || 'idle';
    ui.nameValidationMessage = typeof message === 'string' ? message : '';
    ui.nameStatus.hidden = !ui.nameValidationMessage;
    ui.nameStatus.textContent = ui.nameValidationMessage;
    ui.nameStatus.className = 'universal-launcher-field-status';
    if (ui.nameValidationMessage) {
      ui.nameStatus.classList.add(`is-${ui.nameValidationState}`);
    }
    updateSubmitAvailability(ui);
  }

  function getEmptyNameValidationMessage(ui) {
    if (!ui || !intentUsesName(ui.intent)) {
      return '';
    }
    return 'Required. Choose the folder name to create.';
  }

  function clearNameValidationTimer(ui) {
    if (!ui || !ui.nameValidationTimer) {
      return;
    }
    window.clearTimeout(ui.nameValidationTimer);
    ui.nameValidationTimer = null;
  }

  async function runNameValidation(ui, options = {}) {
    if (!ui || !intentUsesName(ui.intent) || !ui.nameInput) {
      return true;
    }
    clearNameValidationTimer(ui);

    const relativePath = getIntentNameRelativePath(ui.intent);
    const name = ui.nameInput.value.trim();
    const shouldShowEmpty = options.showEmpty !== false;

    if (!name) {
      ui.nameValidationCheckedName = '';
      ui.nameValidationCheckedPath = '';
      setNameValidationState(ui, shouldShowEmpty ? 'error' : 'idle', shouldShowEmpty ? 'Please enter a name.' : getEmptyNameValidationMessage(ui));
      return false;
    }
    if (!isValidWorkspaceName(name)) {
      ui.nameValidationCheckedName = '';
      ui.nameValidationCheckedPath = '';
      setNameValidationState(ui, 'error', 'Use letters, numbers, dots, dashes, or underscores only.');
      return false;
    }
    if (!relativePath) {
      ui.nameValidationCheckedName = '';
      ui.nameValidationCheckedPath = '';
      setNameValidationState(ui, 'idle', '');
      return true;
    }

    if (
      ui.nameValidationState === 'success'
      && ui.nameValidationCheckedName === name
      && ui.nameValidationCheckedPath === relativePath
    ) {
      return true;
    }

    ui.nameValidationCheckedName = '';
    ui.nameValidationCheckedPath = '';
    const requestId = (ui.nameValidationSeq || 0) + 1;
    ui.nameValidationSeq = requestId;
    setNameValidationState(ui, 'checking', 'Checking availability...');

    try {
      const response = await fetch('/pinokio/install/exists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folderName: name,
          relativePath,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (ui.nameValidationSeq !== requestId) {
        return false;
      }
      if (!response.ok || !payload || typeof payload.exists !== 'boolean') {
        setNameValidationState(ui, 'error', payload && payload.error ? payload.error : 'Failed to check name availability.');
        return false;
      }
      if (payload.exists) {
        setNameValidationState(ui, 'error', 'A folder with this name already exists.');
        return false;
      }
      ui.nameValidationCheckedName = name;
      ui.nameValidationCheckedPath = relativePath;
      setNameValidationState(ui, 'success', `Available in PINOKIO_HOME/${relativePath}`);
      return true;
    } catch (_) {
      if (ui.nameValidationSeq !== requestId) {
        return false;
      }
      setNameValidationState(ui, 'error', 'Failed to check name availability.');
      return false;
    }
  }

  function scheduleNameValidation(ui, options = {}) {
    if (!ui || !intentUsesName(ui.intent) || !ui.nameInput) {
      return;
    }
    clearNameValidationTimer(ui);
    const relativePath = getIntentNameRelativePath(ui.intent);
    const name = ui.nameInput.value.trim();
    if (!name) {
      ui.nameValidationSeq = (ui.nameValidationSeq || 0) + 1;
      ui.nameValidationCheckedName = '';
      ui.nameValidationCheckedPath = '';
      setNameValidationState(ui, 'idle', getEmptyNameValidationMessage(ui));
      return;
    }
    if (!isValidWorkspaceName(name)) {
      ui.nameValidationSeq = (ui.nameValidationSeq || 0) + 1;
      ui.nameValidationCheckedName = '';
      ui.nameValidationCheckedPath = '';
      setNameValidationState(ui, 'error', 'Use letters, numbers, dots, dashes, or underscores only.');
      return;
    }
    if (
      ui.nameValidationState === 'success'
      && ui.nameValidationCheckedName === name
      && ui.nameValidationCheckedPath === relativePath
    ) {
      updateSubmitAvailability(ui);
      return;
    }
    ui.nameValidationSeq = (ui.nameValidationSeq || 0) + 1;
    ui.nameValidationCheckedName = '';
    ui.nameValidationCheckedPath = '';
    const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : NAME_VALIDATION_DEBOUNCE_MS;
    ui.nameValidationTimer = window.setTimeout(() => {
      ui.nameValidationTimer = null;
      runNameValidation(ui, { showEmpty: false });
    }, debounceMs);
    updateSubmitAvailability(ui);
  }

  function buildSectionHeading(titleText, noteText) {
    const heading = document.createElement('div');
    heading.className = 'universal-launcher-section-heading';

    const title = document.createElement('div');
    title.className = 'universal-launcher-section-title';
    title.textContent = titleText;
    heading.appendChild(title);

    let note = null;
    if (typeof noteText === 'string') {
      note = document.createElement('div');
      note.className = 'universal-launcher-section-note';
      note.textContent = noteText;
      heading.appendChild(note);
    }

    return { heading, title, note };
  }

  function humanizeTaskInputName(name) {
    return String(name || '')
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function getTaskInputDisplayLabel(name, inputs) {
    const key = String(name || '').trim();
    if (Array.isArray(inputs)) {
      const match = inputs.find((input) => input && input.name === key);
      if (match && typeof match.label === 'string' && match.label.trim()) {
        return match.label.trim();
      }
    }
    return humanizeTaskInputName(key) || 'Value';
  }

  function renderTaskTemplatePreview(template, values, inputs) {
    const source = values && typeof values === 'object' ? values : {};
    return String(template || '').replace(/{{\s*([^}]+?)\s*}}/g, (_, rawName) => {
      const name = String(rawName || '').trim();
      const rawValue = typeof source[name] === 'string' ? source[name].trim() : '';
      if (rawValue) {
        return rawValue;
      }
      return `{{${name}}}`;
    });
  }

  function formatTaskTemplateSummary(task) {
    const preview = renderTaskTemplatePreview(
      task && (task.template || task.description || ''),
      {},
      task && Array.isArray(task.inputs) ? task.inputs : []
    ).trim();
    if (!preview) {
      return 'Task';
    }
    return preview.length > 140 ? `${preview.slice(0, 137).trimEnd()}...` : preview;
  }

  function buildToolOptions(tools, hostPanel) {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section universal-launcher-section-tools';

    const { heading, title: sectionTitle, note: sectionNote } = buildSectionHeading('Select plugin', 'Required');
    section.appendChild(heading);

    const picker = document.createElement('div');
    picker.className = 'universal-launcher-tool-picker';
    section.appendChild(picker);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'universal-launcher-tool-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    picker.appendChild(trigger);

    const triggerIcon = document.createElement('img');
    triggerIcon.className = 'universal-launcher-tool-trigger-icon';
    triggerIcon.alt = '';
    triggerIcon.hidden = true;
    trigger.appendChild(triggerIcon);

    const triggerContent = document.createElement('span');
    triggerContent.className = 'universal-launcher-tool-trigger-content';
    trigger.appendChild(triggerContent);

    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'universal-launcher-tool-trigger-label';
    triggerContent.appendChild(triggerLabel);

    const triggerMeta = document.createElement('span');
    triggerMeta.className = 'universal-launcher-tool-trigger-meta';
    triggerContent.appendChild(triggerMeta);

    const triggerCaret = document.createElement('i');
    triggerCaret.className = 'fa-solid fa-chevron-down universal-launcher-tool-trigger-caret';
    triggerCaret.setAttribute('aria-hidden', 'true');
    trigger.appendChild(triggerCaret);

    const layer = document.createElement('div');
    layer.className = 'universal-launcher-tool-sheet-layer';
    layer.hidden = true;
    (hostPanel || section).appendChild(layer);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'universal-launcher-tool-sheet-backdrop';
    backdrop.setAttribute('aria-label', 'Close plugin selection');
    layer.appendChild(backdrop);

    const sheet = document.createElement('section');
    sheet.className = 'universal-launcher-tool-sheet';
    sheet.setAttribute('aria-label', 'Select plugin');
    layer.appendChild(sheet);

    const sheetHeader = document.createElement('div');
    sheetHeader.className = 'universal-launcher-tool-sheet-header';
    sheet.appendChild(sheetHeader);

    const sheetHeading = document.createElement('div');
    sheetHeading.className = 'universal-launcher-tool-sheet-heading';
    sheetHeader.appendChild(sheetHeading);

    const sheetTitle = document.createElement('div');
    sheetTitle.className = 'universal-launcher-tool-sheet-title';
    sheetTitle.textContent = 'Select plugin';
    sheetHeading.appendChild(sheetTitle);

    const sheetDescription = document.createElement('div');
    sheetDescription.className = 'universal-launcher-tool-sheet-description';
    sheetDescription.textContent = 'Choose a tool.';
    sheetHeading.appendChild(sheetDescription);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'universal-launcher-tool-sheet-close';
    closeButton.setAttribute('aria-label', 'Close plugin selection');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    sheetHeader.appendChild(closeButton);

    const sheetBody = document.createElement('div');
    sheetBody.className = 'universal-launcher-tool-sheet-body';
    sheetBody.setAttribute('role', 'listbox');
    sheet.appendChild(sheetBody);

    const grouped = tools.reduce((map, tool, index) => {
      const category = tool.category || 'CLI';
      if (!map.has(category)) {
        map.set(category, []);
      }
      map.get(category).push({ tool, index });
      return map;
    }, new Map());

    const orderedGroups = [];
    CATEGORY_ORDER.forEach((category) => {
      if (grouped.has(category)) {
        orderedGroups.push([category, grouped.get(category)]);
        grouped.delete(category);
      }
    });
    grouped.forEach((entries, category) => {
      orderedGroups.push([category, entries]);
    });

    const toolEntries = [];
    let selectedValue = '';
    let menuOpen = false;
    let pickerDisabled = false;

    orderedGroups.forEach(([category, entries]) => {
      const group = document.createElement('div');
      group.className = 'universal-launcher-tool-group';

      const heading = document.createElement('div');
      heading.className = 'universal-launcher-tool-group-title';
      heading.textContent = getToolCategoryLabel(category);
      group.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'universal-launcher-tool-list';
      group.appendChild(list);

      entries.slice().sort((a, b) => {
        const nameA = String(a.tool && a.tool.label ? a.tool.label : '').toLowerCase();
        const nameB = String(b.tool && b.tool.label ? b.tool.label : '').toLowerCase();
        return nameA.localeCompare(nameB);
      }).forEach(({ tool, index }) => {
        const option = document.createElement('button');
        option.className = 'universal-launcher-tool';
        option.type = 'button';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.dataset.value = tool.value;

        const indicator = document.createElement('span');
        indicator.className = 'universal-launcher-tool-indicator';
        indicator.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'universal-launcher-tool-copy';

        const label = document.createElement('span');
        label.className = 'universal-launcher-tool-label';
        label.textContent = tool.label;
        text.appendChild(label);

        const meta = document.createElement('span');
        meta.className = 'universal-launcher-tool-meta';
        meta.textContent = getToolCategoryLabel(tool.category || 'CLI');
        text.appendChild(meta);

        option.appendChild(indicator);
        if (tool.iconSrc) {
          const icon = document.createElement('img');
          icon.className = 'universal-launcher-tool-icon';
          icon.src = tool.iconSrc;
          icon.alt = `${tool.label} icon`;
          icon.onerror = () => {
            icon.style.display = 'none';
          };
          option.appendChild(icon);
        }
        option.appendChild(text);
        list.appendChild(option);

        const entry = { button: option, meta: tool };
        toolEntries.push(entry);
        option.addEventListener('click', () => {
          api.setValue(tool.value);
          api.closeMenu();
          trigger.focus();
        });
      });

      sheetBody.appendChild(group);
    });

    function getEntryByValue(value) {
      return toolEntries.find((entry) => entry.meta && entry.meta.value === value) || null;
    }

    function syncTrigger() {
      const entry = getEntryByValue(selectedValue);
      const hasSelection = Boolean(entry && entry.meta);

      picker.classList.toggle('has-value', hasSelection);
      trigger.classList.toggle('has-value', hasSelection);
      trigger.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');

      if (hasSelection && entry.meta.iconSrc) {
        triggerIcon.hidden = false;
        triggerIcon.src = entry.meta.iconSrc;
      } else {
        triggerIcon.hidden = true;
        triggerIcon.removeAttribute('src');
      }

      if (hasSelection) {
        triggerLabel.textContent = entry.meta.label;
        triggerMeta.textContent = getToolCategoryLabel(entry.meta.category || 'CLI');
        triggerMeta.hidden = false;
      } else {
        triggerLabel.textContent = 'Choose a plugin';
        triggerMeta.textContent = '';
        triggerMeta.hidden = true;
      }

      toolEntries.forEach((entryItem) => {
        const active = Boolean(selectedValue && entryItem.meta && entryItem.meta.value === selectedValue);
        entryItem.button.classList.toggle('selected', active);
        entryItem.button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    const api = {
      section,
      sectionTitle,
      sectionNote,
      entries: toolEntries,
      onChange: null,
      getValue() {
        return selectedValue;
      },
      getSelectedEntry() {
        return getEntryByValue(selectedValue);
      },
      setValue(value, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const nextValue = typeof value === 'string' ? value.trim() : '';
        const entry = nextValue ? getEntryByValue(nextValue) : null;
        selectedValue = entry ? entry.meta.value : '';
        if (opts.persist !== false) {
          setStoredToolPreference(selectedValue);
        }
        syncTrigger();
        if (typeof this.onChange === 'function') {
          this.onChange(selectedValue);
        }
      },
      openMenu() {
        if (pickerDisabled) return;
        menuOpen = true;
        layer.hidden = false;
        picker.classList.add('open');
        syncTrigger();
        window.requestAnimationFrame(() => {
          const entry = getEntryByValue(selectedValue);
          const focusTarget = entry && entry.button
            ? entry.button
            : (toolEntries[0] && toolEntries[0].button);
          if (focusTarget && !focusTarget.disabled) {
            try {
              focusTarget.focus();
            } catch (_) {}
          }
        });
      },
      closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        layer.hidden = true;
        picker.classList.remove('open');
        syncTrigger();
      },
      toggleMenu() {
        if (menuOpen) {
          this.closeMenu();
          return;
        }
        this.openMenu();
      },
      isOpen() {
        return menuOpen;
      },
      setDisabled(disabled) {
        pickerDisabled = Boolean(disabled);
        trigger.disabled = pickerDisabled;
        closeButton.disabled = pickerDisabled;
        backdrop.disabled = pickerDisabled;
        toolEntries.forEach((entry) => {
          entry.button.disabled = pickerDisabled;
        });
        if (pickerDisabled) {
          this.closeMenu();
        }
      },
    };

    trigger.addEventListener('click', () => {
      api.toggleMenu();
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        api.openMenu();
      }
    });
    closeButton.addEventListener('click', () => {
      api.closeMenu();
      trigger.focus();
    });
    backdrop.addEventListener('click', () => {
      api.closeMenu();
      trigger.focus();
    });

    document.addEventListener('pointerdown', (event) => {
      if (!menuOpen) return;
      if (section.contains(event.target) || layer.contains(event.target)) return;
      api.closeMenu();
    }, true);

    syncTrigger();

    return { section, picker: api };
  }

  function buildAttachmentSection() {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section universal-launcher-upload';

    const { heading } = buildSectionHeading('Attach files', 'Optional');
    section.appendChild(heading);

    const dropzone = document.createElement('button');
    dropzone.type = 'button';
    dropzone.className = 'universal-launcher-dropzone';
    dropzone.textContent = 'Drag and drop files here, or click to select';

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.hidden = true;

    const list = document.createElement('ul');
    list.className = 'universal-launcher-upload-list';

    let files = [];

    function fileKey(file) {
      return `${file.name || ''}:${file.size || 0}:${file.lastModified || 0}`;
    }

    function updateList() {
      list.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('li');
        empty.className = 'universal-launcher-upload-empty';
        empty.textContent = 'No files selected';
        list.appendChild(empty);
        return;
      }

      files.forEach((file, index) => {
        const item = document.createElement('li');
        item.className = 'universal-launcher-upload-item';

        const meta = document.createElement('div');
        meta.className = 'universal-launcher-upload-meta';

        const name = document.createElement('span');
        name.className = 'universal-launcher-upload-name';
        name.textContent = file.name;
        meta.appendChild(name);

        const size = document.createElement('span');
        size.className = 'universal-launcher-upload-size';
        size.textContent = `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
        meta.appendChild(size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'universal-launcher-upload-remove';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          files = files.filter((_, i) => i !== index);
          updateList();
        });

        item.appendChild(meta);
        item.appendChild(remove);
        list.appendChild(item);
      });
    }

    function addFiles(nextFiles) {
      const existing = new Set(files.map((file) => fileKey(file)));
      Array.from(nextFiles || []).forEach((file) => {
        if (!file) return;
        const key = fileKey(file);
        if (existing.has(key)) return;
        existing.add(key);
        files.push(file);
      });
      updateList();
    }

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
      addFiles(event.dataTransfer ? event.dataTransfer.files : []);
    });
    input.addEventListener('change', (event) => {
      addFiles(event.target.files);
      input.value = '';
    });

    updateList();

    section.appendChild(dropzone);
    section.appendChild(list);
    section.appendChild(input);

    return {
      section,
      getFiles() {
        return files.slice();
      },
      clear() {
        files = [];
        updateList();
      },
    };
  }

  function buildTaskTemplateSection(hostPanel) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'universal-launcher-template-toggle';
    toggle.setAttribute('aria-label', 'Use template');
    toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.setAttribute('aria-expanded', 'false');

    const toggleIcon = document.createElement('i');
    toggleIcon.className = 'fa-solid fa-magnifying-glass universal-launcher-template-toggle-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggle.appendChild(toggleIcon);

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'universal-launcher-template-toggle-label';
    toggleLabel.textContent = 'Use template';
    toggle.appendChild(toggleLabel);

    const layer = document.createElement('div');
    layer.className = 'universal-launcher-template-layer';
    layer.id = 'universal-launcher-task-browser';
    layer.hidden = true;
    toggle.setAttribute('aria-controls', layer.id);
    hostPanel.appendChild(layer);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'universal-launcher-template-backdrop';
    backdrop.setAttribute('aria-label', 'Close tasks');
    layer.appendChild(backdrop);

    const modal = document.createElement('section');
    modal.className = 'universal-launcher-template-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Tasks');
    layer.appendChild(modal);

    const modalHeader = document.createElement('div');
    modalHeader.className = 'universal-launcher-template-modal-header';
    modal.appendChild(modalHeader);

    const modalHeading = document.createElement('div');
    modalHeading.className = 'universal-launcher-template-modal-heading';
    modalHeader.appendChild(modalHeading);

    const modalTitle = document.createElement('div');
    modalTitle.className = 'universal-launcher-template-modal-title';
    modalTitle.textContent = 'Tasks';
    modalHeading.appendChild(modalTitle);

    const modalDescription = document.createElement('div');
    modalDescription.className = 'universal-launcher-template-modal-description';
    modalDescription.textContent = 'Choose a task or create a new one.';
    modalHeading.appendChild(modalDescription);

    const headerActions = document.createElement('div');
    headerActions.className = 'universal-launcher-template-modal-header-actions';
    modalHeader.appendChild(headerActions);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'universal-launcher-template-create';
    createButton.textContent = 'Create';
    headerActions.appendChild(createButton);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'universal-launcher-template-modal-close';
    closeButton.setAttribute('aria-label', 'Close tasks');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    headerActions.appendChild(closeButton);

    const modalBody = document.createElement('div');
    modalBody.className = 'universal-launcher-template-modal-body';
    modal.appendChild(modalBody);

    const chooser = document.createElement('div');
    chooser.className = 'universal-launcher-template-chooser';
    modalBody.appendChild(chooser);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'universal-launcher-input universal-launcher-template-search';
    search.placeholder = 'Search tasks';
    chooser.appendChild(search);

    const list = document.createElement('div');
    list.className = 'universal-launcher-template-list';
    chooser.appendChild(list);

    const chooserEmpty = document.createElement('div');
    chooserEmpty.className = 'universal-launcher-template-chooser-empty';
    chooser.appendChild(chooserEmpty);

    const chooserEmptyText = document.createElement('div');
    chooserEmptyText.className = 'universal-launcher-template-empty';
    chooserEmpty.appendChild(chooserEmptyText);

    const chooserEmptyAction = document.createElement('button');
    chooserEmptyAction.type = 'button';
    chooserEmptyAction.className = 'universal-launcher-template-create universal-launcher-template-create-inline';
    chooserEmptyAction.textContent = 'Create';
    chooserEmpty.appendChild(chooserEmptyAction);

    const details = document.createElement('div');
    details.className = 'universal-launcher-template-details';
    modalBody.appendChild(details);

    const detailsTopActions = document.createElement('div');
    detailsTopActions.className = 'universal-launcher-template-details-top-actions';
    details.appendChild(detailsTopActions);

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'universal-launcher-template-back-button';
    backButton.textContent = 'Back to tasks';
    detailsTopActions.appendChild(backButton);

    const detailsTitle = document.createElement('div');
    detailsTitle.className = 'universal-launcher-template-details-title';
    detailsTitle.hidden = true;
    details.appendChild(detailsTitle);

    const detailsDescription = document.createElement('div');
    detailsDescription.className = 'universal-launcher-template-details-description';
    details.appendChild(detailsDescription);

    const inputList = document.createElement('div');
    inputList.className = 'universal-launcher-template-input-list';
    details.appendChild(inputList);

    const previewWrap = document.createElement('div');
    previewWrap.className = 'universal-launcher-template-preview';
    details.appendChild(previewWrap);

    const previewLabel = document.createElement('div');
    previewLabel.className = 'universal-launcher-template-preview-label';
    previewLabel.textContent = 'Prompt preview';
    previewWrap.appendChild(previewLabel);

    const preview = document.createElement('pre');
    preview.className = 'universal-launcher-template-preview-code';
    previewWrap.appendChild(preview);

    const emptyState = document.createElement('div');
    emptyState.className = 'universal-launcher-template-empty';
    details.appendChild(emptyState);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'universal-launcher-template-modal-footer';
    modal.appendChild(modalFooter);

    const footerNote = document.createElement('div');
    footerNote.className = 'universal-launcher-template-helper';
    modalFooter.appendChild(footerNote);

    const footerActions = document.createElement('div');
    footerActions.className = 'universal-launcher-template-modal-actions';
    modalFooter.appendChild(footerActions);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'universal-launcher-button universal-launcher-button-secondary';
    cancelButton.textContent = 'Cancel';
    footerActions.appendChild(cancelButton);

    const useButton = document.createElement('button');
    useButton.type = 'button';
    useButton.className = 'universal-launcher-button universal-launcher-button-primary';
    useButton.textContent = 'Use task';
    footerActions.appendChild(useButton);

    const state = {
      allTasks: [],
      currentTarget: 'workspaces',
      query: '',
      selectedTaskId: '',
      inputDrafts: {},
      open: false,
      onCommit: null,
      getCreateDefaults: null,
    };

    function getSelectedTask() {
      if (!state.selectedTaskId) {
        return null;
      }
      return state.allTasks.find((task) => task && task.id === state.selectedTaskId) || null;
    }

    function getVisibleTasks() {
      const query = state.query.toLowerCase();
      return state.allTasks.filter((task) => {
        if (!taskMatchesSelectionTarget(task, state.currentTarget)) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [
          task.id || '',
          task.title || '',
          task.description || '',
          task.ref || '',
          ...(Array.isArray(task.inputs) ? task.inputs.map((input) => input && input.label ? input.label : '') : [])
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    function getRenderedPrompt(task) {
      if (!task) {
        return '';
      }
      const draftValues = state.inputDrafts[task.id] || {};
      return renderTaskTemplatePreview(
        task.template || task.description || '',
        draftValues,
        Array.isArray(task.inputs) ? task.inputs : []
      );
    }

    function isSelectedTaskComplete(task) {
      if (!task || !Array.isArray(task.inputs)) {
        return false;
      }
      const draftValues = state.inputDrafts[task.id] || {};
      return task.inputs.every((input) => {
        if (input && input.required === false) {
          return true;
        }
        const value = typeof draftValues[input.name] === 'string' ? draftValues[input.name].trim() : '';
        return Boolean(value);
      });
    }

    function close() {
      state.open = false;
      layer.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    function open() {
      state.open = true;
      layer.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      render();
      requestAnimationFrame(() => {
        search.focus();
      });
    }

    function openCreateTaskBuilder() {
      const defaults = typeof state.getCreateDefaults === 'function'
        ? state.getCreateDefaults()
        : null;
      openTaskTemplateBuilder(defaults);
    }

    function render() {
      const visibleTasks = getVisibleTasks();
      const selectedTask = getSelectedTask();
      const hasAvailableTasks = state.allTasks.some((task) => taskMatchesSelectionTarget(task, state.currentTarget));
      const showingDetails = Boolean(selectedTask);
      const hasVisibleTasks = visibleTasks.length > 0;
      toggle.disabled = false;
      toggle.hidden = false;
      toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      modalTitle.textContent = showingDetails && selectedTask ? (selectedTask.title || selectedTask.id) : 'Tasks';
      modalDescription.textContent = showingDetails
        ? 'Fill the fields below, then use this template.'
        : 'Choose a task or create a new one.';

      list.innerHTML = '';
      visibleTasks.forEach((task) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `universal-launcher-template-row${state.selectedTaskId === task.id ? ' selected' : ''}`;
        row.dataset.taskId = task.id;

        const copy = document.createElement('div');
        copy.className = 'universal-launcher-template-copy';

        const label = document.createElement('div');
        label.className = 'universal-launcher-template-label';
        label.textContent = task.title || task.id;
        copy.appendChild(label);

        const meta = document.createElement('div');
        meta.className = 'universal-launcher-template-meta';
        const metaBits = [];
        metaBits.push(formatTaskTemplateSummary(task));
        if (Array.isArray(task.inputs) && task.inputs.length > 0) {
          metaBits.push(`${task.inputs.length} input${task.inputs.length === 1 ? '' : 's'}`);
        }
        meta.textContent = metaBits.join(' · ') || 'Task';
        copy.appendChild(meta);

        row.appendChild(copy);
        row.addEventListener('click', () => {
          state.selectedTaskId = task.id;
          render();
          requestAnimationFrame(() => {
            const firstInput = inputList.querySelector('input');
            if (firstInput) {
              firstInput.focus();
            } else {
              useButton.focus();
            }
          });
        });
        list.appendChild(row);
      });

      list.hidden = !hasVisibleTasks;
      chooserEmpty.hidden = hasVisibleTasks;
      if (!hasAvailableTasks) {
        chooserEmptyText.textContent = 'No tasks yet. Create one to reuse it here.';
        chooserEmptyAction.hidden = false;
      } else if (!hasVisibleTasks) {
        chooserEmptyText.textContent = 'No tasks match this search.';
        chooserEmptyAction.hidden = true;
      } else {
        chooserEmptyText.textContent = '';
        chooserEmptyAction.hidden = true;
      }

      chooser.hidden = showingDetails;
      details.hidden = !showingDetails;

      inputList.innerHTML = '';
      if (!selectedTask) {
        detailsTitle.textContent = '';
        detailsTitle.hidden = true;
        detailsDescription.textContent = '';
        preview.textContent = '';
        emptyState.hidden = false;
        useButton.disabled = true;
        footerNote.textContent = hasAvailableTasks
          ? ''
          : `No tasks for ${state.currentTarget} yet.`;
        footerNote.hidden = !footerNote.textContent;
        return;
      }

      emptyState.hidden = true;
      detailsTitle.textContent = '';
      detailsTitle.hidden = true;
      detailsDescription.textContent = Array.isArray(selectedTask.inputs) && selectedTask.inputs.length > 0
        ? `Fill ${selectedTask.inputs.length === 1 ? 'the field' : 'the fields'} below to build the prompt.`
        : 'This task is ready to use.';

      if (!state.inputDrafts[selectedTask.id]) {
        state.inputDrafts[selectedTask.id] = {};
      }

      (Array.isArray(selectedTask.inputs) ? selectedTask.inputs : []).forEach((input) => {
        const field = document.createElement('label');
        field.className = 'universal-launcher-template-input-field';

        const label = document.createElement('span');
        label.className = 'universal-launcher-template-input-label';
        label.textContent = input.label || input.name;
        field.appendChild(label);

        const control = document.createElement('input');
        control.type = 'text';
        control.className = 'universal-launcher-input';
        control.placeholder = getTaskInputDisplayLabel(input.name, selectedTask.inputs);
        control.value = state.inputDrafts[selectedTask.id][input.name] || '';
        control.addEventListener('input', () => {
          state.inputDrafts[selectedTask.id][input.name] = control.value;
          preview.textContent = getRenderedPrompt(selectedTask);
          useButton.disabled = !isSelectedTaskComplete(selectedTask);
        });
        field.appendChild(control);

        inputList.appendChild(field);
      });

      preview.textContent = getRenderedPrompt(selectedTask);
      useButton.disabled = !isSelectedTaskComplete(selectedTask);
      footerNote.textContent = '';
      footerNote.hidden = true;
    }

    search.addEventListener('input', () => {
      state.query = search.value.trim();
      render();
    });

    toggle.addEventListener('click', () => {
      open();
    });
    createButton.addEventListener('click', () => {
      openCreateTaskBuilder();
    });
    chooserEmptyAction.addEventListener('click', () => {
      openCreateTaskBuilder();
    });
    backdrop.addEventListener('click', () => close());
    closeButton.addEventListener('click', () => close());
    cancelButton.addEventListener('click', () => close());
    backButton.addEventListener('click', () => {
      state.selectedTaskId = '';
      render();
      search.focus();
    });
    useButton.addEventListener('click', () => {
      const selectedTask = getSelectedTask();
      if (!selectedTask || !isSelectedTaskComplete(selectedTask)) {
        return;
      }
      const renderedPrompt = getRenderedPrompt(selectedTask).trim();
      if (!renderedPrompt) {
        return;
      }
      if (typeof state.onCommit === 'function') {
        state.onCommit({
          task: selectedTask,
          prompt: renderedPrompt,
        });
      }
      close();
    });

    render();

    return {
      toggle,
      search,
      isOpen() {
        return state.open;
      },
      open,
      close,
      clearSelection() {
        state.selectedTaskId = '';
        render();
      },
      reset() {
        state.query = '';
        search.value = '';
        state.selectedTaskId = '';
        state.inputDrafts = {};
        close();
        render();
      },
      setTasks(tasks) {
        state.allTasks = Array.isArray(tasks) ? tasks.slice() : [];
        const selectedTask = getSelectedTask();
        if (!taskMatchesSelectionTarget(selectedTask, state.currentTarget)) {
          state.selectedTaskId = '';
        }
        render();
      },
      setTarget(taskTarget) {
        state.currentTarget = taskTarget || 'workspaces';
        const selectedTask = getSelectedTask();
        if (!taskMatchesSelectionTarget(selectedTask, state.currentTarget)) {
          state.selectedTaskId = '';
        }
        state.query = '';
        search.value = '';
        close();
        render();
      },
      set onCommit(handler) {
        state.onCommit = typeof handler === 'function' ? handler : null;
      },
      setCreateDefaultsResolver(handler) {
        state.getCreateDefaults = typeof handler === 'function' ? handler : null;
      }
    };
  }

  function buildAskTaskSection() {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section universal-launcher-ask-task';
    section.hidden = true;

    const suggestionsWrap = document.createElement('div');
    suggestionsWrap.className = 'universal-launcher-ask-task-suggestions';
    section.appendChild(suggestionsWrap);

    const suggestionsList = document.createElement('div');
    suggestionsList.className = 'universal-launcher-template-list';
    suggestionsWrap.appendChild(suggestionsList);

    const selectedWrap = document.createElement('div');
    selectedWrap.className = 'universal-launcher-ask-task-selected';
    selectedWrap.hidden = true;
    section.appendChild(selectedWrap);

    const selectedTop = document.createElement('div');
    selectedTop.className = 'universal-launcher-ask-task-top';
    selectedWrap.appendChild(selectedTop);

    const selectedChip = document.createElement('div');
    selectedChip.className = 'universal-launcher-ask-task-chip';
    selectedTop.appendChild(selectedChip);

    const selectedChipLabel = document.createElement('div');
    selectedChipLabel.className = 'universal-launcher-ask-task-chip-label';
    selectedChip.appendChild(selectedChipLabel);

    const selectedChipMeta = document.createElement('div');
    selectedChipMeta.className = 'universal-launcher-ask-task-chip-meta';
    selectedChip.appendChild(selectedChipMeta);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'universal-launcher-ask-task-clear';
    clearButton.setAttribute('aria-label', 'Change task');
    clearButton.innerHTML = '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Change task</span>';
    selectedTop.appendChild(clearButton);

    const taskDescription = document.createElement('div');
    taskDescription.className = 'universal-launcher-template-details-description';
    selectedWrap.appendChild(taskDescription);

    const inputList = document.createElement('div');
    inputList.className = 'universal-launcher-template-input-list';
    selectedWrap.appendChild(inputList);

    const workspaceWrap = document.createElement('div');
    workspaceWrap.className = 'universal-launcher-ask-task-workspaces';
    selectedWrap.appendChild(workspaceWrap);

    const workspaceStatus = document.createElement('div');
    workspaceStatus.className = 'universal-launcher-template-helper';
    workspaceWrap.appendChild(workspaceStatus);

    const workspaceList = document.createElement('div');
    workspaceList.className = 'universal-launcher-template-list universal-launcher-ask-task-workspace-list';
    workspaceWrap.appendChild(workspaceList);

    const freshWorkspaceWrap = document.createElement('div');
    freshWorkspaceWrap.className = 'universal-launcher-ask-task-fresh';
    workspaceWrap.appendChild(freshWorkspaceWrap);

    const previewWrap = document.createElement('details');
    previewWrap.className = 'universal-launcher-template-preview';
    selectedWrap.appendChild(previewWrap);

    const previewLabel = document.createElement('summary');
    previewLabel.className = 'universal-launcher-template-preview-label universal-launcher-ask-task-preview-toggle';
    previewLabel.textContent = 'Prompt';
    previewWrap.appendChild(previewLabel);

    const preview = document.createElement('pre');
    preview.className = 'universal-launcher-template-preview-code';
    previewWrap.appendChild(preview);

    const state = {
      enabled: false,
      tasks: [],
      currentTarget: 'workspaces',
      query: '',
      selectedTaskId: '',
      inputDrafts: {},
      workspacesByTaskId: {},
      workspaceModeByTaskId: {},
      selectedWorkspaceRefByTaskId: {},
      newWorkspaceNameDraftsByTaskId: {},
      customWorkspaceNameByTaskId: {},
      loadTokenByTaskId: {},
      onChange: null,
      onAction: null,
    };

    function getSelectedTask() {
      if (!state.selectedTaskId) {
        return null;
      }
      return state.tasks.find((task) => task && task.id === state.selectedTaskId) || null;
    }

    function usesWorkspaceFlow() {
      return state.currentTarget === 'workspaces';
    }

    function getTaskWorkspaceState(taskId) {
      if (!taskId) {
        return {
          loading: false,
          error: '',
          items: [],
          lastUsedRef: '',
        };
      }
      return state.workspacesByTaskId[taskId] || {
        loading: false,
        error: '',
        items: [],
        lastUsedRef: '',
      };
    }

    function getWorkspaceMode(taskId) {
      return state.workspaceModeByTaskId[taskId] === 'reuse' ? 'reuse' : 'new';
    }

    function getSelectedWorkspaceRef(taskId) {
      return typeof state.selectedWorkspaceRefByTaskId[taskId] === 'string'
        ? state.selectedWorkspaceRefByTaskId[taskId]
        : '';
    }

    function getTaskLastUsedTimestamp(task) {
      const timestamp = Date.parse(task && task.last_used_at ? task.last_used_at : '');
      return Number.isFinite(timestamp) ? timestamp : null;
    }

    function compareTasksByBrowseOrder(a, b) {
      const aLastUsed = getTaskLastUsedTimestamp(a);
      const bLastUsed = getTaskLastUsedTimestamp(b);
      if (aLastUsed !== null && bLastUsed !== null && aLastUsed !== bLastUsed) {
        return bLastUsed - aLastUsed;
      }
      if ((aLastUsed !== null) !== (bLastUsed !== null)) {
        return aLastUsed !== null ? -1 : 1;
      }
      const aTitle = String(a && (a.title || a.id) ? (a.title || a.id) : '').toLowerCase();
      const bTitle = String(b && (b.title || b.id) ? (b.title || b.id) : '').toLowerCase();
      if (aTitle < bTitle) return -1;
      if (aTitle > bTitle) return 1;
      return String(a && a.id ? a.id : '').localeCompare(String(b && b.id ? b.id : ''));
    }

    function getTaskSource() {
      return state.tasks
        .filter((task) => taskMatchesSelectionTarget(task, state.currentTarget))
        .slice()
        .sort(compareTasksByBrowseOrder);
    }

    function getTaskQueryResults() {
      const query = state.query.toLowerCase();
      const source = getTaskSource();
      if (!query) {
        return source;
      }
      return source
        .map((task) => {
          const title = String(task.title || '').toLowerCase();
          const description = String(task.description || '').toLowerCase();
          const template = String(task.template || '').toLowerCase();
          const inputs = Array.isArray(task.inputs)
            ? task.inputs.map((input) => `${input && input.name ? input.name : ''} ${input && input.label ? input.label : ''}`.trim().toLowerCase()).join(' ')
            : '';
          const titleMatch = title.includes(query);
          const descriptionMatch = description.includes(query);
          const templateMatch = template.includes(query);
          const inputMatch = inputs.includes(query);
          if (!titleMatch && !descriptionMatch && !templateMatch && !inputMatch) {
            return null;
          }
          let score = 0;
          if (titleMatch) score += title.startsWith(query) ? 5 : 4;
          if (descriptionMatch) score += 2;
          if (templateMatch) score += 1;
          if (inputMatch) score += 1;
          return { task, score };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.score !== b.score) {
            return b.score - a.score;
          }
          return compareTasksByBrowseOrder(a.task, b.task);
        })
        .map((entry) => entry.task);
    }

    function appendSuggestionSectionTitle(container, label) {
      if (!container || !label) {
        return;
      }
      const title = document.createElement('div');
      title.className = 'universal-launcher-template-list-section-title';
      title.textContent = label;
      container.appendChild(title);
    }

    function appendSuggestionRow(container, task, options = {}) {
      if (!container || !task || !task.id) {
        return;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'universal-launcher-template-row universal-launcher-suggestion-row';

      const icon = document.createElement('span');
      icon.className = 'universal-launcher-suggestion-icon';
      icon.innerHTML = '<i class="fa-solid fa-bookmark" aria-hidden="true"></i>';
      row.appendChild(icon);

      const copy = document.createElement('div');
      copy.className = 'universal-launcher-template-copy universal-launcher-suggestion-copy';

      const label = document.createElement('div');
      label.className = 'universal-launcher-template-label';
      label.textContent = task.title || task.id;
      copy.appendChild(label);

      const meta = document.createElement('div');
      meta.className = 'universal-launcher-template-meta';
      const metaBits = [];
      if (task.description) {
        metaBits.push(task.description);
      } else {
        metaBits.push(formatTaskTemplateSummary(task));
      }
      if (Array.isArray(task.inputs) && task.inputs.length > 0) {
        metaBits.push(`${task.inputs.length} input${task.inputs.length === 1 ? '' : 's'}`);
      }
      if (options.usageLabel) {
        metaBits.push(options.usageLabel);
      }
      meta.textContent = metaBits.join(' · ');
      copy.appendChild(meta);

      row.appendChild(copy);
      const hint = document.createElement('span');
      hint.className = 'universal-launcher-suggestion-hint';
      hint.textContent = 'Use task';
      row.appendChild(hint);
      row.addEventListener('click', () => {
        selectTask(task);
      });
      container.appendChild(row);
    }

    function getRenderedPrompt(task) {
      if (!task) {
        return '';
      }
      const draftValues = state.inputDrafts[task.id] || {};
      return renderTaskTemplatePreview(
        task.template || task.description || '',
        draftValues,
        Array.isArray(task.inputs) ? task.inputs : []
      ).trim();
    }

    function isTaskComplete(task) {
      if (!task || !Array.isArray(task.inputs)) {
        return true;
      }
      const draftValues = state.inputDrafts[task.id] || {};
      return task.inputs.every((input) => {
        if (input && input.required === false) {
          return true;
        }
        const value = typeof draftValues[input.name] === 'string' ? draftValues[input.name].trim() : '';
        return Boolean(value);
      });
    }

    function notifyChange() {
      if (typeof state.onChange === 'function') {
        state.onChange();
      }
    }

    function selectNewWorkspace(taskId) {
      state.workspaceModeByTaskId[taskId] = 'new';
      state.selectedWorkspaceRefByTaskId[taskId] = '';
    }

    function selectExistingWorkspace(taskId, ref) {
      state.workspaceModeByTaskId[taskId] = 'reuse';
      state.selectedWorkspaceRefByTaskId[taskId] = ref;
    }

    function isCustomizingNewWorkspace(taskId) {
      return state.customWorkspaceNameByTaskId[taskId] === true;
    }

    function getSuggestedNewWorkspaceName(task, workspaceState) {
      return getSuggestedTaskWorkspaceName(
        task,
        workspaceState && Array.isArray(workspaceState.items) ? workspaceState.items : []
      );
    }

    function getPlannedNewWorkspaceName(task, workspaceState) {
      if (!task || !task.id) {
        return '';
      }
      const draft = typeof state.newWorkspaceNameDraftsByTaskId[task.id] === 'string'
        ? state.newWorkspaceNameDraftsByTaskId[task.id].trim()
        : '';
      if (isCustomizingNewWorkspace(task.id)) {
        return draft;
      }
      return isValidWorkspaceName(draft) ? draft : getSuggestedNewWorkspaceName(task, workspaceState);
    }

    function setNewWorkspaceNameDraft(taskId, value) {
      if (!taskId) {
        return;
      }
      state.newWorkspaceNameDraftsByTaskId[taskId] = typeof value === 'string' ? value : '';
    }

    function setCustomizingNewWorkspace(taskId, nextValue) {
      if (!taskId) {
        return;
      }
      state.customWorkspaceNameByTaskId[taskId] = nextValue === true;
    }

    async function loadTaskWorkspaces(taskId) {
      if (!usesWorkspaceFlow()) {
        state.workspacesByTaskId[taskId] = {
          loading: false,
          error: '',
          items: [],
          lastUsedRef: '',
        };
        render();
        notifyChange();
        return;
      }
      if (!taskId) {
        return;
      }
      const token = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      state.loadTokenByTaskId[taskId] = token;
      state.workspacesByTaskId[taskId] = {
        loading: true,
        error: '',
        items: [],
        lastUsedRef: '',
      };
      render();
      notifyChange();
      try {
        const payload = await getTaskWorkspaces(taskId);
        if (state.loadTokenByTaskId[taskId] !== token) {
          return;
        }
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        const lastUsedRef = payload && typeof payload.last_used_ref === 'string' ? payload.last_used_ref : '';
        state.workspacesByTaskId[taskId] = {
          loading: false,
          error: '',
          items,
          lastUsedRef,
        };
        if (items.length > 0) {
          const hasExplicitMode = Object.prototype.hasOwnProperty.call(state.workspaceModeByTaskId, taskId);
          const currentMode = hasExplicitMode ? state.workspaceModeByTaskId[taskId] : '';
          const currentRef = hasExplicitMode ? getSelectedWorkspaceRef(taskId) : '';
          if (currentMode === 'new') {
            selectNewWorkspace(taskId);
          } else {
            const preferredRef = currentMode === 'reuse' && currentRef && items.some((item) => item && item.ref === currentRef)
              ? currentRef
              : (items.some((item) => item && item.ref === lastUsedRef)
                ? lastUsedRef
                : (items[0] && items[0].ref ? items[0].ref : ''));
            selectExistingWorkspace(taskId, preferredRef);
          }
        } else {
          selectNewWorkspace(taskId);
        }
      } catch (error) {
        if (state.loadTokenByTaskId[taskId] !== token) {
          return;
        }
        state.workspacesByTaskId[taskId] = {
          loading: false,
          error: error && error.message ? error.message : 'Failed to load workspaces.',
          items: [],
          lastUsedRef: '',
        };
        selectNewWorkspace(taskId);
      }
      render();
      notifyChange();
      restoreTaskFocus(taskId);
    }

    function clearSelection() {
      state.selectedTaskId = '';
      previewWrap.open = false;
      render();
      notifyChange();
    }

    function focusFirstTaskInput() {
      const firstInput = inputList.querySelector('input:not([disabled])');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus();
        try {
          firstInput.setSelectionRange(0, firstInput.value.length);
        } catch (_) {}
        return true;
      }
      return false;
    }

    function restoreTaskInputFocus(taskId, inputName, selectionStart, selectionEnd) {
      if (!taskId || state.selectedTaskId !== taskId || !inputName) {
        return;
      }
      requestAnimationFrame(() => {
        if (!taskId || state.selectedTaskId !== taskId) {
          return;
        }
        const selector = `.universal-launcher-template-input-field .universal-launcher-input[data-task-input-name="${CSS.escape(inputName)}"]`;
        const replacement = inputList.querySelector(selector);
        if (!replacement || typeof replacement.focus !== 'function') {
          return;
        }
        replacement.focus();
        try {
          const nextStart = Number.isFinite(selectionStart) ? selectionStart : replacement.value.length;
          const nextEnd = Number.isFinite(selectionEnd) ? selectionEnd : nextStart;
          replacement.setSelectionRange(nextStart, nextEnd);
        } catch (_) {}
      });
    }

    function restoreTaskFocus(taskId) {
      if (!taskId || state.selectedTaskId !== taskId) {
        return;
      }
      requestAnimationFrame(() => {
        if (!taskId || state.selectedTaskId !== taskId) {
          return;
        }
        const active = document.activeElement;
        if (active && selectedWrap.contains(active)) {
          return;
        }
        if (focusFirstTaskInput()) {
          return;
        }
        const firstWorkspaceButton = workspaceList.querySelector('.universal-launcher-template-row-action-button:not([disabled])');
        if (firstWorkspaceButton && typeof firstWorkspaceButton.focus === 'function') {
          firstWorkspaceButton.focus();
        }
      });
    }

    function selectTask(task) {
      if (!task || !task.id) {
        return;
      }
      state.selectedTaskId = task.id;
      previewWrap.open = false;
      if (!state.inputDrafts[task.id]) {
        state.inputDrafts[task.id] = {};
      }
      render();
      notifyChange();
      requestAnimationFrame(() => {
        focusFirstTaskInput();
      });
      if (usesWorkspaceFlow()) {
        loadTaskWorkspaces(task.id);
      }
    }

    function renderSuggestions() {
      const results = getTaskQueryResults();
      suggestionsList.innerHTML = '';
      const showSuggestions = state.enabled && !state.selectedTaskId && results.length > 0;
      suggestionsWrap.hidden = !showSuggestions;
      if (!showSuggestions) {
        return;
      }
      const hasQuery = Boolean(state.query.trim());
      if (hasQuery) {
        results.forEach((task) => {
          appendSuggestionRow(suggestionsList, task);
        });
        return;
      }
      const recentTasks = results
        .filter((task) => getTaskLastUsedTimestamp(task) !== null)
        .slice(0, RECENT_TASK_LIMIT);
      const recentTaskIds = new Set(recentTasks.map((task) => task.id));
      const allTasks = results.filter((task) => !recentTaskIds.has(task.id));

      if (recentTasks.length > 0) {
        appendSuggestionSectionTitle(suggestionsList, 'Recent');
        recentTasks.forEach((task) => {
          appendSuggestionRow(suggestionsList, task, {
            usageLabel: formatRecentLauncherUsage(task.last_used_at),
          });
        });
      }

      if (allTasks.length > 0) {
        if (recentTasks.length > 0) {
          appendSuggestionSectionTitle(suggestionsList, 'All tasks');
        }
        allTasks.forEach((task) => {
          appendSuggestionRow(suggestionsList, task);
        });
      }
    }

    function renderSelectedTask() {
      const task = getSelectedTask();
      selectedWrap.hidden = !state.enabled || !task;
      if (!task) {
        return;
      }

      const taskTitle = typeof task.title === 'string' && task.title.trim()
        ? task.title.trim()
        : (typeof task.id === 'string' ? task.id.trim() : '');
      if (!taskTitle) {
        selectedWrap.hidden = true;
        return;
      }

      const workspaceState = getTaskWorkspaceState(task.id);
      const canLaunchTask = isTaskComplete(task);
      const plannedNewWorkspaceName = getPlannedNewWorkspaceName(task, workspaceState);
      const isNewWorkspaceNameValid = isValidWorkspaceName(plannedNewWorkspaceName);
      const isRenamingNewWorkspace = isCustomizingNewWorkspace(task.id);

      selectedChipLabel.textContent = '';
      selectedChipLabel.hidden = true;
      selectedChipMeta.textContent = taskTitle;

      const description = typeof task.description === 'string' ? task.description.trim() : '';
      const hasTemplateSyntax = /{{\s*[^}]+\s*}}/.test(description);
      const shouldShowDescription = Boolean(
        description
        && !hasTemplateSyntax
        && description.toLowerCase() !== taskTitle.toLowerCase()
      );
      taskDescription.textContent = shouldShowDescription ? description : '';
      taskDescription.hidden = !shouldShowDescription;

      inputList.innerHTML = '';
      (Array.isArray(task.inputs) ? task.inputs : []).forEach((input) => {
        const field = document.createElement('label');
        field.className = 'universal-launcher-template-input-field';

        const label = document.createElement('span');
        label.className = 'universal-launcher-template-input-label';
        label.textContent = input.label || input.name;
        field.appendChild(label);

        const control = document.createElement('input');
        control.type = 'text';
        control.className = 'universal-launcher-input';
        control.dataset.taskInputName = input.name;
        control.placeholder = getTaskInputDisplayLabel(input.name, task.inputs);
        control.value = state.inputDrafts[task.id][input.name] || '';
        control.addEventListener('input', () => {
          const selectionStart = typeof control.selectionStart === 'number' ? control.selectionStart : control.value.length;
          const selectionEnd = typeof control.selectionEnd === 'number' ? control.selectionEnd : selectionStart;
          state.inputDrafts[task.id][input.name] = control.value;
          preview.textContent = getRenderedPrompt(task);
          renderSelectedTask();
          notifyChange();
          restoreTaskInputFocus(task.id, input.name, selectionStart, selectionEnd);
        });
        field.appendChild(control);

        inputList.appendChild(field);
      });

      preview.textContent = getRenderedPrompt(task);
      if (!usesWorkspaceFlow()) {
        workspaceWrap.hidden = true;
        workspaceList.innerHTML = '';
        freshWorkspaceWrap.innerHTML = '';
        workspaceStatus.hidden = true;
        workspaceStatus.textContent = '';
        return;
      }

      workspaceWrap.hidden = false;
      workspaceList.innerHTML = '';
      freshWorkspaceWrap.innerHTML = '';
      if (workspaceState.loading) {
        workspaceStatus.hidden = false;
        workspaceStatus.textContent = 'Loading workspaces...';
      } else if (workspaceState.error) {
        workspaceStatus.hidden = false;
        workspaceStatus.textContent = workspaceState.error;
      } else {
        workspaceStatus.hidden = true;
        workspaceStatus.textContent = '';
      }

      if (workspaceState.items.length > 0) {
        workspaceState.items.forEach((item) => {
          if (!item || !item.ref) {
            return;
          }
          const card = document.createElement('div');
          card.className = 'universal-launcher-template-action-card';

          const row = document.createElement('div');
          row.className = 'universal-launcher-template-row universal-launcher-template-action-row';
          if (!canLaunchTask) {
            card.classList.add('is-disabled');
          }

          const copy = document.createElement('div');
          copy.className = 'universal-launcher-template-copy';

          const label = document.createElement('div');
          label.className = 'universal-launcher-template-label';
          label.textContent = item.name || item.relative || item.ref;
          copy.appendChild(label);

          const meta = document.createElement('div');
          meta.className = 'universal-launcher-template-meta';
          const metaBits = ['Existing workspace'];
          if (item.ref === workspaceState.lastUsedRef) {
            metaBits.push('Last used');
          }
          const lastUsedAt = formatLauncherTimestamp(item.last_used_at);
          if (lastUsedAt) {
            metaBits.push(lastUsedAt);
          }
          meta.textContent = metaBits.join(' · ');
          copy.appendChild(meta);

          row.appendChild(copy);
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'universal-launcher-template-row-action-button';
          action.textContent = 'Continue';
          action.disabled = !canLaunchTask;
          action.addEventListener('click', () => {
            if (!canLaunchTask) {
              return;
            }
            selectExistingWorkspace(task.id, item.ref);
            if (typeof state.onAction === 'function') {
              state.onAction({
                taskId: task.id,
                inputs: { ...(state.inputDrafts[task.id] || {}) },
                workspaceMode: 'reuse',
                workspaceRef: item.ref,
                workspaceName: '',
              });
            }
          });
          row.appendChild(action);
          card.appendChild(row);
          workspaceList.appendChild(card);
        });
      }

      const hasExistingWorkspaces = workspaceState.items.length > 0;
      const suggestedNewWorkspaceName = getSuggestedNewWorkspaceName(task, workspaceState);
      const nameToDisplay = plannedNewWorkspaceName || suggestedNewWorkspaceName;
      const newCard = document.createElement('div');
      newCard.className = `universal-launcher-template-action-card universal-launcher-template-action-card-new${hasExistingWorkspaces ? ' is-secondary' : ''}`;

      const newRow = document.createElement('div');
      newRow.className = 'universal-launcher-template-row universal-launcher-template-action-row';
      if (!canLaunchTask || !isNewWorkspaceNameValid) {
        newCard.classList.add('is-disabled');
      }

      const newCopy = document.createElement('div');
      newCopy.className = 'universal-launcher-template-copy';

      const newLabel = document.createElement('div');
      newLabel.className = 'universal-launcher-template-label';
      newLabel.textContent = hasExistingWorkspaces ? 'Start fresh workspace' : 'Start New Workspace';
      newCopy.appendChild(newLabel);

      const newMeta = document.createElement('div');
      newMeta.className = 'universal-launcher-template-meta';
      newMeta.textContent = hasExistingWorkspaces
        ? 'Use a clean workspace instead of reusing an existing one.'
        : 'Creates a fresh workspace using this task.';
      newCopy.appendChild(newMeta);

      newRow.appendChild(newCopy);
      const newAction = document.createElement('button');
      newAction.type = 'button';
      newAction.className = `universal-launcher-template-row-action-button${hasExistingWorkspaces ? ' universal-launcher-template-row-action-button-secondary' : ''}`;
      newAction.textContent = hasExistingWorkspaces ? 'Start fresh' : 'Start';
      newAction.disabled = !canLaunchTask || !isNewWorkspaceNameValid;
      newAction.addEventListener('click', () => {
        if (!canLaunchTask || !isNewWorkspaceNameValid) {
          return;
        }
        selectNewWorkspace(task.id);
        if (typeof state.onAction === 'function') {
          state.onAction({
            taskId: task.id,
            inputs: { ...(state.inputDrafts[task.id] || {}) },
            workspaceMode: 'new',
            workspaceRef: '',
            workspaceName: nameToDisplay,
          });
        }
      });
      newRow.appendChild(newAction);
      newCard.appendChild(newRow);

      const namingWrap = document.createElement('div');
      namingWrap.className = 'universal-launcher-template-inline-tools';

      if (isRenamingNewWorkspace) {
        const draftField = document.createElement('label');
        draftField.className = 'universal-launcher-template-inline-field';

        const draftLabel = document.createElement('span');
        draftLabel.className = 'universal-launcher-template-inline-label';
        draftLabel.textContent = 'Workspace name';
        draftField.appendChild(draftLabel);

        const draftInput = document.createElement('input');
        draftInput.type = 'text';
        draftInput.className = 'universal-launcher-input';
        draftInput.value = typeof state.newWorkspaceNameDraftsByTaskId[task.id] === 'string'
          ? state.newWorkspaceNameDraftsByTaskId[task.id]
          : suggestedNewWorkspaceName;
        draftInput.placeholder = suggestedNewWorkspaceName;
        draftInput.addEventListener('input', () => {
          setNewWorkspaceNameDraft(task.id, draftInput.value);
          render();
          notifyChange();
        });
        draftField.appendChild(draftInput);
        namingWrap.appendChild(draftField);

        const inlineActions = document.createElement('div');
        inlineActions.className = 'universal-launcher-template-inline-actions';

        const useSuggestedButton = document.createElement('button');
        useSuggestedButton.type = 'button';
        useSuggestedButton.className = 'universal-launcher-template-inline-link';
        useSuggestedButton.textContent = 'Use suggestion';
        useSuggestedButton.addEventListener('click', () => {
          setNewWorkspaceNameDraft(task.id, suggestedNewWorkspaceName);
          render();
          notifyChange();
        });
        inlineActions.appendChild(useSuggestedButton);

        const doneButton = document.createElement('button');
        doneButton.type = 'button';
        doneButton.className = 'universal-launcher-template-inline-link';
        doneButton.textContent = 'Done';
        doneButton.addEventListener('click', () => {
          const nextDraft = String(state.newWorkspaceNameDraftsByTaskId[task.id] || '').trim();
          if (!nextDraft || !isValidWorkspaceName(nextDraft)) {
            delete state.newWorkspaceNameDraftsByTaskId[task.id];
          }
          setCustomizingNewWorkspace(task.id, false);
          render();
          notifyChange();
        });
        inlineActions.appendChild(doneButton);

        const inlineHelper = document.createElement('div');
        inlineHelper.className = 'universal-launcher-template-helper';
        inlineHelper.textContent = isNewWorkspaceNameValid
          ? `Will create: ${nameToDisplay}`
          : 'Use letters, numbers, dots, dashes, or underscores only.';
        const inlineFooter = document.createElement('div');
        inlineFooter.className = 'universal-launcher-template-inline-footer';
        inlineFooter.appendChild(inlineHelper);
        inlineFooter.appendChild(inlineActions);
        namingWrap.appendChild(inlineFooter);
      } else {
        const summaryRow = document.createElement('div');
        summaryRow.className = 'universal-launcher-template-inline-summary-row';

        const summary = document.createElement('div');
        summary.className = 'universal-launcher-template-inline-summary';
        summary.textContent = `Will create: ${nameToDisplay}`;
        summaryRow.appendChild(summary);

        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'universal-launcher-template-inline-link';
        renameButton.textContent = 'Rename';
        renameButton.addEventListener('click', () => {
          if (!state.newWorkspaceNameDraftsByTaskId[task.id]) {
            setNewWorkspaceNameDraft(task.id, suggestedNewWorkspaceName);
          }
          setCustomizingNewWorkspace(task.id, true);
          render();
          notifyChange();
          requestAnimationFrame(() => {
            const renameInput = workspaceList.querySelector('.universal-launcher-template-inline-field .universal-launcher-input');
            if (renameInput && typeof renameInput.focus === 'function') {
              renameInput.focus();
              try {
                renameInput.setSelectionRange(0, renameInput.value.length);
              } catch (_) {}
            }
          });
        });
        summaryRow.appendChild(renameButton);
        namingWrap.appendChild(summaryRow);
      }

      newCard.appendChild(namingWrap);

      if (hasExistingWorkspaces) {
        const freshIntro = document.createElement('div');
        freshIntro.className = 'universal-launcher-template-helper universal-launcher-ask-task-fresh-note';
        freshIntro.textContent = 'Need a clean start?';
        freshWorkspaceWrap.appendChild(freshIntro);
        freshWorkspaceWrap.appendChild(newCard);
      } else {
        freshWorkspaceWrap.appendChild(newCard);
      }
    }

    function render() {
      const hasResults = getTaskQueryResults().length > 0;
      const hasSelectedTask = Boolean(getSelectedTask());
      section.hidden = !state.enabled || (!hasResults && !hasSelectedTask);
      if (section.hidden) {
        suggestionsWrap.hidden = true;
        selectedWrap.hidden = true;
        return;
      }
      renderSuggestions();
      renderSelectedTask();
    }

    clearButton.addEventListener('click', () => {
      clearSelection();
    });

    return {
      section,
      getSelectedTask,
      getRenderedPrompt() {
        return getRenderedPrompt(getSelectedTask());
      },
      getLaunchPayload() {
        const task = getSelectedTask();
        if (!task) {
          return null;
        }
        const taskId = task.id;
        const workspaceMode = getWorkspaceMode(taskId);
        return {
          taskId,
          inputs: { ...(state.inputDrafts[taskId] || {}) },
          workspaceMode,
          workspaceRef: workspaceMode === 'reuse' ? getSelectedWorkspaceRef(taskId) : '',
          workspaceName: workspaceMode === 'new' ? getPlannedNewWorkspaceName(task, getTaskWorkspaceState(taskId)) : '',
        };
      },
      isTaskMode() {
        return Boolean(getSelectedTask());
      },
      hasTaskQuery() {
        return Boolean(state.query.trim());
      },
      hasTaskMatches() {
        return getTaskQueryResults().length > 0;
      },
      getSuggestedNameSource() {
        const task = getSelectedTask();
        if (!task) {
          return '';
        }
        return getTaskInputNameSuggestion(task, state.inputDrafts[task.id] || {});
      },
      isComplete() {
        const task = getSelectedTask();
        if (!task) {
          return true;
        }
        if (usesWorkspaceFlow() && getTaskWorkspaceState(task.id).loading) {
          return false;
        }
        if (!isTaskComplete(task)) {
          return false;
        }
        if (!usesWorkspaceFlow()) {
          return true;
        }
        const taskId = task.id;
        if (getWorkspaceMode(taskId) === 'reuse') {
          return Boolean(getSelectedWorkspaceRef(taskId));
        }
        return isValidWorkspaceName(getPlannedNewWorkspaceName(task, getTaskWorkspaceState(taskId)));
      },
      focusPrimaryControl() {
        const task = getSelectedTask();
        if (!task) {
          return false;
        }
        const firstInput = inputList.querySelector('input:not([disabled])');
        if (firstInput && typeof firstInput.focus === 'function') {
          firstInput.focus();
          return true;
        }
        if (usesWorkspaceFlow()) {
          const firstWorkspaceButton = workspaceList.querySelector('.universal-launcher-template-row-action-button:not([disabled])');
          if (firstWorkspaceButton && typeof firstWorkspaceButton.focus === 'function') {
            firstWorkspaceButton.focus();
            return true;
          }
        }
        if (clearButton && typeof clearButton.focus === 'function') {
          clearButton.focus();
          return true;
        }
        return false;
      },
      handlePromptInput(value, options = {}) {
        if (this.isTaskMode()) {
          return;
        }
        const nextQuery = typeof value === 'string' ? value.trim() : '';
        const changed = state.query !== nextQuery;
        state.query = nextQuery;
        render();
        if (changed && options.notify !== false) {
          notifyChange();
        }
      },
      reset() {
        state.query = '';
        state.selectedTaskId = '';
        state.inputDrafts = {};
        state.workspacesByTaskId = {};
        state.workspaceModeByTaskId = {};
        state.selectedWorkspaceRefByTaskId = {};
        state.newWorkspaceNameDraftsByTaskId = {};
        state.customWorkspaceNameByTaskId = {};
        state.loadTokenByTaskId = {};
        render();
      },
      setEnabled(enabled) {
        const nextEnabled = Boolean(enabled);
        if (state.enabled === nextEnabled) {
          return;
        }
        state.enabled = nextEnabled;
        if (!state.enabled) {
          state.selectedTaskId = '';
        }
        render();
      },
      setTarget(taskTarget) {
        const nextTarget = taskTarget || 'workspaces';
        const task = getSelectedTask();
        const selectedTaskInvalid = Boolean(task && !taskMatchesSelectionTarget(task, nextTarget));
        if (state.currentTarget === nextTarget && !selectedTaskInvalid) {
          return;
        }
        state.currentTarget = nextTarget;
        if (selectedTaskInvalid) {
          state.selectedTaskId = '';
        }
        render();
      },
      setTasks(tasks) {
        state.tasks = Array.isArray(tasks) ? tasks.slice() : [];
        const task = getSelectedTask();
        if (!taskMatchesSelectionTarget(task, state.currentTarget)) {
          state.selectedTaskId = '';
        }
        render();
      },
      set onChange(handler) {
        state.onChange = typeof handler === 'function' ? handler : null;
      },
      set onAction(handler) {
        state.onAction = typeof handler === 'function' ? handler : null;
      },
    };
  }

  function buildIntentSwitch() {
    const wrap = document.createElement('div');
    wrap.className = 'universal-launcher-intents';
    wrap.setAttribute('role', 'tablist');
    wrap.setAttribute('aria-label', 'Launcher type');

    const entries = [];
    Object.keys(INTENTS).forEach((intentKey) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'universal-launcher-intent';
      button.dataset.intent = intentKey;
      button.textContent = INTENTS[intentKey].label;
      wrap.appendChild(button);
      entries.push(button);
    });

    return { wrap, entries };
  }

  function buildModeSwitch(intent) {
    const wrap = document.createElement('div');
    wrap.className = 'universal-launcher-modes';
    wrap.setAttribute('role', 'tablist');
    wrap.setAttribute('aria-label', 'Launcher mode');

    const entries = {};
    [
      { key: 'primary', label: getIntentPrimaryModeLabel(intent) },
      { key: 'download', label: getIntentDownloadModeLabel(intent) },
    ].forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'universal-launcher-mode';
      button.dataset.mode = entry.key;
      button.textContent = entry.label;
      wrap.appendChild(button);
      entries[entry.key] = button;
    });

    return { wrap, entries };
  }

  function buildUi(tools) {
    const overlay = document.createElement('div');
    overlay.className = 'universal-launcher-overlay';
    overlay.hidden = true;

    const panel = document.createElement('section');
    panel.className = 'universal-launcher-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'universal-launcher-title');
    overlay.appendChild(panel);

    const header = document.createElement('header');
    header.className = 'universal-launcher-header';
    panel.appendChild(header);

    const heading = document.createElement('div');
    heading.className = 'universal-launcher-heading';
    header.appendChild(heading);

    const titleRow = document.createElement('div');
    titleRow.className = 'universal-launcher-title-row';
    heading.appendChild(titleRow);

    const brandMark = document.createElement('span');
    brandMark.className = 'universal-launcher-brand-mark';
    brandMark.setAttribute('aria-hidden', 'true');
    titleRow.appendChild(brandMark);

    const title = document.createElement('h3');
    title.className = 'universal-launcher-title';
    title.id = 'universal-launcher-title';
    titleRow.appendChild(title);

    const description = document.createElement('p');
    description.className = 'universal-launcher-description';
    heading.appendChild(description);

    const status = document.createElement('div');
    status.className = 'universal-launcher-status';
    status.hidden = true;
    status.setAttribute('aria-hidden', 'true');
    status.innerHTML = '<span class="universal-launcher-status-spinner" aria-hidden="true"></span><div class="universal-launcher-status-copy"><div class="universal-launcher-status-label"></div><div class="universal-launcher-status-detail"></div></div>';
    heading.appendChild(status);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'universal-launcher-close';
    closeButton.setAttribute('aria-label', 'Close launcher');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    header.appendChild(closeButton);

    const body = document.createElement('div');
    body.className = 'universal-launcher-body';
    panel.appendChild(body);

    const { wrap: intentWrap, entries: intentButtons } = buildIntentSwitch();
    body.appendChild(intentWrap);

    const { wrap: modeWrap, entries: modeButtons } = buildModeSwitch('create_app');
    body.appendChild(modeWrap);

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'universal-launcher-primary-grid';
    body.appendChild(primaryGrid);

    const secondaryGrid = document.createElement('div');
    secondaryGrid.className = 'universal-launcher-secondary-grid';
    body.appendChild(secondaryGrid);

    const taskBrowser = buildTaskTemplateSection(panel);
    const askTaskSection = buildAskTaskSection();
    const downloadSection = buildInlineDownloadSection();

    const promptSection = document.createElement('section');
    promptSection.className = 'universal-launcher-section universal-launcher-section-prompt';
    primaryGrid.appendChild(promptSection);

    const { heading: promptHeading, title: promptTitle } = buildSectionHeading('What do you want to do?');
    promptHeading.classList.add('universal-launcher-section-heading-with-action');
    const promptHeadingActions = document.createElement('div');
    promptHeadingActions.className = 'universal-launcher-section-heading-actions';
    promptHeading.appendChild(promptHeadingActions);
    promptHeadingActions.appendChild(taskBrowser.toggle);
    promptSection.appendChild(promptHeading);

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'universal-launcher-textarea';
    promptTextarea.rows = 3;
    const composerFrame = document.createElement('div');
    composerFrame.className = 'universal-launcher-ask-composer';
    promptSection.appendChild(composerFrame);
    composerFrame.appendChild(promptTextarea);
    composerFrame.appendChild(askTaskSection.section);

    const nameSection = document.createElement('section');
    nameSection.className = 'universal-launcher-section universal-launcher-section-name';
    primaryGrid.appendChild(nameSection);

    const { heading: nameHeading, note: nameMeta } = buildSectionHeading('Name', '');
    nameSection.appendChild(nameHeading);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'universal-launcher-input';
    nameInput.placeholder = 'Enter folder name, e.g. my-project';
    nameSection.appendChild(nameInput);

    const nameStatus = document.createElement('div');
    nameStatus.className = 'universal-launcher-field-status';
    nameStatus.hidden = true;
    nameSection.appendChild(nameStatus);

    primaryGrid.appendChild(downloadSection.section);

    const { section: toolSection, picker: toolPicker } = buildToolOptions(tools, panel);
    secondaryGrid.appendChild(toolSection);

    const attachments = buildAttachmentSection();
    attachments.section.hidden = !ATTACHMENTS_ENABLED;
    attachments.section.classList.toggle('is-disabled', !ATTACHMENTS_ENABLED);
    attachments.section.setAttribute('aria-hidden', ATTACHMENTS_ENABLED ? 'false' : 'true');
    secondaryGrid.appendChild(attachments.section);

    const error = document.createElement('div');
    error.className = 'universal-launcher-error';
    body.appendChild(error);

    const outputSection = document.createElement('section');
    outputSection.className = 'universal-launcher-output';
    outputSection.hidden = true;
    outputSection.setAttribute('aria-hidden', 'true');
    outputSection.innerHTML = '<div class="universal-launcher-output-label">Terminal output</div><pre class="universal-launcher-output-code"></pre>';
    body.appendChild(outputSection);

    const footer = document.createElement('footer');
    footer.className = 'universal-launcher-footer';
    panel.appendChild(footer);

    const footerStart = document.createElement('div');
    footerStart.className = 'universal-launcher-footer-start';
    footer.appendChild(footerStart);

    const footerLinks = document.createElement('div');
    footerLinks.className = 'universal-launcher-footer-links';
    footerStart.appendChild(footerLinks);

    const utilityLinks = document.createElement('div');
    utilityLinks.className = 'universal-launcher-footer-utility-links';
    footerLinks.appendChild(utilityLinks);

    const advancedLink = document.createElement('a');
    advancedLink.className = 'universal-launcher-advanced-link';
    advancedLink.hidden = true;
    utilityLinks.appendChild(advancedLink);

    const shareLink = document.createElement('a');
    shareLink.className = 'universal-launcher-share-link';
    shareLink.href = '#';
    shareLink.textContent = 'Save task';
    footerLinks.appendChild(shareLink);

    const footerActions = document.createElement('div');
    footerActions.className = 'universal-launcher-footer-actions';
    footer.appendChild(footerActions);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'universal-launcher-button universal-launcher-button-secondary';
    cancelButton.textContent = 'Cancel';
    footerActions.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'universal-launcher-button universal-launcher-button-primary';
    footerActions.appendChild(confirmButton);

    const ui = {
      overlay,
      panel,
      title,
      description,
      status,
      statusLabel: status.querySelector('.universal-launcher-status-label'),
      statusDetail: status.querySelector('.universal-launcher-status-detail'),
      closeButton,
      intentWrap,
      intentButtons,
      modeWrap,
      modeButtons,
      secondaryGrid,
      taskBrowser,
      askTaskSection,
      downloadSection,
      composerFrame,
      promptSection,
      promptHeading,
      promptHeadingActions,
      promptTextarea,
      promptTitle,
      nameSection,
      nameInput,
      nameStatus,
      nameMeta,
      attachments,
      toolPicker,
      error,
      outputSection,
      outputCode: outputSection.querySelector('.universal-launcher-output-code'),
      footer,
      footerLinks,
      utilityLinks,
      footerStart,
      footerActions,
      advancedLink,
      shareLink,
      cancelButton,
      confirmButton,
      intent: 'create_app',
      mode: 'primary',
      nameEdited: false,
      nameValidationState: 'idle',
      nameValidationMessage: '',
      nameValidationTimer: null,
      nameValidationSeq: 0,
      nameValidationCheckedName: '',
      nameValidationCheckedPath: '',
      isSubmitting: false,
      promptDrafts: {
        create_app: '',
        ask: '',
        create_plugin: '',
      },
      setIntent(nextIntent) {
        const intent = normalizeIntent(nextIntent);
        const currentIntent = normalizeIntent(this.intent);
        const preserveCurrentTaskDraft = Boolean(
          this.askTaskSection
          && typeof this.askTaskSection.isTaskMode === 'function'
          && this.askTaskSection.isTaskMode()
        );
        if (Object.prototype.hasOwnProperty.call(this.promptDrafts, currentIntent)) {
          this.promptDrafts[currentIntent] = preserveCurrentTaskDraft
            ? this.promptDrafts[currentIntent]
            : this.promptTextarea.value;
        }
        this.intent = intent;
        const intentConfig = INTENTS[intent];
        const promptDraft = Object.prototype.hasOwnProperty.call(this.promptDrafts, intent)
          ? this.promptDrafts[intent]
          : '';
        this.promptTextarea.value = buildInitialPrompt(intent, promptDraft);
        this.promptDrafts[intent] = this.promptTextarea.value;
        this.title.textContent = intentConfig.title;
        this.description.textContent = intentConfig.description;
        const showName = intentUsesName(intent);
        this.nameMeta.textContent = showName
          ? `Required${intentConfig.targetLabel ? ` · ${intentConfig.targetLabel}` : ''}`
          : '';
        this.nameSection.hidden = !showName;
        this.nameSection.setAttribute('aria-hidden', showName ? 'false' : 'true');
        if (this.promptTitle) {
          this.promptTitle.textContent = intentConfig.promptLabel || 'What do you want to do?';
        }
        if (this.toolPicker && this.toolPicker.sectionTitle) {
          this.toolPicker.sectionTitle.textContent = intentConfig.toolLabel || 'Select plugin';
        }
        if (this.toolPicker && this.toolPicker.sectionNote) {
          this.toolPicker.sectionNote.textContent = intentConfig.toolNote || 'Required';
        }
        this.promptTextarea.placeholder = intentConfig.promptPlaceholder;
        this.confirmButton.textContent = intentConfig.confirmLabel;
        if (this.modeButtons) {
          if (this.modeButtons.primary) {
            this.modeButtons.primary.textContent = getIntentPrimaryModeLabel(intent);
          }
          if (this.modeButtons.download) {
            this.modeButtons.download.textContent = getIntentDownloadModeLabel(intent);
          }
        }
        if (this.advancedLink) {
          const hasAdvancedLink = Boolean(intentConfig.advancedHref && intentConfig.advancedLabel);
          this.advancedLink.hidden = !hasAdvancedLink;
          this.advancedLink.setAttribute('aria-hidden', hasAdvancedLink ? 'false' : 'true');
          if (hasAdvancedLink) {
            this.advancedLink.href = intentConfig.advancedHref;
            this.advancedLink.innerHTML = '<i class="fa-solid fa-sliders universal-launcher-footer-link-icon" aria-hidden="true"></i><span></span>';
            const label = this.advancedLink.querySelector('span');
            if (label) {
              label.textContent = intentConfig.advancedLabel;
            }
          } else {
            this.advancedLink.removeAttribute('href');
            this.advancedLink.textContent = '';
          }
        }
        this.intentButtons.forEach((button) => {
          const active = button.dataset.intent === intent;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (this.downloadSection) {
          this.downloadSection.setIntent(intent);
        }
        if (!showName) {
          this.nameInput.value = '';
          setNameValidationState(this, 'idle', '');
        } else if (!this.nameEdited && shouldAutoPopulateName(intent)) {
          this.nameInput.value = generateNameSuggestion(
            getPromptForNameSuggestion(intent, this.promptTextarea.value)
          );
        }
        if (showName) {
          scheduleNameValidation(this);
        }
        if (this.taskBrowser) {
          this.taskBrowser.setTarget(getIntentTaskTarget(intent));
        }
        resizePromptTextarea(this);
        syncShareLink(this);
        syncTaskMode(this);
        syncLauncherMode(this);
        updateSubmitAvailability(this);
      },
      setMode(nextMode) {
        this.mode = nextMode === 'download' ? 'download' : 'primary';
        if (this.modeButtons) {
          Object.keys(this.modeButtons).forEach((key) => {
            const button = this.modeButtons[key];
            const active = key === this.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
          });
        }
        if (this.downloadSection) {
          this.downloadSection.setIntent(this.intent);
        }
        syncShareLink(this);
        syncTaskMode(this);
        syncLauncherMode(this);
        updateSubmitAvailability(this);
      },
    };

    nameInput.addEventListener('input', () => {
      ui.nameEdited = true;
      ui.error.textContent = '';
      scheduleNameValidation(ui);
      syncShareLink(ui);
    });

    promptTextarea.addEventListener('input', () => {
      ui.promptDrafts[ui.intent] = promptTextarea.value;
      if (ui.askTaskSection) {
        ui.askTaskSection.handlePromptInput(promptTextarea.value);
      }
      if (!intentUsesName(ui.intent)) {
        ui.nameInput.value = '';
      } else if (!ui.nameEdited) {
        syncDerivedName(ui);
      }
      resizePromptTextarea(ui);
      syncShareLink(ui);
    });

    intentButtons.forEach((button) => {
      button.addEventListener('click', () => {
        ui.setIntent(button.dataset.intent);
        requestAnimationFrame(() => {
          focusPromptTextarea(ui);
        });
      });
    });
    Object.keys(modeButtons).forEach((key) => {
      const button = modeButtons[key];
      button.addEventListener('click', () => {
        ui.setMode(button.dataset.mode);
        requestAnimationFrame(() => {
          focusPromptTextarea(ui);
        });
      });
    });

    toolPicker.onChange = () => {
      syncShareLink(ui);
      updateSubmitAvailability(ui);
    };
    downloadSection.onChange = () => {
      ui.error.textContent = '';
      updateSubmitAvailability(ui);
    };
    taskBrowser.setCreateDefaultsResolver(() => {
      const prompt = getPromptForNameSuggestion(ui.intent, ui.promptTextarea.value || '').trim();
      return {
        target: getIntentTaskTarget(ui.intent),
        lockTarget: true,
        template: prompt,
      };
    });
    taskBrowser.onCommit = ({ prompt }) => {
      ui.promptTextarea.value = prompt;
      ui.promptDrafts[ui.intent] = prompt;
      if (!intentUsesName(ui.intent)) {
        ui.nameInput.value = '';
      } else if (!ui.nameEdited && shouldAutoPopulateName(ui.intent)) {
        ui.nameInput.value = generateNameSuggestion(
          getPromptForNameSuggestion(ui.intent, prompt)
        );
        scheduleNameValidation(ui);
      }
      syncShareLink(ui);
      requestAnimationFrame(() => {
        focusPromptTextarea(ui);
      });
    };
    askTaskSection.onChange = () => {
      syncTaskMode(ui);
      syncDerivedName(ui);
      syncShareLink(ui);
      updateSubmitAvailability(ui);
    };
    askTaskSection.onAction = (payload) => {
      submit(ui, { taskPayloadOverride: payload });
    };

    ui.setIntent('create_app');
    ui.setMode('primary');
    syncShareLink(ui);
    syncTaskMode(ui);
    syncLauncherMode(ui);
    updateSubmitAvailability(ui);

    return ui;
  }

  function syncTaskMode(ui) {
    if (!ui) {
      return;
    }
    const intentConfig = INTENTS[normalizeIntent(ui.intent)];
    const isAskIntent = normalizeIntent(ui.intent) === 'ask';
    const isDownloadMode = ui.mode === 'download';
    const shouldEnableInlineTaskBrowse = isAskIntent && !isDownloadMode;
    const shouldShowTemplatePicker = !isAskIntent && !isDownloadMode;
    const isInlineTaskMode = Boolean(
      shouldEnableInlineTaskBrowse
      && ui.askTaskSection
      && typeof ui.askTaskSection.isTaskMode === 'function'
      && ui.askTaskSection.isTaskMode()
    );
    const effectiveInlineTaskMode = isInlineTaskMode && !isDownloadMode;
    const wasInlineTaskMode = ui._wasInlineTaskMode === true;
    const hasInlineTaskMatches = Boolean(
      shouldEnableInlineTaskBrowse
      && ui.askTaskSection
      && typeof ui.askTaskSection.hasTaskMatches === 'function'
      && ui.askTaskSection.hasTaskMatches()
    );

    if (ui.askTaskSection) {
      ui.askTaskSection.setEnabled(shouldEnableInlineTaskBrowse);
      ui.askTaskSection.setTarget(getIntentTaskTarget(ui.intent));
    }
    if (ui.taskBrowser && ui.taskBrowser.toggle) {
      ui.taskBrowser.toggle.hidden = !shouldShowTemplatePicker;
      ui.taskBrowser.toggle.setAttribute('aria-hidden', shouldShowTemplatePicker ? 'false' : 'true');
    }
    if (ui.promptHeadingActions) {
      if (ui.taskBrowser && ui.taskBrowser.toggle && ui.taskBrowser.toggle.parentElement !== ui.promptHeadingActions) {
        ui.promptHeadingActions.appendChild(ui.taskBrowser.toggle);
      }
      if (ui.shareLink) {
        const shouldUsePromptHeading = isAskIntent;
        const targetParent = shouldUsePromptHeading ? ui.promptHeadingActions : ui.footerLinks;
        if (targetParent && ui.shareLink.parentElement !== targetParent) {
          targetParent.appendChild(ui.shareLink);
        }
      }
      const hasVisibleAction = Array.from(ui.promptHeadingActions.children).some((node) => !node.hidden);
      ui.promptHeadingActions.hidden = !hasVisibleAction;
      ui.promptHeadingActions.setAttribute('aria-hidden', hasVisibleAction ? 'false' : 'true');
    }
    if (ui.composerFrame) {
      ui.composerFrame.classList.toggle('is-ask-intent', isAskIntent);
      ui.composerFrame.classList.toggle('has-inline-results', hasInlineTaskMatches && !effectiveInlineTaskMode);
      ui.composerFrame.classList.toggle('is-task-mode', effectiveInlineTaskMode);
    }
    if (ui.toolPicker && ui.toolPicker.section) {
      const toolSection = ui.toolPicker.section;
      if (isAskIntent && ui.footerStart && toolSection.parentElement !== ui.footerStart) {
        ui.footerStart.insertBefore(toolSection, ui.footerLinks || null);
      } else if (!isAskIntent && ui.secondaryGrid && toolSection.parentElement !== ui.secondaryGrid) {
        ui.secondaryGrid.insertBefore(toolSection, ui.attachments && ui.attachments.section ? ui.attachments.section : null);
      }
      toolSection.classList.toggle('footer-mounted', isAskIntent);
    }
    if (ui.panel && ui.footer) {
      ui.footer.classList.toggle('has-footer-tool', isAskIntent);
    }
    if (ui.cancelButton) {
      ui.cancelButton.hidden = isAskIntent;
      ui.cancelButton.setAttribute('aria-hidden', isAskIntent ? 'true' : 'false');
    }
    if (ui.footerActions) {
      const hideFooterActions = isAskIntent && effectiveInlineTaskMode;
      ui.footerActions.hidden = hideFooterActions;
      ui.footerActions.setAttribute('aria-hidden', hideFooterActions ? 'true' : 'false');
    }

    if (ui.promptSection && ui.promptTextarea) {
      ui.promptSection.hidden = false;
      ui.promptSection.setAttribute('aria-hidden', 'false');
      ui.promptTextarea.hidden = effectiveInlineTaskMode;
      ui.promptTextarea.setAttribute('aria-hidden', effectiveInlineTaskMode ? 'true' : 'false');
      ui.promptTextarea.readOnly = effectiveInlineTaskMode;
      if (effectiveInlineTaskMode) {
        ui.promptTextarea.setAttribute('aria-readonly', 'true');
        ui.promptTextarea.classList.add('is-readonly');
        ui.promptTextarea.value = ui.askTaskSection.getRenderedPrompt();
      } else {
        ui.promptTextarea.removeAttribute('aria-readonly');
        ui.promptTextarea.classList.remove('is-readonly');
        ui.promptTextarea.value = buildInitialPrompt(ui.intent, ui.promptDrafts[ui.intent] || '');
        if (ui.askTaskSection) {
          ui.askTaskSection.handlePromptInput(ui.promptTextarea.value, { notify: false });
        }
      }
      resizePromptTextarea(ui);
    }
    if (ui.promptHeading) {
      ui.promptHeading.hidden = effectiveInlineTaskMode;
      ui.promptHeading.setAttribute('aria-hidden', effectiveInlineTaskMode ? 'true' : 'false');
    }
    if (ui.nameSection) {
      const showName = intentUsesName(ui.intent);
      ui.nameSection.hidden = !showName;
      ui.nameSection.setAttribute('aria-hidden', showName ? 'false' : 'true');
    }
    if (ui.advancedLink) {
      const shouldHideAdvanced = !intentConfig.advancedHref || !intentConfig.advancedLabel;
      ui.advancedLink.hidden = shouldHideAdvanced;
      ui.advancedLink.setAttribute('aria-hidden', shouldHideAdvanced ? 'true' : 'false');
    }
    if (ui.confirmButton) {
      if (isAskIntent && effectiveInlineTaskMode && ui.askTaskSection) {
        const launchPayload = ui.askTaskSection.getLaunchPayload();
        ui.confirmButton.textContent = launchPayload && launchPayload.workspaceMode === 'reuse'
          ? 'Continue'
          : 'Start new workspace';
      } else if (
        isAskIntent
        && ui.askTaskSection
        && typeof ui.askTaskSection.hasTaskQuery === 'function'
        && ui.askTaskSection.hasTaskQuery()
      ) {
        ui.confirmButton.textContent = 'Run Prompt';
      } else {
        ui.confirmButton.textContent = intentConfig.confirmLabel;
      }
      ui.confirmButton.hidden = isAskIntent && effectiveInlineTaskMode;
      ui.confirmButton.setAttribute('aria-hidden', (isAskIntent && effectiveInlineTaskMode) ? 'true' : 'false');
    }
    if (ui.toolPicker && ui.toolPicker.sectionTitle) {
      ui.toolPicker.sectionTitle.textContent = effectiveInlineTaskMode ? 'Tool' : (intentConfig.toolLabel || 'Select plugin');
      ui.toolPicker.sectionTitle.hidden = isAskIntent;
      ui.toolPicker.sectionTitle.setAttribute('aria-hidden', isAskIntent ? 'true' : 'false');
    }
    if (ui.toolPicker && ui.toolPicker.sectionNote) {
      ui.toolPicker.sectionNote.hidden = isAskIntent;
      ui.toolPicker.sectionNote.setAttribute('aria-hidden', isAskIntent ? 'true' : 'false');
    }
    ui._wasInlineTaskMode = effectiveInlineTaskMode;
    if (effectiveInlineTaskMode && !wasInlineTaskMode && ui.askTaskSection && typeof ui.askTaskSection.focusPrimaryControl === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (
            ui.askTaskSection
            && typeof ui.askTaskSection.isTaskMode === 'function'
            && ui.askTaskSection.isTaskMode()
          ) {
            ui.askTaskSection.focusPrimaryControl();
          }
        });
      });
    }
  }

  function syncLauncherMode(ui) {
    if (!ui) {
      return;
    }
    const intent = normalizeIntent(ui.intent);
    const isAskIntent = intent === 'ask';
    const isDownloadMode = ui.mode === 'download';
    const showName = intentUsesName(intent) && !isDownloadMode;
    const showTool = !isDownloadMode;

    if (ui.modeWrap) {
      ui.modeWrap.hidden = false;
      ui.modeWrap.setAttribute('aria-hidden', 'false');
    }
    if (ui.downloadSection && ui.downloadSection.section) {
      ui.downloadSection.section.hidden = !isDownloadMode;
      ui.downloadSection.section.setAttribute('aria-hidden', isDownloadMode ? 'false' : 'true');
    }
    if (ui.promptSection) {
      ui.promptSection.hidden = isDownloadMode;
      ui.promptSection.setAttribute('aria-hidden', isDownloadMode ? 'true' : 'false');
    }
    if (ui.nameSection) {
      ui.nameSection.hidden = !showName;
      ui.nameSection.setAttribute('aria-hidden', showName ? 'false' : 'true');
    }
    if (ui.toolPicker && ui.toolPicker.section) {
      ui.toolPicker.section.hidden = !showTool;
      ui.toolPicker.section.setAttribute('aria-hidden', showTool ? 'false' : 'true');
      ui.toolPicker.section.classList.toggle('footer-mounted', isAskIntent && showTool);
    }
    if (ui.attachments && ui.attachments.section) {
      const showAttachments = !isDownloadMode && ATTACHMENTS_ENABLED;
      ui.attachments.section.hidden = !showAttachments;
      ui.attachments.section.setAttribute('aria-hidden', showAttachments ? 'false' : 'true');
    }
    if (ui.footer) {
      ui.footer.classList.toggle('has-footer-tool', isAskIntent && showTool);
    }
    if (ui.confirmButton) {
      if (isDownloadMode) {
        ui.confirmButton.textContent = intent === 'ask' ? 'Import task' : 'Import';
        ui.confirmButton.hidden = false;
        ui.confirmButton.setAttribute('aria-hidden', 'false');
      }
    }
    if (ui.advancedLink) {
      const intentConfig = INTENTS[intent];
      const showAdvanced = !isDownloadMode && Boolean(intentConfig.advancedHref && intentConfig.advancedLabel);
      ui.advancedLink.hidden = !showAdvanced;
      ui.advancedLink.setAttribute('aria-hidden', showAdvanced ? 'false' : 'true');
    }
    if (ui.shareLink) {
      const hideShare = isDownloadMode;
      ui.shareLink.hidden = hideShare;
      ui.shareLink.setAttribute('aria-hidden', hideShare ? 'true' : 'false');
    }
    if (ui.footerLinks) {
      const hasVisibleFooterLink = Array.from(ui.footerLinks.children).some((node) => !node.hidden);
      ui.footerLinks.hidden = !hasVisibleFooterLink;
      ui.footerLinks.setAttribute('aria-hidden', hasVisibleFooterLink ? 'false' : 'true');
    }
  }

  function clearSubmissionState(ui) {
    if (!ui) {
      return;
    }
    const intentConfig = INTENTS[normalizeIntent(ui.intent)];
    if (ui.title) {
      ui.title.textContent = intentConfig.title;
    }
    if (ui.description) {
      ui.description.textContent = intentConfig.description;
    }
    if (ui.status) {
      ui.status.hidden = true;
      ui.status.setAttribute('aria-hidden', 'true');
    }
    if (ui.statusLabel) {
      ui.statusLabel.textContent = '';
    }
    if (ui.statusDetail) {
      ui.statusDetail.textContent = '';
      ui.statusDetail.hidden = false;
    }
    if (ui.confirmButton) {
      ui.confirmButton.textContent = intentConfig.confirmLabel;
    }
    if (ui.closeButton) {
      ui.closeButton.hidden = false;
      ui.closeButton.setAttribute('aria-hidden', 'false');
    }
    if (ui.panel) {
      ui.panel.classList.remove('is-submitting');
    }
  }

  function setSubmissionState(ui, options) {
    if (!ui) {
      return;
    }
    const intentConfig = INTENTS[normalizeIntent(ui.intent)];
    const state = options && typeof options === 'object' ? options : {};
    const label = typeof state.label === 'string' ? state.label.trim() : '';
    const detail = typeof state.detail === 'string' ? state.detail.trim() : '';
    if (ui.title) {
      ui.title.textContent = state.title || intentConfig.title;
    }
    if (ui.description) {
      ui.description.textContent = state.description || intentConfig.description;
    }
    if (ui.status && ui.statusLabel && ui.statusDetail) {
      ui.status.hidden = !label;
      ui.status.setAttribute('aria-hidden', label ? 'false' : 'true');
      ui.statusLabel.textContent = label;
      ui.statusDetail.textContent = detail;
      ui.statusDetail.hidden = !detail;
    }
    if (ui.confirmButton) {
      ui.confirmButton.textContent = state.confirmLabel || intentConfig.confirmLabel;
    }
    if (ui.closeButton) {
      const hideClose = state.hideClose !== false;
      ui.closeButton.hidden = hideClose;
      ui.closeButton.setAttribute('aria-hidden', hideClose ? 'true' : 'false');
    }
    if (ui.panel) {
      ui.panel.classList.toggle('is-submitting', Boolean(label));
    }
  }

  function updateSubmitAvailability(ui) {
    if (!ui || !ui.confirmButton) {
      return;
    }
    if (ui.mode === 'download') {
      const downloadReady = Boolean(ui.downloadSection && ui.downloadSection.isReady());
      ui.confirmButton.disabled = ui.isSubmitting || !downloadReady;
      return;
    }
    if (!ui.toolPicker) {
      return;
    }
    const hasTool = Boolean(ui.toolPicker.getSelectedEntry());
    const inlineTaskReady = !(
      ui.askTaskSection
      && ui.askTaskSection.isTaskMode()
      && !ui.askTaskSection.isComplete()
    );
    const requiresName = intentUsesName(ui.intent);
    const hasSettledName = !requiresName || (
      Boolean(ui.nameInput && ui.nameInput.value.trim())
      && ui.nameValidationState === 'success'
      && !ui.nameValidationTimer
    );
    ui.confirmButton.disabled = ui.isSubmitting || !hasTool || !inlineTaskReady || !hasSettledName;
  }

  function resetDownloadOutput(ui) {
    if (!ui || !ui.outputSection || !ui.outputCode) {
      return;
    }
    ui.outputCode.textContent = '';
    ui.outputSection.hidden = true;
    ui.outputSection.setAttribute('aria-hidden', 'true');
  }

  function appendDownloadOutput(ui, text) {
    if (!ui || !ui.outputSection || !ui.outputCode) {
      return;
    }
    const nextText = String(text == null ? '' : text);
    if (!nextText) {
      return;
    }
    ui.outputSection.hidden = false;
    ui.outputSection.setAttribute('aria-hidden', 'false');
    ui.outputCode.textContent += nextText;
    ui.outputCode.scrollTop = ui.outputCode.scrollHeight;
  }

  async function prepareDownloadClone(payload) {
    const response = await fetch('/launcher/download/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.ok) {
      throw new Error(result && result.error ? result.error : 'Failed to prepare download.');
    }
    return result;
  }

  async function finalizeDownloadClone(payload) {
    const response = await fetch('/launcher/download/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.ok || !result.url) {
      throw new Error(result && result.error ? result.error : 'Failed to finalize download.');
    }
    return result;
  }

  async function runDownloadClone(ui, clone) {
    if (!clone || typeof clone !== 'object') {
      throw new Error('Download is unavailable right now.');
    }
    appendDownloadOutput(ui, `$ ${clone.message}\n\n`);
    await new Promise((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      const settle = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          socket.close();
        } catch (_) {}
        fn(value);
      };
      socket.run({
        method: 'shell.run',
        client: DOWNLOAD_SHELL_CLIENT,
        params: {
          message: clone.message,
          path: clone.path,
          env: clone.env || { ...NON_INTERACTIVE_GIT_ENV },
        },
      }, (packet) => {
        if (!packet || typeof packet !== 'object') {
          return;
        }
        if (packet.type === 'stream') {
          const data = packet.data || {};
          if (typeof data.raw === 'string' && data.raw) {
            appendDownloadOutput(ui, data.raw);
          } else if (data.json) {
            appendDownloadOutput(ui, `${JSON.stringify(data.json)}\n`);
          } else if (data.json2) {
            appendDownloadOutput(ui, `${JSON.stringify(data.json2)}\n`);
          }
          return;
        }
        if (packet.type === 'result') {
          const errors = packet.data && Array.isArray(packet.data.error) ? packet.data.error : [];
          if (errors.length > 0) {
            const failureMessage = errors.join('\n').trim() || 'Download failed.';
            appendDownloadOutput(ui, `${failureMessage}\n`);
            settle(reject, new Error(failureMessage));
            return;
          }
          settle(resolve);
          return;
        }
        if (packet.type === 'error') {
          const failureMessage = typeof packet.data === 'string' && packet.data.trim()
            ? packet.data.trim()
            : 'Download failed.';
          appendDownloadOutput(ui, `${failureMessage}\n`);
          settle(reject, new Error(failureMessage));
        }
      }).catch((error) => {
        settle(reject, error instanceof Error ? error : new Error(String(error || 'Download failed.')));
      });
    });
  }

  function openSaveTemplatePage(ui) {
    if (!ui) return;
    const prompt = ui.promptTextarea ? ui.promptTextarea.value : '';
    const name = ui.intent !== 'ask' && ui.nameInput ? ui.nameInput.value.trim() : '';
    openTaskTemplateBuilder({
      target: getIntentTaskTarget(ui.intent),
      lockTarget: true,
      template: prompt,
      title: name,
    });
  }

  async function uploadFiles(files) {
    if (!files || !files.length) {
      return '';
    }
    const formData = new FormData();
    files.forEach((file) => {
      if (file) {
        formData.append('files', file, file.name || 'file');
      }
    });
    const response = await fetch('/create-upload', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to upload files.');
    }
    const payload = await response.json();
    if (!payload || payload.error || !payload.uploadToken) {
      throw new Error(payload && payload.error ? payload.error : 'Failed to upload files.');
    }
    return payload.uploadToken;
  }

  function applyDefaults(ui, defaults) {
    const options = defaults && typeof defaults === 'object' ? defaults : {};
    const hasPresetIntent = Boolean(
      (typeof options.type === 'string' && options.type.trim())
      || (typeof options.intent === 'string' && options.intent.trim())
    );
    const type = normalizeIntent(options.type || options.intent);
    const prompt = typeof options.prompt === 'string' ? options.prompt : '';
    const name = typeof options.name === 'string' ? options.name.trim() : '';
    const tool = typeof options.tool === 'string' ? options.tool.trim().replace(/^\/+|\/+$/g, '') : '';

    ui.error.textContent = '';
    ui.promptDrafts = {
      create_app: '',
      ask: '',
      create_plugin: '',
    };
    ui.promptDrafts[type] = buildInitialPrompt(type, prompt);
    ui.promptTextarea.value = '';
    ui.nameEdited = Boolean(name);
    ui.nameInput.value = '';
    clearNameValidationTimer(ui);
    ui.nameValidationSeq = 0;
    ui.nameValidationCheckedName = '';
    ui.nameValidationCheckedPath = '';
    setNameValidationState(ui, 'idle', '');
    ui.attachments.clear();
    ui.isSubmitting = false;
    clearSubmissionState(ui);
    if (ui.taskBrowser) {
      ui.taskBrowser.reset();
    }
    if (ui.askTaskSection) {
      ui.askTaskSection.reset();
    }
    if (ui.downloadSection) {
      ui.downloadSection.reset();
      ui.downloadSection.setDisabled(false);
    }
    resetDownloadOutput(ui);
    if (ui.intentWrap) {
      ui.intentWrap.hidden = hasPresetIntent;
      ui.intentWrap.setAttribute('aria-hidden', hasPresetIntent ? 'true' : 'false');
    }
    ui.setIntent(type);
    ui.setMode('primary');
    if (name) {
      ui.nameInput.value = name;
      scheduleNameValidation(ui);
    }
    ui.toolPicker.setDisabled(false);

    const preferredTool = tool || getStoredToolPreference();
    if (preferredTool) {
      ui.toolPicker.setValue(preferredTool, { persist: false });
      if (!ui.toolPicker.getSelectedEntry()) {
        setStoredToolPreference('');
      }
    } else {
      ui.toolPicker.setValue('', { persist: false });
    }
    ui.toolPicker.closeMenu();
    syncShareLink(ui);
    syncTaskMode(ui);
    syncLauncherMode(ui);
    updateSubmitAvailability(ui);
  }

  async function submit(ui, options = {}) {
    if (!ui) return;
    if (ui.isSubmitting) {
      return;
    }
    ui.error.textContent = '';

    if (ui.mode === 'download') {
      const validation = ui.downloadSection
        ? await ui.downloadSection.validateForSubmit()
        : { ok: false, error: 'Download is unavailable right now.' };
      if (!validation || !validation.ok || !validation.payload) {
        ui.error.textContent = validation && validation.error ? validation.error : 'Failed to validate download request.';
        if (validation && validation.focus === 'name' && ui.downloadSection && ui.downloadSection.nameInput) {
          ui.downloadSection.nameInput.focus();
        } else if (ui.downloadSection && ui.downloadSection.urlInput) {
          ui.downloadSection.urlInput.focus();
        }
        return;
      }

      const buttons = [ui.cancelButton, ui.confirmButton, ui.closeButton].filter(Boolean);
      ui.isSubmitting = true;
      updateSubmitAvailability(ui);
      buttons.forEach((button) => {
        button.disabled = true;
      });
      if (ui.downloadSection) {
        ui.downloadSection.setDisabled(true);
      }

      try {
        const downloadLabel = ui.intent === 'ask' ? 'Importing task' : `Importing ${ui.intent === 'create_plugin' ? 'plugin' : 'app'}`;
        const downloadDetail = ui.intent === 'ask'
          ? 'Installing the task package into your task library.'
          : `Cloning into PINOKIO_HOME/${getIntentDownloadPath(ui.intent)} and preparing the destination folder.`;
        setSubmissionState(ui, {
          title: downloadLabel,
          description: downloadDetail,
          label: downloadLabel,
          detail: downloadDetail,
          confirmLabel: ui.intent === 'ask' ? 'Importing task...' : 'Importing...'
        });

        resetDownloadOutput(ui);
        const prepared = await prepareDownloadClone({
          intent: ui.intent,
          ref: validation.payload.ref,
          name: validation.payload.name,
        });
        if (prepared.existing && prepared.url) {
          window.location.href = prepared.url;
          return;
        }
        await runDownloadClone(ui, prepared.clone);
        const finalized = await finalizeDownloadClone({
          intent: ui.intent,
          ref: prepared.finalize && prepared.finalize.ref ? prepared.finalize.ref : validation.payload.ref,
          name: prepared.finalize && prepared.finalize.name ? prepared.finalize.name : validation.payload.name,
          id: prepared.finalize && prepared.finalize.id ? prepared.finalize.id : '',
        });
        window.location.href = finalized.url;
        return;
      } catch (error) {
        ui.error.textContent = error && error.message ? error.message : 'Failed to continue.';
        clearSubmissionState(ui);
        syncTaskMode(ui);
        syncLauncherMode(ui);
        ui.isSubmitting = false;
        buttons.forEach((button) => {
          button.disabled = false;
        });
        if (ui.downloadSection) {
          ui.downloadSection.setDisabled(false);
        }
        updateSubmitAvailability(ui);
        return;
      }
    }

    const selectedEntry = ui.toolPicker.getSelectedEntry();
    const overrideTaskPayload = options && options.taskPayloadOverride && typeof options.taskPayloadOverride === 'object'
      ? options.taskPayloadOverride
      : null;
    const hasInlineTaskSelection = Boolean(
      ui.askTaskSection
      && ui.askTaskSection.isTaskMode()
    );
    const taskPayload = overrideTaskPayload || (
      ui.intent === 'ask' && hasInlineTaskSelection
        ? ui.askTaskSection.getLaunchPayload()
        : null
    );
    const prompt = hasInlineTaskSelection
      ? ui.askTaskSection.getRenderedPrompt().trim()
      : ui.promptTextarea.value.trim();
    const name = ui.intent === 'ask' ? '' : ui.nameInput.value.trim();
    const files = ui.attachments.getFiles();

    if (!selectedEntry || !selectedEntry.meta || !selectedEntry.meta.value) {
      ui.error.textContent = 'Please select a plugin.';
      ui.toolPicker.openMenu();
      return;
    }
    if (ui.intent !== 'ask' && !name) {
      await runNameValidation(ui, { showEmpty: true });
      ui.error.textContent = 'Please enter a name.';
      ui.nameInput.focus();
      return;
    }
    if (ui.intent !== 'ask') {
      const isNameReady = await runNameValidation(ui, { showEmpty: true });
      if (!isNameReady) {
        ui.error.textContent = ui.nameValidationMessage || 'Please choose a different name.';
        ui.nameInput.focus();
        return;
      }
    }
    if (ui.intent !== 'ask' && name.includes(' ')) {
      ui.error.textContent = 'Names cannot contain spaces.';
      ui.nameInput.focus();
      return;
    }

    const buttons = [ui.cancelButton, ui.confirmButton, ui.closeButton].filter(Boolean);
    const inputs = [ui.promptTextarea, ui.nameInput].filter(Boolean);
    ui.isSubmitting = true;
    updateSubmitAvailability(ui);
    ui.toolPicker.closeMenu();
    buttons.forEach((button) => {
      button.disabled = true;
    });
    inputs.forEach((input) => {
      input.disabled = true;
    });
    ui.toolPicker.setDisabled(true);

    try {
      if (ui.intent === 'create_app') {
        setSubmissionState(ui, {
          title: 'Creating app...',
          description: 'Setting up the new app and preparing the dev page.',
          label: files.length ? 'Uploading files' : 'Preparing app workspace',
          detail: files.length
            ? 'Uploading your files, then creating the app folder and first git commit.'
            : 'Creating the app folder, starter files, and first git commit. This usually takes a few seconds.',
          confirmLabel: 'Working...'
        });
      }

      const uploadToken = await uploadFiles(files);

      if (ui.intent === 'create_app') {
        setSubmissionState(ui, {
          title: 'Creating app...',
          description: 'Setting up the new app and preparing the dev page.',
          label: 'Preparing app workspace',
          detail: 'Creating the app folder, starter files, and first git commit. This usually takes a few seconds.',
          confirmLabel: 'Working...'
        });
        const response = await fetch('/launcher/create-app', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name,
            prompt,
            tool: selectedEntry.meta.value,
            uploadToken,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !payload.ok || !payload.url) {
          throw new Error(payload && payload.error ? payload.error : 'Failed to create app.');
        }
        setSubmissionState(ui, {
          title: 'Opening app...',
          description: 'The app is ready. Opening the dev page now.',
          label: 'Opening dev page',
          detail: 'Redirecting to the new app.',
          confirmLabel: 'Opening...'
        });
        window.location.href = payload.url;
        return;
      }

      if (ui.intent === 'ask' && taskPayload) {
        const response = await fetch('/launcher/prepare-task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: taskPayload.taskId,
            inputs: taskPayload.inputs,
            workspaceMode: taskPayload.workspaceMode,
            workspaceRef: taskPayload.workspaceRef,
            workspaceName: taskPayload.workspaceName,
            tool: selectedEntry.meta.value,
            uploadToken,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !payload.ok || !payload.url) {
          throw new Error(payload && payload.error ? payload.error : 'Failed to prepare task launcher.');
        }
        window.location.href = payload.url;
        return;
      }

      const response = await fetch('/launcher/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: ui.intent,
          name,
          prompt,
          tool: selectedEntry.meta.value,
          uploadToken,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !payload.ok || !payload.url) {
        throw new Error(payload && payload.error ? payload.error : 'Failed to prepare launcher.');
      }
      window.location.href = payload.url;
    } catch (error) {
      ui.error.textContent = error && error.message ? error.message : 'Failed to continue.';
      clearSubmissionState(ui);
      syncTaskMode(ui);
      syncLauncherMode(ui);
      ui.isSubmitting = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      inputs.forEach((input) => {
        input.disabled = false;
      });
      ui.toolPicker.setDisabled(false);
      updateSubmitAvailability(ui);
    }
  }

  function focusPromptTextarea(ui) {
    if (!ui) {
      return;
    }
    if (ui.mode === 'download' && ui.downloadSection && typeof ui.downloadSection.focusPrimaryControl === 'function') {
      if (ui.downloadSection.focusPrimaryControl()) {
        return;
      }
    }
    if (
      ui.askTaskSection
      && typeof ui.askTaskSection.isTaskMode === 'function'
      && ui.askTaskSection.isTaskMode()
      && typeof ui.askTaskSection.focusPrimaryControl === 'function'
      && ui.askTaskSection.focusPrimaryControl()
    ) {
      return;
    }
    if (!ui.promptTextarea || ui.promptTextarea.disabled || ui.promptTextarea.hidden) {
      return;
    }
    const cursorIndex = ui.promptTextarea.value.length;
    ui.promptTextarea.focus();
    try {
      ui.promptTextarea.setSelectionRange(cursorIndex, cursorIndex);
    } catch (_) {}
  }

  function isLauncherTarget(target, ui) {
    return Boolean(ui && ui.overlay && target instanceof Node && ui.overlay.contains(target));
  }

  function canScrollLauncherNode(node, deltaX, deltaY) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(node);
    const overflowY = `${style.overflowY || ''} ${style.overflow || ''}`;
    const overflowX = `${style.overflowX || ''} ${style.overflow || ''}`;
    const wantsVertical = Math.abs(deltaY) >= Math.abs(deltaX);
    const wantsHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

    if (wantsVertical && /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1) {
      const maxScrollTop = node.scrollHeight - node.clientHeight;
      if ((deltaY < 0 && node.scrollTop > 0) || (deltaY > 0 && node.scrollTop < maxScrollTop - 1)) {
        return true;
      }
    }

    if (wantsHorizontal && /(auto|scroll|overlay)/.test(overflowX) && node.scrollWidth > node.clientWidth + 1) {
      const maxScrollLeft = node.scrollWidth - node.clientWidth;
      if ((deltaX < 0 && node.scrollLeft > 0) || (deltaX > 0 && node.scrollLeft < maxScrollLeft - 1)) {
        return true;
      }
    }

    return false;
  }

  function canScrollWithinLauncher(target, ui, deltaX, deltaY) {
    if (!isLauncherTarget(target, ui)) {
      return false;
    }

    let node = target instanceof Element ? target : target && target.parentElement ? target.parentElement : null;
    while (node && node !== ui.overlay) {
      if (canScrollLauncherNode(node, deltaX, deltaY)) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  function setModalState(open, ui) {
    if (open) {
      if (modalOpen) return;
      modalOpen = true;
      previousFocus = document.activeElement;
      if (document.documentElement) {
        document.documentElement.classList.add('universal-launcher-open');
      }
      if (document.body) {
        document.body.classList.add('universal-launcher-open');
      }
      ui.overlay.hidden = false;
      requestAnimationFrame(() => {
        focusPromptTextarea(ui);
      });
      return;
    }
    if (!modalOpen) return;
    modalOpen = false;
    if (document.documentElement) {
      document.documentElement.classList.remove('universal-launcher-open');
    }
    if (document.body) {
      document.body.classList.remove('universal-launcher-open');
    }
    if (ui) {
      ui.overlay.hidden = true;
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (_) {}
    }
    previousFocus = null;
  }

  async function ensureModalReady() {
    if (modalInstance) {
      return modalInstance;
    }
    if (modalPromise) {
      return modalPromise;
    }

    modalPromise = (async () => {
      const [tools, tasks] = await Promise.all([getTools(), getTasks()]);
      const ui = buildUi(tools);
      if (ui.taskBrowser) {
        ui.taskBrowser.setTasks(tasks);
      }
      if (ui.askTaskSection) {
        ui.askTaskSection.setTasks(tasks);
      }
      document.body.appendChild(ui.overlay);

      ui.closeButton.addEventListener('click', () => hideModal());
      ui.cancelButton.addEventListener('click', () => hideModal());
      ui.advancedLink.addEventListener('click', () => hideModal());
      ui.shareLink.addEventListener('click', (event) => {
        event.preventDefault();
        openSaveTemplatePage(ui);
      });
      ui.confirmButton.addEventListener('click', () => {
        submit(ui);
      });
      ui.overlay.addEventListener('click', (event) => {
        if (event.target === ui.overlay) {
          hideModal();
        }
      });
      const stopOverlayKeyEvent = (event) => {
        if (!modalOpen || !isLauncherTarget(event.target, ui)) {
          return;
        }
        event.stopPropagation();
      };
      ui.overlay.addEventListener('keydown', stopOverlayKeyEvent);
      ui.overlay.addEventListener('keypress', stopOverlayKeyEvent);
      ui.overlay.addEventListener('keyup', stopOverlayKeyEvent);
      ui.overlay.addEventListener('wheel', (event) => {
        if (!modalOpen || !isLauncherTarget(event.target, ui)) {
          return;
        }
        event.stopPropagation();
        if (!ui.panel.contains(event.target) || !canScrollWithinLauncher(event.target, ui, event.deltaX || 0, event.deltaY || 0)) {
          event.preventDefault();
        }
      }, { passive: false });
      document.addEventListener('focusin', (event) => {
        if (!modalOpen || !modalInstance || modalInstance !== ui) {
          return;
        }
        if (isLauncherTarget(event.target, ui)) {
          return;
        }
        requestAnimationFrame(() => {
          if (!modalOpen || !modalInstance || modalInstance !== ui) {
            return;
          }
          focusPromptTextarea(ui);
        });
      }, true);

      modalInstance = ui;
      modalPromise = null;
      return ui;
    })();

    return modalPromise;
  }

  async function showModal(defaults) {
    const ui = await ensureModalReady();
    if (ui.taskBrowser) {
      const tasks = await getTasks();
      ui.taskBrowser.setTasks(tasks);
      if (ui.askTaskSection) {
        ui.askTaskSection.setTasks(tasks);
      }
    }
    applyDefaults(ui, defaults);
    setModalState(true, ui);

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
    }
    keydownHandler = (event) => {
      if (event.key === 'Escape') {
        if (ui.taskBrowser && ui.taskBrowser.isOpen()) {
          event.preventDefault();
          ui.taskBrowser.close();
          return;
        }
        if (ui.toolPicker && ui.toolPicker.isOpen()) {
          event.preventDefault();
          ui.toolPicker.closeMenu();
          return;
        }
        event.preventDefault();
        hideModal();
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit(ui);
      }
    };
    document.addEventListener('keydown', keydownHandler, true);
  }

  function hideModal() {
    if (!modalInstance) {
      return;
    }
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
    if (modalInstance.taskBrowser) {
      modalInstance.taskBrowser.close();
    }
    if (modalInstance.toolPicker) {
      modalInstance.toolPicker.closeMenu();
    }
    setModalState(false, modalInstance);
  }

  window.UniversalLauncher = {
    showModal,
    hideModal,
    ensureModalReady,
    generateNameSuggestion,
  };

  try {
    window.dispatchEvent(new CustomEvent('UniversalLauncherReady'));
  } catch (_) {
  }
})(window, document);
