(function(window, document) {
  'use strict';

  if (window.CreateLauncher) {
    return;
  }

  const FALLBACK_TOOLS = [
    {
      value: 'claude',
      label: 'Claude Code',
      iconSrc: '/asset/plugin/code/claude/claude.png',
      isDefault: true,
      href: '/run/plugin/code/claude/pinokio.js',
      category: 'CLI',
    },
    {
      value: 'codex',
      label: 'OpenAI Codex',
      iconSrc: '/asset/plugin/code/codex/openai.webp',
      isDefault: false,
      href: '/run/plugin/code/codex/pinokio.js',
      category: 'CLI',
    },
    {
      value: 'gemini',
      label: 'Google Gemini CLI',
      iconSrc: '/asset/plugin/code/gemini/gemini.jpeg',
      isDefault: false,
      href: '/run/plugin/code/gemini/pinokio.js',
      category: 'CLI',
    },
  ];

  const CATEGORY_ORDER = ['CLI', 'IDE'];
  const MODAL_VARIANTS = {
    CREATE: 'create',
    ASK: 'ask',
  };
  const CREATE_PROMPT_PLACEHOLDER = 'Examples: "a 1-click launcher for ComfyUI", "I want to change file format", "I want to clone a website to run locally", etc. (Leave empty to decide later)';
  const ASK_PROMPT_PLACEHOLDER = 'Examples: "Fix it", "Can you make this dark theme?", "What does this do?", "How does X feature work?", "What should i do to X".';
  const CREATE_DESCRIPTION = 'Create a reusable and shareable launcher for any task or any app';
  const ASK_DESCRIPTION = 'Ask the AI to customize, fix, or explain how the app works.';

  let cachedTools = null;
  let loadingTools = null;
  let modalInstance = null;
  let modalPromise = null;
  let modalKeydownHandler = null;
  let modalOpen = false;
  let modalPrevFocus = null;
  let modalPrevInert = null;

  function mapPluginMenuToCreateLauncherTools(menu) {
    if (!Array.isArray(menu)) return [];

    return menu
      .map((plugin) => {
        if (!plugin || (!plugin.href && !plugin.link)) {
          return null;
        }
        const href = typeof plugin.href === 'string' ? plugin.href.trim() : '';
        const label = plugin.title || plugin.text || plugin.name || href || '';

        let value = '';
        if (href) {
          // Normalize href to a plugin-relative path for the backend (e.g., code/codex)
          const normalized = href.replace(/^\/run/, '').replace(/^\/+/, '');
          const parts = normalized.split('/').filter(Boolean);
          // Expect /plugin/<path...>/pinokio.js -> want <path...>
          if (parts[0] === 'plugin' && parts.length >= 3) {
            value = parts.slice(1, -1).join('/');
          } else {
            value = normalized;
          }
          if (value.endsWith('/pinokio.js')) {
            value = value.replace(/\/pinokio\.js$/i, '');
          }
        }
        if (!value && label) {
          value = label
            .toLowerCase()
            .replace(/[^a-z0-9/]+/g, '-')
            .replace(/^-+|-+$/g, '');
        }
        if (!value && typeof plugin.link === 'string') {
          value = plugin.link.trim();
        }
        if (!value) {
          return null;
        }
        const iconSrc = plugin.image || null;
        const runs = Array.isArray(plugin.run) ? plugin.run : [];
        const hasExec = runs.some((step) => step && step.method === 'exec');
        const category = hasExec ? 'IDE' : 'CLI';
        return {
          value,
          label,
          iconSrc,
          isDefault: Boolean(plugin.default === true),
          href: href || null,
          category,
        };
      })
      .filter(Boolean);
  }

  async function getCreateLauncherTools() {
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
      .then((data) => {
        const menu = data && Array.isArray(data.menu) ? data.menu : [];
        const tools = mapPluginMenuToCreateLauncherTools(menu);
        return tools.length > 0 ? tools : FALLBACK_TOOLS.slice();
      })
      .catch((error) => {
        console.warn('Falling back to default agents for create launcher modal', error);
        return FALLBACK_TOOLS.slice();
      })
      .finally(() => {
        loadingTools = null;
      });

    const tools = await loadingTools;
    cachedTools = tools;
    return tools;
  }

  function generateFolderSuggestion(prompt) {
    if (!prompt) return '';
    return prompt
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  function updateToolSelections(entries) {
    entries.forEach(({ input, container }) => {
      if (input.checked) {
        container.classList.add('selected');
      } else {
        container.classList.remove('selected');
      }
    });
  }

  function extractTemplateVariableNames(template) {
    const regex = /{{\s*([a-zA-Z0-9_][a-zA-Z0-9_\-.]*)\s*}}/g;
    const names = new Set();
    if (!template) return [];
    let match;
    while ((match = regex.exec(template)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyTemplateValues(template, values) {
    if (!template) return '';
    let result = template;
    values.forEach((value, name) => {
      const pattern = new RegExp(`{{\\s*${escapeRegExp(name)}\\s*}}`, 'g');
      result = result.replace(pattern, value);
    });
    return result;
  }

  function buildToolOptions(tools) {
    const wrapper = document.createElement('div');
    wrapper.className = 'create-launcher-modal-tools';

    const title = document.createElement('div');
    title.className = 'create-launcher-modal-tools-title';
    title.textContent = 'Select Agent';

    const options = document.createElement('div');
    options.className = 'create-launcher-modal-tools-options';

    const toolEntries = [];
    const defaultToolIndex = tools.findIndex((tool) => tool.isDefault);
    const fallbackIndex = defaultToolIndex >= 0 ? defaultToolIndex : (tools.length > 0 ? 0 : -1);

    const grouped = tools.reduce((acc, tool, index) => {
      const category = tool.category || 'CLI';
      if (!acc.has(category)) {
        acc.set(category, []);
      }
      acc.get(category).push({ tool, index });
      return acc;
    }, new Map());

    const orderedGroups = [];
    CATEGORY_ORDER.forEach((category) => {
      if (grouped.has(category)) {
        orderedGroups.push([category, grouped.get(category)]);
        grouped.delete(category);
      }
    });
    grouped.forEach((value, key) => {
      orderedGroups.push([key, value]);
    });

    orderedGroups.forEach(([category, entries]) => {
      const group = document.createElement('div');
      group.className = 'create-launcher-modal-tools-group';

      const heading = document.createElement('div');
      heading.className = 'create-launcher-modal-tools-group-title';
      heading.textContent = category;
      group.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'create-launcher-modal-tools-group-options';

      const sortedEntries = entries.slice().sort((a, b) => {
        const nameA = (a.tool && a.tool.label ? a.tool.label : '').toLowerCase();
        const nameB = (b.tool && b.tool.label ? b.tool.label : '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });

      sortedEntries.forEach(({ tool, index }) => {
        const option = document.createElement('label');
        option.className = 'create-launcher-modal-tool';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'create-launcher-tool';
        radio.value = tool.value;
        radio.dataset.agentLabel = tool.label;
        radio.dataset.agentCategory = category;
        if (tool.href) {
          radio.dataset.agentHref = tool.href;
        }
        if (index === fallbackIndex) {
          radio.checked = true;
        }

        const badge = document.createElement('span');
        badge.className = 'create-launcher-modal-tool-label';
        badge.textContent = tool.label;

        option.appendChild(radio);
        if (tool.iconSrc) {
          const icon = document.createElement('img');
          icon.className = 'create-launcher-modal-tool-icon';
          icon.src = tool.iconSrc;
          icon.alt = `${tool.label} icon`;
          icon.onerror = () => { icon.style.display = 'none'; };
          option.appendChild(icon);
        }
        option.appendChild(badge);
        list.appendChild(option);

        const entry = { input: radio, container: option, meta: tool };
        toolEntries.push(entry);
        radio.addEventListener('change', () => updateToolSelections(toolEntries));
      });

      group.appendChild(list);
      options.appendChild(group);
    });

    if (!toolEntries.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'create-launcher-modal-tools-empty';
      emptyState.textContent = 'No agents available.';
      options.appendChild(emptyState);
    }

    wrapper.appendChild(title);
    wrapper.appendChild(options);

    return { wrapper, toolEntries };
  }

  function createTemplateManager(templateWrapper, templateFields) {
    let templateValues = new Map();

    function syncTemplateFields(promptText, defaults = {}) {
      const variableNames = extractTemplateVariableNames(promptText);
      const previousValues = templateValues;
      const newValues = new Map();

      variableNames.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(defaults, name) && defaults[name] !== undefined) {
          newValues.set(name, defaults[name]);
        } else if (previousValues.has(name)) {
          newValues.set(name, previousValues.get(name));
        } else {
          newValues.set(name, '');
        }
      });

      templateValues = newValues;
      templateFields.innerHTML = '';

      if (variableNames.length === 0) {
        templateWrapper.style.display = 'none';
        return;
      }

      templateWrapper.style.display = 'flex';

      variableNames.forEach((name) => {
        const field = document.createElement('label');
        field.className = 'create-launcher-modal-template-field';

        const labelText = document.createElement('span');
        labelText.className = 'create-launcher-modal-template-field-label';
        labelText.textContent = name;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'create-launcher-modal-template-input';
        input.placeholder = `Enter ${name}`;
        input.value = templateValues.get(name) || '';
        input.dataset.templateInput = name;
        input.addEventListener('input', () => {
          templateValues.set(name, input.value);
        });

        field.appendChild(labelText);
        field.appendChild(input);
        templateFields.appendChild(field);
      });
    }

    function getTemplateValues() {
      return new Map(templateValues);
    }

    function setTemplateValues(values = {}) {
      if (!values || typeof values !== 'object') {
        return;
      }
      templateValues.forEach((_, key) => {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          templateValues.set(key, values[key]);
          const input = templateFields.querySelector(`[data-template-input="${key}"]`);
          if (input) {
            input.value = values[key];
          }
        }
      });
    }

    return { syncTemplateFields, getTemplateValues, setTemplateValues };
  }

  function buildAttachmentSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'create-launcher-upload';

    const label = document.createElement('div');
    label.className = 'create-launcher-upload-label';
    label.textContent = 'Attach files (optional)';

    const dropzone = document.createElement('div');
    dropzone.className = 'create-launcher-upload-dropzone';
    dropzone.textContent = 'Drag and drop files here, or click to select';

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';

    const list = document.createElement('ul');
    list.className = 'create-launcher-upload-list';

    let files = [];

    function updateList() {
      list.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('li');
        empty.className = 'create-launcher-upload-empty';
        empty.textContent = 'No files selected';
        list.appendChild(empty);
        return;
      }
      files.forEach((file, index) => {
        const item = document.createElement('li');
        item.className = 'create-launcher-upload-item';
        const name = document.createElement('span');
        name.className = 'create-launcher-upload-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'create-launcher-upload-size';
        size.textContent = `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'create-launcher-upload-remove';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          files = files.filter((_, i) => i !== index);
          updateList();
        });
        item.appendChild(name);
        item.appendChild(size);
        item.appendChild(remove);
        list.appendChild(item);
      });
    }

    function addFiles(fileList) {
      const incoming = Array.from(fileList || []);
      if (incoming.length) {
        files = files.concat(incoming);
        updateList();
      }
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

    wrapper.appendChild(label);
    wrapper.appendChild(dropzone);
    wrapper.appendChild(list);
    wrapper.appendChild(input);

    return {
      wrapper,
      getFiles() {
        return files.slice();
      },
      clear() {
        files = [];
        updateList();
      }
    };
  }

  function buildCreateLauncherUI({ mode = 'modal', tools }) {
    const isPage = mode === 'page';
    const overlay = isPage ? null : document.createElement('div');
    if (overlay) {
      overlay.className = 'modal-overlay create-launcher-modal-overlay';
    }

    const container = document.createElement('div');
    container.className = isPage ? 'create-launcher-page-card' : 'create-launcher-modal';
    container.dataset.variant = MODAL_VARIANTS.CREATE;

    const header = document.createElement('div');
    header.className = 'create-launcher-modal-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'create-launcher-modal-icon';

    const headerIcon = document.createElement('img');
    headerIcon.src = '/pinokio-black.png';
    headerIcon.alt = 'Pinokio logo';
    headerIcon.className = 'create-launcher-modal-logo';
    iconWrapper.appendChild(headerIcon);

    const headingStack = document.createElement('div');
    headingStack.className = 'create-launcher-modal-headings';

    const title = document.createElement('h3');
    title.id = `${mode}-create-launcher-title`;
    title.textContent = 'Create';

    const description = document.createElement('p');
    description.className = 'create-launcher-modal-description';
    description.id = `${mode}-create-launcher-description`;
    description.textContent = CREATE_DESCRIPTION;

    headingStack.appendChild(title);
    headingStack.appendChild(description);

    header.appendChild(iconWrapper);
    header.appendChild(headingStack);

    let closeButton = null;
    if (!isPage) {
      closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'create-launcher-modal-close';
      closeButton.setAttribute('aria-label', 'Close create launcher modal');
      closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      header.appendChild(closeButton);
    }

    const promptLabel = document.createElement('label');
    promptLabel.className = 'create-launcher-modal-label';
    promptLabel.textContent = 'What do you want to do?';

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'create-launcher-modal-textarea';
    promptTextarea.placeholder = CREATE_PROMPT_PLACEHOLDER;
    promptLabel.appendChild(promptTextarea);

    const templateWrapper = document.createElement('div');
    templateWrapper.className = 'create-launcher-modal-template';
    templateWrapper.style.display = 'none';

    const templateTitle = document.createElement('div');
    templateTitle.className = 'create-launcher-modal-template-title';
    templateTitle.textContent = 'Template variables';

    const templateDescription = document.createElement('p');
    templateDescription.className = 'create-launcher-modal-template-description';
    templateDescription.textContent = 'Fill in each variable below before creating your launcher.';

    const templateFields = document.createElement('div');
    templateFields.className = 'create-launcher-modal-template-fields';

    templateWrapper.appendChild(templateTitle);
    templateWrapper.appendChild(templateDescription);
    templateWrapper.appendChild(templateFields);

    const folderLabel = document.createElement('label');
    folderLabel.className = 'create-launcher-modal-label';
    folderLabel.textContent = 'name';

    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.placeholder = 'example: my-launcher';
    folderInput.className = 'create-launcher-modal-input';
    folderLabel.appendChild(folderInput);

    const attachments = buildAttachmentSection();

    const { wrapper: toolWrapper, toolEntries } = buildToolOptions(tools);

    const error = document.createElement('div');
    error.className = 'create-launcher-modal-error';

    const actions = document.createElement('div');
    actions.className = 'create-launcher-modal-actions';

    let cancelButton = null;
    if (!isPage) {
      cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'create-launcher-modal-button cancel';
      cancelButton.textContent = 'Cancel';
      actions.appendChild(cancelButton);
    }

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'create-launcher-modal-button confirm';
    confirmButton.textContent = 'Create';
    actions.appendChild(confirmButton);

    const advancedLink = document.createElement('a');
    advancedLink.className = 'create-launcher-modal-advanced';
    advancedLink.href = '/init';
    advancedLink.textContent = 'Or, try advanced options';

    const bookmarkletLink = document.createElement('a');
    bookmarkletLink.className = 'create-launcher-modal-bookmarklet';
    bookmarkletLink.href = '/bookmarklet';
      bookmarkletLink.textContent = 'Bookmark this in your web browser';

    const linkRow = document.createElement('div');
    linkRow.className = 'create-launcher-modal-links';
    linkRow.appendChild(advancedLink);
    linkRow.appendChild(bookmarkletLink);

    container.appendChild(header);
    container.appendChild(promptLabel);
    container.appendChild(templateWrapper);
    container.appendChild(folderLabel);
    container.appendChild(attachments.wrapper);
    container.appendChild(toolWrapper);
    container.appendChild(error);
    container.appendChild(actions);
    container.appendChild(linkRow);

    if (overlay) {
      overlay.appendChild(container);
    }

    const templateManager = createTemplateManager(templateWrapper, templateFields);

    let folderEditedByUser = false;

    folderInput.addEventListener('input', () => {
      folderEditedByUser = true;
    });

    promptTextarea.addEventListener('input', () => {
      templateManager.syncTemplateFields(promptTextarea.value);
      if (!folderEditedByUser && container.dataset.variant !== MODAL_VARIANTS.ASK) {
        folderInput.value = generateFolderSuggestion(promptTextarea.value);
      }
    });

    return {
      mode,
      overlay,
      container,
      title,
      description,
      promptTextarea,
      folderInput,
      folderLabel,
      templateWrapper,
      templateFields,
      templateManager,
      toolEntries,
      error,
      cancelButton,
      confirmButton,
      closeButton,
      advancedLink,
      bookmarkletLink,
      linkRow,
      attachments,
      currentVariant: MODAL_VARIANTS.CREATE,
      projectName: '',
      resetFolderTracking() {
        folderEditedByUser = false;
      },
      markFolderEdited() {
        folderEditedByUser = true;
      }
    };
  }

  function setModalOpenState(open) {
    const main = document.querySelector('main');
    if (open) {
      if (modalOpen) return;
      modalOpen = true;
      modalPrevFocus = document.activeElement;
      if (main) {
        modalPrevInert = main.hasAttribute('inert');
        main.setAttribute('inert', '');
        if (typeof main.inert !== 'undefined') {
          main.inert = true;
        }
      }
      try {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      } catch (_) {}
      return;
    }
    if (!modalOpen) return;
    modalOpen = false;
    if (main && !modalPrevInert) {
      if (typeof main.inert !== 'undefined') {
        main.inert = false;
      }
      main.removeAttribute('inert');
    }
    modalPrevInert = null;
    if (modalPrevFocus && typeof modalPrevFocus.focus === 'function') {
      try {
        modalPrevFocus.focus();
      } catch (_) {}
    }
    modalPrevFocus = null;
  }

  function applyVariantToUi(ui, variant = MODAL_VARIANTS.CREATE) {
    if (!ui) return;
    const targetVariant = variant === MODAL_VARIANTS.ASK ? MODAL_VARIANTS.ASK : MODAL_VARIANTS.CREATE;
    const isAsk = targetVariant === MODAL_VARIANTS.ASK;
    ui.currentVariant = targetVariant;
    if (ui.container) {
      ui.container.dataset.variant = targetVariant;
    }
    if (ui.title) {
      ui.title.textContent = isAsk ? 'Ask AI' : 'Create';
    }
    if (ui.description) {
      ui.description.textContent = isAsk ? ASK_DESCRIPTION : CREATE_DESCRIPTION;
    }
    if (ui.promptTextarea) {
      ui.promptTextarea.placeholder = isAsk ? ASK_PROMPT_PLACEHOLDER : CREATE_PROMPT_PLACEHOLDER;
    }
    if (ui.folderLabel) {
      ui.folderLabel.style.display = isAsk ? 'none' : '';
    }
    if (ui.attachments && ui.attachments.wrapper) {
      ui.attachments.wrapper.style.display = isAsk ? 'none' : '';
    }
    if (ui.linkRow) {
      ui.linkRow.style.display = isAsk ? 'none' : '';
    }
    if (ui.confirmButton) {
      ui.confirmButton.textContent = isAsk ? 'Ask' : 'Create';
    }
  }

  function applyDefaultsToUi(ui, defaults = {}) {
    if (!ui) return;
    const promptValue = typeof defaults.prompt === 'string' ? defaults.prompt : '';
    const projectName = typeof defaults.projectName === 'string' ? defaults.projectName.trim() : '';
    const folderValue = typeof defaults.folder === 'string' && defaults.folder.trim()
      ? defaults.folder.trim()
      : (projectName || generateFolderSuggestion(promptValue));
    const toolValue = typeof defaults.tool === 'string' ? defaults.tool.trim() : '';
    const templateDefaults = defaults.templateValues || {};

    ui.promptTextarea.value = promptValue;
    ui.templateManager.syncTemplateFields(promptValue, templateDefaults);
    ui.folderInput.value = folderValue || '';
    ui.projectName = projectName || '';
    ui.resetFolderTracking();

    if (toolValue) {
      let matched = false;
      ui.toolEntries.forEach((entry, index) => {
        if (entry.input.value === toolValue) {
          entry.input.checked = true;
          matched = true;
        } else {
          entry.input.checked = false;
        }
      });
      if (!matched && ui.toolEntries.length > 0) {
        ui.toolEntries.forEach((entry, index) => {
          entry.input.checked = index === 0;
        });
      }
    } else if (ui.toolEntries.length > 0) {
      const defaultEntryIndex = ui.toolEntries.findIndex((entry) => entry.meta && entry.meta.isDefault);
      const fallbackIndex = defaultEntryIndex >= 0 ? defaultEntryIndex : 0;
      ui.toolEntries.forEach((entry, index) => {
        entry.input.checked = index === fallbackIndex;
      });
    }

    updateToolSelections(ui.toolEntries);
  }

  function readTemplateValues(ui) {
    return ui && ui.templateManager ? ui.templateManager.getTemplateValues() : new Map();
  }

  async function uploadAttachments(ui, files) {
    if (!files || !files.length) {
      return null;
    }
    const formData = new FormData();
    files.forEach((file) => {
      if (file) {
        formData.append('files', file, file.name || 'file');
      }
    });
    const response = await fetch('/create-upload', {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to upload files.');
    }
    const data = await response.json();
    if (data && data.error) {
      throw new Error(data.error);
    }
    return data;
  }

  function getCurrentFrameIdForSplit() {
    try {
      const frameId = window.frameElement?.dataset?.nodeId;
      if (typeof frameId === 'string' && frameId.trim()) {
        return frameId.trim();
      }
    } catch (_) {}
    if (typeof window.name === 'string' && window.name.trim()) {
      return window.name.trim();
    }
    return null;
  }

  function requestLayoutSplitViaMessage({ direction, targetUrl }) {
    return new Promise((resolve) => {
      if (!direction || !targetUrl) {
        resolve(false);
        return;
      }
      if (!window.parent || window.parent === window) {
        resolve(false);
        return;
      }

      const requestId = `create_launcher_split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      let settled = false;
      let timeoutId = null;

      const cleanup = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener('message', onResponse);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        resolve(result);
      };

      function onResponse(event) {
        if (!event || !event.data || event.source !== window.parent) {
          return;
        }
        if (event.data.e !== 'layout-split-response' || event.data.requestId !== requestId) {
          return;
        }
        cleanup(Boolean(event.data.ok));
      }

      window.addEventListener('message', onResponse);
      timeoutId = window.setTimeout(() => cleanup(false), 1500);

      try {
        window.parent.postMessage({
          e: 'layout-split-request',
          requestId,
          direction,
          targetUrl,
        }, '*');
      } catch (_) {
        cleanup(false);
      }
    });
  }

  async function splitAskAiTarget(targetUrl) {
    const frameId = getCurrentFrameIdForSplit();
    let layoutApi = null;
    try {
      layoutApi = window.parent && window.parent.PinokioLayout;
    } catch (_) {
      layoutApi = null;
    }

    if (layoutApi && typeof layoutApi.split === 'function' && frameId) {
      try {
        const ok = layoutApi.split({
          frameId,
          direction: 'columns',
          targetUrl,
        });
        if (ok) {
          layoutApi.ensureSession?.();
          return true;
        }
      } catch (error) {
        console.warn('Create launcher split via layout API failed', error);
      }
    }

    return requestLayoutSplitViaMessage({
      direction: 'columns',
      targetUrl,
    });
  }

  async function submitFromUi(ui) {
    if (!ui) return;
    ui.error.textContent = '';

    const variant = ui.currentVariant || MODAL_VARIANTS.CREATE;
    const isAskVariant = variant === MODAL_VARIANTS.ASK;
    const folderName = ui.folderInput.value.trim();
    const targetProject = isAskVariant ? (ui.projectName || folderName) : folderName;
    const rawPrompt = ui.promptTextarea.value;
    const templateValues = readTemplateValues(ui);
    const selectedEntry = ui && Array.isArray(ui.toolEntries)
      ? (ui.toolEntries.find((entry) => entry.input.checked) || ui.toolEntries[0])
      : null
    const selectedTool = selectedEntry && selectedEntry.input ? selectedEntry.input.value : ''
    const selectedHref = selectedEntry && selectedEntry.input ? selectedEntry.input.dataset.agentHref : ''
    const selectedFiles = ui.attachments && typeof ui.attachments.getFiles === 'function'
      ? ui.attachments.getFiles()
      : [];
    let uploadToken = '';

    if (!selectedEntry || !selectedHref) {
      ui.error.textContent = 'Please select an agent.';
      return;
    }

    if (!isAskVariant) {
      if (!folderName) {
        ui.error.textContent = 'Please enter a folder name.';
        ui.folderInput.focus();
        return;
      }

      if (folderName.includes(' ')) {
        ui.error.textContent = 'Folder names cannot contain spaces.';
        ui.folderInput.focus();
        return;
      }
    }

    let finalPrompt = rawPrompt;
    if (templateValues.size > 0) {
      const missingVariables = [];
      templateValues.forEach((value, name) => {
        if (!value || value.trim() === '') {
          missingVariables.push(name);
        }
      });

      if (missingVariables.length > 0) {
        ui.error.textContent = `Please fill in values for: ${missingVariables.join(', ')}`;
        const targetInput = ui.templateFields?.querySelector(`[data-template-input="${missingVariables[0]}"]`);
        if (targetInput) {
          targetInput.focus();
        } else {
          ui.promptTextarea.focus();
        }
        return;
      }

      finalPrompt = applyTemplateValues(rawPrompt, templateValues);
    }

    if (selectedFiles.length > 0) {
      try {
        const uploadResult = await uploadAttachments(ui, selectedFiles);
        if (uploadResult && uploadResult.uploadToken) {
          uploadToken = uploadResult.uploadToken;
        }
      } catch (uploadError) {
        ui.error.textContent = uploadError.message || 'Failed to upload files.';
        return;
      }
    }

    const prompt = finalPrompt.trim();

    if (isAskVariant) {
      const params = new URLSearchParams();
      const pluginPath = selectedHref.replace(/^\/run/, '')
      params.set('plugin', pluginPath);
      if (prompt) {
        params.set('prompt', prompt);
      }
      const askTargetUrl = `/p/${targetProject}/dev?${params.toString()}`;
      const splitOk = await splitAskAiTarget(askTargetUrl);
      if (splitOk) {
        if (ui.mode === 'modal') {
          hideModal();
        }
        return;
      }
      window.location.href = askTargetUrl;
      return;
    }

    const params = new URLSearchParams();
    params.set('name', folderName);
    params.set('message', prompt);
    if (selectedTool) {
      params.set('tool', selectedTool);
    }
    if (uploadToken) {
      params.set('uploadToken', uploadToken);
    }

    window.location.href = `/pro?${params.toString()}`;
  }

  async function ensureCreateLauncherModal() {
    if (modalInstance) {
      return modalInstance;
    }
    if (modalPromise) {
      return modalPromise;
    }

    modalPromise = (async () => {
      const tools = await getCreateLauncherTools();
      const ui = buildCreateLauncherUI({ mode: 'modal', tools });

      document.body.appendChild(ui.overlay);

      ui.confirmButton.addEventListener('click', () => {
        submitFromUi(ui);
      });
      if (ui.cancelButton) {
        ui.cancelButton.addEventListener('click', hideModal);
      }
      if (ui.closeButton) {
        ui.closeButton.addEventListener('click', hideModal);
      }
      ui.advancedLink.addEventListener('click', hideModal);
      ui.bookmarkletLink.addEventListener('click', hideModal);

      modalInstance = ui;
      modalPromise = null;
      return ui;
    })();

    return modalPromise;
  }

  async function showModal(defaults = {}) {
    const ui = await ensureCreateLauncherModal();
    if (!ui) {
      return;
    }

    const options = (defaults && typeof defaults === 'object') ? defaults : {};
    const { variant, ...restDefaults } = options;
    applyVariantToUi(ui, variant);
    applyDefaultsToUi(ui, restDefaults);
    ui.templateManager.syncTemplateFields(ui.promptTextarea.value, restDefaults.templateValues || {});

    setModalOpenState(true);
    ui.overlay.classList.add('is-visible');
    if (ui.currentVariant !== MODAL_VARIANTS.ASK && ui.folderInput) {
      ui.folderInput.select();
    }
    ui.promptTextarea.focus();

    modalKeydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideModal();
      } else if (event.key === 'Enter' && event.target === ui.folderInput) {
        event.preventDefault();
        submitFromUi(ui);
      }
    };

    document.addEventListener('keydown', modalKeydownHandler, true);
  }

  function hideModal() {
    if (!modalInstance) return;
    modalInstance.overlay.classList.remove('is-visible');
    setModalOpenState(false);
    if (modalKeydownHandler) {
      document.removeEventListener('keydown', modalKeydownHandler, true);
      modalKeydownHandler = null;
    }
  }

  async function mountPage(root, defaults = {}) {
    if (!root) {
      return;
    }
    const tools = await getCreateLauncherTools();
    const ui = buildCreateLauncherUI({ mode: 'page', tools });

    root.innerHTML = '';
    root.appendChild(ui.container);

    ui.confirmButton.addEventListener('click', () => {
      submitFromUi(ui);
    });

    applyDefaultsToUi(ui, defaults);
    ui.templateManager.syncTemplateFields(ui.promptTextarea.value, defaults.templateValues || {});

    requestAnimationFrame(() => {
      ui.promptTextarea.focus();
    });

    return ui;
  }

  window.CreateLauncher = {
    showModal,
    hideModal,
    ensureModalReady: ensureCreateLauncherModal,
    mountPage,
    applyTemplateValues,
    generateFolderSuggestion,
  };

  try {
    window.dispatchEvent(new CustomEvent('CreateLauncherReady'));
  } catch (_) {
    // ignore if CustomEvent is unavailable
  }
})(window, document);
