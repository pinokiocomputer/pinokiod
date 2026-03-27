(function(window, document) {
  'use strict';

  if (window.UniversalLauncher) {
    return;
  }

  const CATEGORY_ORDER = ['CLI', 'IDE'];
  const TOOL_PREFERENCE_KEY = 'pinokio.universalLauncher.tool';
  const ATTACHMENTS_ENABLED = false;
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
      advancedLabel: 'Or, try advanced options',
      advancedHref: '/init',
    },
    ask: {
      label: 'Task',
      title: 'Task',
      description: 'Ask Pinokio anything. Pinokio can work with tools and agents to answer questions and get things done.',
      usesName: false,
      targetLabel: '',
      promptLabel: 'What should Pinokio do?',
      promptPlaceholder: 'Examples: "Would llama.cpp work on my machine?", "What is using the most memory right now?", "Generate a video of a cat.", "Is https://github.com/foo/bar safe to install?", "What is broken in https://github.com/foo/bar?"',
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

  function getIntentTaskPath(intent) {
    const normalizedIntent = normalizeIntent(intent);
    if (normalizedIntent === 'create_app') return 'api';
    if (normalizedIntent === 'create_plugin') return 'plugin';
    return 'workspaces';
  }

  function openTaskTemplateBuilder(defaults) {
    const options = defaults && typeof defaults === 'object' ? defaults : {};
    const url = new URL('/tasks/new', window.location.origin);
    const taskPath = typeof options.path === 'string' && options.path.trim()
      ? options.path.trim()
      : 'workspaces';
    const template = typeof options.template === 'string'
      ? options.template.trim()
      : '';
    const title = typeof options.title === 'string'
      ? options.title.trim()
      : '';
    url.searchParams.set('path', taskPath);
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
    ui.shareLink.href = '#';
    ui.shareLink.dataset.mode = 'template';
    ui.shareLink.textContent = 'Save as template';
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
      return `[${getTaskInputDisplayLabel(name, inputs)}]`;
    });
  }

  function formatTaskTemplateSummary(task) {
    const preview = renderTaskTemplatePreview(
      task && (task.template || task.description || ''),
      {},
      task && Array.isArray(task.inputs) ? task.inputs : []
    ).trim();
    if (!preview) {
      return 'Saved prompt';
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
      } else {
        triggerLabel.textContent = 'Choose a plugin';
        triggerMeta.textContent = 'Required before continuing';
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
    toggle.innerHTML = '<i class="fa-solid fa-bookmark" aria-hidden="true"></i><span>Saved prompts</span>';

    const layer = document.createElement('div');
    layer.className = 'universal-launcher-template-layer';
    layer.hidden = true;
    hostPanel.appendChild(layer);

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'universal-launcher-template-backdrop';
    backdrop.setAttribute('aria-label', 'Close saved prompts');
    layer.appendChild(backdrop);

    const modal = document.createElement('section');
    modal.className = 'universal-launcher-template-modal';
    modal.setAttribute('aria-label', 'Saved prompts');
    layer.appendChild(modal);

    const modalHeader = document.createElement('div');
    modalHeader.className = 'universal-launcher-template-modal-header';
    modal.appendChild(modalHeader);

    const modalHeading = document.createElement('div');
    modalHeading.className = 'universal-launcher-template-modal-heading';
    modalHeader.appendChild(modalHeading);

    const modalTitle = document.createElement('div');
    modalTitle.className = 'universal-launcher-template-modal-title';
    modalTitle.textContent = 'Saved prompts';
    modalHeading.appendChild(modalTitle);

    const modalDescription = document.createElement('div');
    modalDescription.className = 'universal-launcher-template-modal-description';
    modalDescription.textContent = 'Choose a saved prompt or create a new one.';
    modalHeading.appendChild(modalDescription);

    const headerActions = document.createElement('div');
    headerActions.className = 'universal-launcher-template-modal-header-actions';
    modalHeader.appendChild(headerActions);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'universal-launcher-template-create';
    createButton.textContent = 'Create prompt';
    headerActions.appendChild(createButton);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'universal-launcher-template-modal-close';
    closeButton.setAttribute('aria-label', 'Close saved prompts');
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
    search.placeholder = 'Search saved prompts';
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
    chooserEmptyAction.textContent = 'Create prompt';
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
    backButton.textContent = 'Back to saved prompts';
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
    useButton.textContent = 'Insert prompt';
    footerActions.appendChild(useButton);

    const state = {
      allTasks: [],
      currentPath: 'workspaces',
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
        if (!task || task.path !== state.currentPath) {
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
    }

    function open() {
      state.open = true;
      layer.hidden = false;
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
      const hasAvailableTasks = state.allTasks.some((task) => task && task.path === state.currentPath);
      const showingDetails = Boolean(selectedTask);
      const hasVisibleTasks = visibleTasks.length > 0;
      toggle.disabled = false;
      toggle.hidden = !hasAvailableTasks;
      toggle.setAttribute('aria-hidden', hasAvailableTasks ? 'false' : 'true');
      modalTitle.textContent = showingDetails && selectedTask ? (selectedTask.title || selectedTask.id) : 'Saved prompts';
      modalDescription.textContent = showingDetails
        ? 'Fill the fields below, then insert the generated prompt into Task.'
        : 'Choose a saved prompt or create a new one.';

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
        meta.textContent = metaBits.join(' · ') || 'Saved prompt';
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
        chooserEmptyText.textContent = 'No saved prompts yet. Create one to reuse it here.';
        chooserEmptyAction.hidden = false;
      } else if (!hasVisibleTasks) {
        chooserEmptyText.textContent = 'No saved prompts match this search.';
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
          : `No saved prompts for PINOKIO_HOME/${state.currentPath} yet.`;
        footerNote.hidden = !footerNote.textContent;
        return;
      }

      emptyState.hidden = true;
      detailsTitle.textContent = '';
      detailsTitle.hidden = true;
      detailsDescription.textContent = Array.isArray(selectedTask.inputs) && selectedTask.inputs.length > 0
        ? `Fill ${selectedTask.inputs.length === 1 ? 'the field' : 'the fields'} below to build the prompt.`
        : 'This template is ready to turn into a prompt.';

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
        if (selectedTask && selectedTask.path !== state.currentPath) {
          state.selectedTaskId = '';
        }
        render();
      },
      setPath(taskPath) {
        state.currentPath = taskPath || 'workspaces';
        const selectedTask = getSelectedTask();
        if (selectedTask && selectedTask.path !== state.currentPath) {
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

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'universal-launcher-primary-grid';
    body.appendChild(primaryGrid);

    const secondaryGrid = document.createElement('div');
    secondaryGrid.className = 'universal-launcher-secondary-grid';
    body.appendChild(secondaryGrid);

    const taskBrowser = buildTaskTemplateSection(panel);

    const promptSection = document.createElement('section');
    promptSection.className = 'universal-launcher-section universal-launcher-section-prompt';
    primaryGrid.appendChild(promptSection);

    const { heading: promptHeading, title: promptTitle } = buildSectionHeading('What do you want to do?');
    promptHeading.classList.add('universal-launcher-section-heading-with-action');
    promptHeading.appendChild(taskBrowser.toggle);
    promptSection.appendChild(promptHeading);

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'universal-launcher-textarea';
    promptTextarea.rows = 5;
    promptSection.appendChild(promptTextarea);

    const nameSection = document.createElement('section');
    nameSection.className = 'universal-launcher-section universal-launcher-section-name';
    primaryGrid.appendChild(nameSection);

    const { heading: nameHeading, note: nameMeta } = buildSectionHeading('Name', '');
    nameSection.appendChild(nameHeading);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'universal-launcher-input';
    nameInput.placeholder = 'example: my-project';
    nameSection.appendChild(nameInput);

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

    const footer = document.createElement('footer');
    footer.className = 'universal-launcher-footer';
    panel.appendChild(footer);

    const footerLinks = document.createElement('div');
    footerLinks.className = 'universal-launcher-footer-links';
    footer.appendChild(footerLinks);

    const advancedLink = document.createElement('a');
    advancedLink.className = 'universal-launcher-advanced-link';
    advancedLink.hidden = true;
    footerLinks.appendChild(advancedLink);

    const shareLink = document.createElement('a');
    shareLink.className = 'universal-launcher-share-link';
    shareLink.href = '#';
    shareLink.textContent = 'Save as template';
    footerLinks.appendChild(shareLink);

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
      status,
      statusLabel: status.querySelector('.universal-launcher-status-label'),
      statusDetail: status.querySelector('.universal-launcher-status-detail'),
      closeButton,
      intentWrap,
      intentButtons,
      taskBrowser,
      promptSection,
      promptTextarea,
      promptTitle,
      nameSection,
      nameInput,
      nameMeta,
      attachments,
      toolPicker,
      error,
      footerLinks,
      advancedLink,
      shareLink,
      cancelButton,
      confirmButton,
      intent: 'create_app',
      nameEdited: false,
      isSubmitting: false,
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
        const showName = intentUsesName(intent);
        this.nameMeta.textContent = intentConfig.targetLabel;
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
        if (this.advancedLink) {
          const hasAdvancedLink = Boolean(intentConfig.advancedHref && intentConfig.advancedLabel);
          this.advancedLink.hidden = !hasAdvancedLink;
          this.advancedLink.setAttribute('aria-hidden', hasAdvancedLink ? 'false' : 'true');
          if (hasAdvancedLink) {
            this.advancedLink.href = intentConfig.advancedHref;
            this.advancedLink.textContent = intentConfig.advancedLabel;
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
        if (!showName) {
          this.nameInput.value = '';
        } else if (!this.nameEdited) {
          this.nameInput.value = generateNameSuggestion(
            getPromptForNameSuggestion(intent, this.promptTextarea.value)
          );
        }
        if (this.taskBrowser) {
          this.taskBrowser.setPath(getIntentTaskPath(intent));
        }
        syncShareLink(this);
        syncTaskMode(this);
        updateSubmitAvailability(this);
      },
    };

    nameInput.addEventListener('input', () => {
      ui.nameEdited = true;
      syncShareLink(ui);
    });

    promptTextarea.addEventListener('input', () => {
      ui.promptDrafts[ui.intent] = promptTextarea.value;
      if (!intentUsesName(ui.intent)) {
        ui.nameInput.value = '';
      } else if (!ui.nameEdited) {
        ui.nameInput.value = generateNameSuggestion(
          getPromptForNameSuggestion(ui.intent, promptTextarea.value)
        );
      }
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

    toolPicker.onChange = () => {
      syncShareLink(ui);
      updateSubmitAvailability(ui);
    };
    taskBrowser.setCreateDefaultsResolver(() => {
      const prompt = getPromptForNameSuggestion(ui.intent, ui.promptTextarea.value || '').trim();
      return {
        path: getIntentTaskPath(ui.intent),
        template: prompt,
      };
    });
    taskBrowser.onCommit = ({ prompt }) => {
      ui.promptTextarea.value = prompt;
      ui.promptDrafts[ui.intent] = prompt;
      if (!intentUsesName(ui.intent)) {
        ui.nameInput.value = '';
      } else if (!ui.nameEdited) {
        ui.nameInput.value = generateNameSuggestion(
          getPromptForNameSuggestion(ui.intent, prompt)
        );
      }
      syncShareLink(ui);
      requestAnimationFrame(() => {
        focusPromptTextarea(ui);
      });
    };

    ui.setIntent('create_app');
    syncShareLink(ui);
    syncTaskMode(ui);
    updateSubmitAvailability(ui);

    return ui;
  }

  function syncTaskMode(ui) {
    if (!ui) {
      return;
    }
    const intentConfig = INTENTS[normalizeIntent(ui.intent)];

    if (ui.promptSection && ui.promptTextarea) {
      ui.promptSection.hidden = false;
      ui.promptSection.setAttribute('aria-hidden', 'false');
      ui.promptTextarea.readOnly = false;
      ui.promptTextarea.removeAttribute('aria-readonly');
      ui.promptTextarea.classList.remove('is-readonly');
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
      ui.confirmButton.textContent = intentConfig.confirmLabel;
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
    if (!ui || !ui.confirmButton || !ui.toolPicker) {
      return;
    }
    const hasTool = Boolean(ui.toolPicker.getSelectedEntry());
    ui.confirmButton.disabled = ui.isSubmitting || !hasTool;
  }

  function openSaveTemplatePage(ui) {
    if (!ui) return;
    const prompt = ui.promptTextarea ? ui.promptTextarea.value : '';
    const name = ui.intent !== 'ask' && ui.nameInput ? ui.nameInput.value.trim() : '';
    openTaskTemplateBuilder({
      path: getIntentTaskPath(ui.intent),
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
    ui.attachments.clear();
    ui.isSubmitting = false;
    clearSubmissionState(ui);
    if (ui.taskBrowser) {
      ui.taskBrowser.reset();
    }
    if (ui.intentWrap) {
      ui.intentWrap.hidden = hasPresetIntent;
      ui.intentWrap.setAttribute('aria-hidden', hasPresetIntent ? 'true' : 'false');
    }
    ui.setIntent(type);
    if (name) {
      ui.nameInput.value = name;
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
    updateSubmitAvailability(ui);
  }

  async function submit(ui) {
    if (!ui) return;
    ui.error.textContent = '';

    const selectedEntry = ui.toolPicker.getSelectedEntry();
    const prompt = ui.promptTextarea.value.trim();
    const name = ui.intent === 'ask' ? '' : ui.nameInput.value.trim();
    const files = ui.attachments.getFiles();

    if (!selectedEntry || !selectedEntry.meta || !selectedEntry.meta.value) {
      ui.error.textContent = 'Please select a plugin.';
      ui.toolPicker.openMenu();
      return;
    }
    if (ui.intent !== 'ask' && !name) {
      ui.error.textContent = 'Please enter a name.';
      ui.nameInput.focus();
      return;
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
