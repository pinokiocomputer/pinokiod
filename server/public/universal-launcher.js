(function(window, document) {
  'use strict';

  if (window.UniversalLauncher) {
    return;
  }

  const CATEGORY_ORDER = ['CLI', 'IDE'];
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
      title: 'Create',
      description: 'Create a reusable Pinokio app.',
      targetLabel: 'Creates in PINOKIO_HOME/api',
      promptPlaceholder: 'Examples: "a 1-click launcher for ComfyUI", "I want to clone a website to run locally", "convert files from one format to another".',
      confirmLabel: 'Create',
    },
    ask: {
      label: 'Ask',
      title: 'Ask',
      description: 'Create a workspace and open it with the selected tool.',
      targetLabel: 'Creates in PINOKIO_HOME/workspaces',
      promptPlaceholder: 'Examples: "Is this app safe to install?", "Audit this codebase", "Fix this build error", "Explain how this project works".',
      confirmLabel: 'Start',
    },
    create_plugin: {
      label: 'Create plugin',
      title: 'Create',
      description: 'Create a new Pinokio plugin folder and open it with the selected tool.',
      targetLabel: 'Creates in PINOKIO_HOME/plugin',
      promptPlaceholder: 'Describe the Pinokio plugin you want to build.',
      promptSeed: 'A Pinokio plugin for: ',
      confirmLabel: 'Create',
    },
  };

  let cachedTools = null;
  let loadingTools = null;
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

  function getIntentPromptSeed(intent) {
    const intentConfig = INTENTS[normalizeIntent(intent)];
    return intentConfig && typeof intentConfig.promptSeed === 'string' ? intentConfig.promptSeed : '';
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

      let value = href.replace(/^\/run\/plugin\//, '').replace(/^\/+/, '');
      if (value.endsWith('/pinokio.js')) {
        value = value.replace(/\/pinokio\.js$/i, '');
      }
      if (!value) return null;

      const runs = Array.isArray(plugin.run) ? plugin.run : [];
      const hasExec = runs.some((step) => step && step.method === 'exec');

      return {
        value,
        label: plugin.title || plugin.text || plugin.name || value,
        iconSrc: plugin.image || null,
        isDefault: plugin.default === true,
        category: hasExec ? 'IDE' : 'CLI',
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

  function updateToolSelections(entries) {
    entries.forEach((entry) => {
      entry.container.classList.toggle('selected', Boolean(entry.input.checked));
    });
  }

  function buildToolOptions(tools) {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section';

    const title = document.createElement('div');
    title.className = 'universal-launcher-section-title';
    title.textContent = 'Select plugin';
    section.appendChild(title);

    const optionGroups = document.createElement('div');
    optionGroups.className = 'universal-launcher-tool-groups';
    section.appendChild(optionGroups);

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
    const defaultIndex = tools.findIndex((tool) => tool.isDefault);
    const fallbackIndex = defaultIndex >= 0 ? defaultIndex : 0;

    orderedGroups.forEach(([category, entries]) => {
      const group = document.createElement('div');
      group.className = 'universal-launcher-tool-group';

      const heading = document.createElement('div');
      heading.className = 'universal-launcher-tool-group-title';
      heading.textContent = category;
      group.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'universal-launcher-tool-list';
      group.appendChild(list);

      entries.slice().sort((a, b) => {
        const nameA = String(a.tool && a.tool.label ? a.tool.label : '').toLowerCase();
        const nameB = String(b.tool && b.tool.label ? b.tool.label : '').toLowerCase();
        return nameA.localeCompare(nameB);
      }).forEach(({ tool, index }) => {
        const option = document.createElement('label');
        option.className = 'universal-launcher-tool';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'universal-launcher-tool';
        radio.value = tool.value;
        radio.checked = index === fallbackIndex;

        const indicator = document.createElement('span');
        indicator.className = 'universal-launcher-tool-indicator';
        indicator.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'universal-launcher-tool-label';
        text.textContent = tool.label;

        option.appendChild(radio);
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

        const entry = { input: radio, container: option, meta: tool };
        toolEntries.push(entry);
        radio.addEventListener('change', () => updateToolSelections(toolEntries));
      });

      optionGroups.appendChild(group);
    });

    updateToolSelections(toolEntries);

    return { section, toolEntries };
  }

  function buildAttachmentSection() {
    const section = document.createElement('section');
    section.className = 'universal-launcher-section universal-launcher-upload';

    const title = document.createElement('div');
    title.className = 'universal-launcher-section-title';
    title.textContent = 'Attach files';
    section.appendChild(title);

    const note = document.createElement('div');
    note.className = 'universal-launcher-section-note';
    note.textContent = 'Optional';
    section.appendChild(note);

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

    const title = document.createElement('h3');
    title.className = 'universal-launcher-title';
    title.id = 'universal-launcher-title';
    heading.appendChild(title);

    const description = document.createElement('p');
    description.className = 'universal-launcher-description';
    heading.appendChild(description);

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

    const promptSection = document.createElement('section');
    promptSection.className = 'universal-launcher-section';
    body.appendChild(promptSection);

    const promptTitle = document.createElement('div');
    promptTitle.className = 'universal-launcher-section-title';
    promptTitle.textContent = 'What do you want to do?';
    promptSection.appendChild(promptTitle);

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'universal-launcher-textarea';
    promptTextarea.rows = 6;
    promptSection.appendChild(promptTextarea);

    const nameSection = document.createElement('section');
    nameSection.className = 'universal-launcher-section';
    body.appendChild(nameSection);

    const nameTitle = document.createElement('div');
    nameTitle.className = 'universal-launcher-section-title';
    nameTitle.textContent = 'Name';
    nameSection.appendChild(nameTitle);

    const nameMeta = document.createElement('div');
    nameMeta.className = 'universal-launcher-section-note';
    nameSection.appendChild(nameMeta);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'universal-launcher-input';
    nameInput.placeholder = 'example: my-project';
    nameSection.appendChild(nameInput);

    const attachments = buildAttachmentSection();
    body.appendChild(attachments.section);

    const { section: toolSection, toolEntries } = buildToolOptions(tools);
    body.appendChild(toolSection);

    const error = document.createElement('div');
    error.className = 'universal-launcher-error';
    body.appendChild(error);

    const footer = document.createElement('footer');
    footer.className = 'universal-launcher-footer';
    panel.appendChild(footer);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'universal-launcher-button universal-launcher-button-secondary';
    cancelButton.textContent = 'Cancel';
    footer.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'universal-launcher-button universal-launcher-button-primary';
    footer.appendChild(confirmButton);

    const ui = {
      overlay,
      panel,
      title,
      description,
      closeButton,
      intentButtons,
      promptTextarea,
      nameInput,
      nameMeta,
      attachments,
      toolEntries,
      error,
      cancelButton,
      confirmButton,
      intent: 'create_app',
      nameEdited: false,
      promptDrafts: {
        create_app: '',
        ask: '',
        create_plugin: '',
      },
      setIntent(nextIntent) {
        const intent = normalizeIntent(nextIntent);
        const currentIntent = normalizeIntent(this.intent);
        if (Object.prototype.hasOwnProperty.call(this.promptDrafts, currentIntent)) {
          this.promptDrafts[currentIntent] = this.promptTextarea.value;
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
        this.nameMeta.textContent = intentConfig.targetLabel;
        this.promptTextarea.placeholder = intentConfig.promptPlaceholder;
        this.confirmButton.textContent = intentConfig.confirmLabel;
        this.intentButtons.forEach((button) => {
          const active = button.dataset.intent === intent;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (!this.nameEdited) {
          this.nameInput.value = generateNameSuggestion(
            getPromptForNameSuggestion(intent, this.promptTextarea.value)
          );
        }
      },
    };

    nameInput.addEventListener('input', () => {
      ui.nameEdited = true;
    });

    promptTextarea.addEventListener('input', () => {
      ui.promptDrafts[ui.intent] = promptTextarea.value;
      if (!ui.nameEdited) {
        ui.nameInput.value = generateNameSuggestion(
          getPromptForNameSuggestion(ui.intent, promptTextarea.value)
        );
      }
    });

    intentButtons.forEach((button) => {
      button.addEventListener('click', () => {
        ui.setIntent(button.dataset.intent);
        requestAnimationFrame(() => {
          focusPromptTextarea(ui);
        });
      });
    });

    ui.setIntent('create_app');

    return ui;
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
    ui.attachments.clear();
    ui.setIntent(type);
    if (name) {
      ui.nameInput.value = name;
    }

    if (tool) {
      let matched = false;
      ui.toolEntries.forEach((entry) => {
        const isMatch = entry.input.value === tool;
        entry.input.checked = isMatch;
        matched = matched || isMatch;
      });
      if (!matched && ui.toolEntries.length > 0) {
        const defaultIndex = ui.toolEntries.findIndex((entry) => entry.meta && entry.meta.isDefault);
        ui.toolEntries.forEach((entry, index) => {
          entry.input.checked = index === (defaultIndex >= 0 ? defaultIndex : 0);
        });
      }
      updateToolSelections(ui.toolEntries);
    } else {
      updateToolSelections(ui.toolEntries);
    }
  }

  async function submit(ui) {
    if (!ui) return;
    ui.error.textContent = '';

    const selectedEntry = ui.toolEntries.find((entry) => entry.input.checked) || ui.toolEntries[0];
    const prompt = ui.promptTextarea.value.trim();
    const name = ui.nameInput.value.trim();
    const files = ui.attachments.getFiles();

    if (!selectedEntry || !selectedEntry.input || !selectedEntry.input.value) {
      ui.error.textContent = 'Please select a plugin.';
      return;
    }
    if (!name) {
      ui.error.textContent = 'Please enter a name.';
      ui.nameInput.focus();
      return;
    }
    if (name.includes(' ')) {
      ui.error.textContent = 'Names cannot contain spaces.';
      ui.nameInput.focus();
      return;
    }

    const buttons = [ui.cancelButton, ui.confirmButton, ui.closeButton].filter(Boolean);
    const inputs = [ui.promptTextarea, ui.nameInput].filter(Boolean);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    inputs.forEach((input) => {
      input.disabled = true;
    });
    ui.toolEntries.forEach((entry) => {
      entry.input.disabled = true;
    });

    try {
      const uploadToken = await uploadFiles(files);

      if (ui.intent === 'create_app') {
        const params = new URLSearchParams();
        params.set('name', name);
        if (prompt) {
          params.set('message', prompt);
        }
        params.set('tool', selectedEntry.input.value);
        if (uploadToken) {
          params.set('uploadToken', uploadToken);
        }
        window.location.href = `/pro?${params.toString()}`;
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
          tool: selectedEntry.input.value,
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
      buttons.forEach((button) => {
        button.disabled = false;
      });
      inputs.forEach((input) => {
        input.disabled = false;
      });
      ui.toolEntries.forEach((entry) => {
        entry.input.disabled = false;
      });
    }
  }

  function focusPromptTextarea(ui) {
    if (!ui || !ui.promptTextarea || ui.promptTextarea.disabled) {
      return;
    }
    const cursorIndex = ui.promptTextarea.value.length;
    ui.promptTextarea.focus();
    try {
      ui.promptTextarea.setSelectionRange(cursorIndex, cursorIndex);
    } catch (_) {}
  }

  function setModalState(open, ui) {
    if (open) {
      if (modalOpen) return;
      modalOpen = true;
      previousFocus = document.activeElement;
      ui.overlay.hidden = false;
      requestAnimationFrame(() => {
        focusPromptTextarea(ui);
      });
      return;
    }
    if (!modalOpen) return;
    modalOpen = false;
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
      const tools = await getTools();
      const ui = buildUi(tools);
      document.body.appendChild(ui.overlay);

      ui.closeButton.addEventListener('click', () => hideModal());
      ui.cancelButton.addEventListener('click', () => hideModal());
      ui.confirmButton.addEventListener('click', () => {
        submit(ui);
      });
      ui.overlay.addEventListener('click', (event) => {
        if (event.target === ui.overlay) {
          hideModal();
        }
      });

      modalInstance = ui;
      modalPromise = null;
      return ui;
    })();

    return modalPromise;
  }

  async function showModal(defaults) {
    const ui = await ensureModalReady();
    applyDefaults(ui, defaults);
    setModalState(true, ui);

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler, true);
    }
    keydownHandler = (event) => {
      if (event.key === 'Escape') {
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
