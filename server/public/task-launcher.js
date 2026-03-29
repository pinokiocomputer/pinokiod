(function(window, document) {
  "use strict";

  const CATEGORY_ORDER = ["CLI", "IDE"];
  const FALLBACK_TOOLS = [
    {
      value: "code/claude",
      label: "Claude Code",
      iconSrc: "/asset/plugin/code/claude/claude.png",
      isDefault: true,
      category: "CLI"
    },
    {
      value: "code/codex",
      label: "OpenAI Codex",
      iconSrc: "/asset/plugin/code/codex/openai.webp",
      isDefault: false,
      category: "CLI"
    },
    {
      value: "code/gemini",
      label: "Google Gemini CLI",
      iconSrc: "/asset/plugin/code/gemini/gemini.jpeg",
      isDefault: false,
      category: "CLI"
    }
  ];

  function extractTemplateVariableNames(template) {
    const regex = /{{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\s*}}/g;
    const names = new Set();
    if (!template) return [];
    let match;
    while ((match = regex.exec(template)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function humanizeInputName(name) {
    return String(name || "")
      .replace(/[_\-.]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  function mapPluginMenuToTools(menu) {
    if (!Array.isArray(menu)) return [];
    return menu.map((plugin) => {
      if (!plugin || typeof plugin !== "object") return null;
      const href = typeof plugin.href === "string" ? plugin.href.trim() : "";
      if (!href) return null;
      let value = href.replace(/^\/run\/plugin\//, "").replace(/^\/+/, "");
      if (value.endsWith("/pinokio.js")) {
        value = value.replace(/\/pinokio\.js$/i, "");
      }
      if (!value) return null;
      const runs = Array.isArray(plugin.run) ? plugin.run : [];
      const hasExec = runs.some((step) => step && step.method === "exec");
      return {
        value,
        label: plugin.title || plugin.text || plugin.name || value,
        iconSrc: plugin.image || null,
        category: hasExec ? "IDE" : "CLI",
        isDefault: plugin.default === true
      };
    }).filter(Boolean);
  }

  function getCategoryLabel(category) {
    return category === "IDE" ? "Desktop app" : category;
  }

  function buildTaskToolPicker(tools, host, hiddenInput) {
    if (!host || !hiddenInput) {
      return null;
    }

    const picker = document.createElement("div");
    picker.className = "task-tool-picker";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "task-tool-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    picker.appendChild(trigger);

    const triggerIcon = document.createElement("img");
    triggerIcon.className = "task-tool-trigger-icon";
    triggerIcon.alt = "";
    triggerIcon.hidden = true;
    trigger.appendChild(triggerIcon);

    const triggerContent = document.createElement("span");
    triggerContent.className = "task-tool-trigger-content";
    trigger.appendChild(triggerContent);

    const triggerLabel = document.createElement("span");
    triggerLabel.className = "task-tool-trigger-label";
    triggerContent.appendChild(triggerLabel);

    const triggerMeta = document.createElement("span");
    triggerMeta.className = "task-tool-trigger-meta";
    triggerContent.appendChild(triggerMeta);

    const triggerCaret = document.createElement("i");
    triggerCaret.className = "fa-solid fa-chevron-down task-tool-trigger-caret";
    triggerCaret.setAttribute("aria-hidden", "true");
    trigger.appendChild(triggerCaret);

    const layer = document.createElement("div");
    layer.className = "task-tool-sheet-layer";
    layer.hidden = true;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "task-tool-sheet-backdrop";
    backdrop.setAttribute("aria-label", "Close tool selection");
    layer.appendChild(backdrop);

    const sheet = document.createElement("section");
    sheet.className = "task-tool-sheet";
    sheet.setAttribute("aria-label", "Select tool");
    layer.appendChild(sheet);

    const sheetHeader = document.createElement("div");
    sheetHeader.className = "task-tool-sheet-header";
    sheet.appendChild(sheetHeader);

    const sheetHeading = document.createElement("div");
    sheetHeading.className = "task-tool-sheet-heading";
    sheetHeader.appendChild(sheetHeading);

    const sheetTitle = document.createElement("div");
    sheetTitle.className = "task-tool-sheet-title";
    sheetTitle.textContent = "Select tool";
    sheetHeading.appendChild(sheetTitle);

    const sheetDescription = document.createElement("div");
    sheetDescription.className = "task-tool-sheet-description";
    sheetDescription.textContent = "Choose how Pinokio should run this task.";
    sheetHeading.appendChild(sheetDescription);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "task-tool-sheet-close";
    closeButton.setAttribute("aria-label", "Close tool selection");
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    sheetHeader.appendChild(closeButton);

    const sheetBody = document.createElement("div");
    sheetBody.className = "task-tool-sheet-body";
    sheetBody.setAttribute("role", "listbox");
    sheet.appendChild(sheetBody);

    host.innerHTML = "";
    host.appendChild(picker);
    document.body.appendChild(layer);

    const grouped = tools.reduce((map, tool) => {
      const category = tool.category || "CLI";
      if (!map.has(category)) {
        map.set(category, []);
      }
      map.get(category).push(tool);
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

    const entries = [];
    let selectedValue = "";
    let menuOpen = false;

    orderedGroups.forEach(([category, groupTools]) => {
      const group = document.createElement("div");
      group.className = "task-tool-group";

      const title = document.createElement("div");
      title.className = "task-tool-group-title";
      title.textContent = getCategoryLabel(category);
      group.appendChild(title);

      const list = document.createElement("div");
      list.className = "task-tool-list";
      group.appendChild(list);

      groupTools.slice().sort((a, b) => {
        const nameA = String(a && a.label ? a.label : "").toLowerCase();
        const nameB = String(b && b.label ? b.label : "").toLowerCase();
        return nameA.localeCompare(nameB);
      }).forEach((tool) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "task-tool-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.value = tool.value;

        const indicator = document.createElement("span");
        indicator.className = "task-tool-indicator";
        indicator.setAttribute("aria-hidden", "true");
        option.appendChild(indicator);

        if (tool.iconSrc) {
          const icon = document.createElement("img");
          icon.className = "task-tool-icon";
          icon.src = tool.iconSrc;
          icon.alt = `${tool.label} icon`;
          icon.onerror = () => {
            icon.style.display = "none";
          };
          option.appendChild(icon);
        } else {
          const spacer = document.createElement("span");
          spacer.className = "task-tool-icon task-tool-icon-placeholder";
          spacer.setAttribute("aria-hidden", "true");
          option.appendChild(spacer);
        }

        const copy = document.createElement("span");
        copy.className = "task-tool-copy";

        const label = document.createElement("span");
        label.className = "task-tool-label";
        label.textContent = tool.label;
        copy.appendChild(label);

        const meta = document.createElement("span");
        meta.className = "task-tool-meta";
        meta.textContent = getCategoryLabel(tool.category || "CLI");
        copy.appendChild(meta);

        option.appendChild(copy);
        option.addEventListener("click", () => {
          api.setValue(tool.value);
          api.closeMenu();
          trigger.focus();
        });

        list.appendChild(option);
        entries.push({ button: option, meta: tool });
      });

      sheetBody.appendChild(group);
    });

    function getEntryByValue(value) {
      return entries.find((entry) => entry.meta && entry.meta.value === value) || null;
    }

    function syncTrigger() {
      const entry = getEntryByValue(selectedValue);
      const hasSelection = Boolean(entry && entry.meta);

      picker.classList.toggle("open", menuOpen);
      trigger.classList.toggle("has-value", hasSelection);
      trigger.setAttribute("aria-expanded", menuOpen ? "true" : "false");

      if (hasSelection && entry.meta.iconSrc) {
        triggerIcon.hidden = false;
        triggerIcon.src = entry.meta.iconSrc;
      } else {
        triggerIcon.hidden = true;
        triggerIcon.removeAttribute("src");
      }

      if (hasSelection) {
        triggerLabel.textContent = entry.meta.label;
        triggerMeta.textContent = getCategoryLabel(entry.meta.category || "CLI");
      } else {
        triggerLabel.textContent = "Choose a tool";
        triggerMeta.textContent = "Required before running";
      }

      entries.forEach((entryItem) => {
        const active = Boolean(selectedValue && entryItem.meta && entryItem.meta.value === selectedValue);
        entryItem.button.classList.toggle("selected", active);
        entryItem.button.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    const api = {
      setValue(value) {
        const nextValue = typeof value === "string" ? value.trim() : "";
        const entry = nextValue ? getEntryByValue(nextValue) : null;
        selectedValue = entry ? entry.meta.value : "";
        hiddenInput.value = selectedValue;
        syncTrigger();
      },
      openMenu() {
        menuOpen = true;
        layer.hidden = false;
        syncTrigger();
        window.requestAnimationFrame(() => {
          const entry = getEntryByValue(selectedValue);
          const focusTarget = entry && entry.button ? entry.button : (entries[0] && entries[0].button);
          if (focusTarget && !focusTarget.disabled) {
            focusTarget.focus();
          }
        });
      },
      closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        layer.hidden = true;
        syncTrigger();
      },
      toggleMenu() {
        if (menuOpen) {
          this.closeMenu();
          return;
        }
        this.openMenu();
      }
    };

    trigger.addEventListener("click", () => {
      api.toggleMenu();
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        api.openMenu();
      }
    });

    closeButton.addEventListener("click", () => {
      api.closeMenu();
      trigger.focus();
    });

    backdrop.addEventListener("click", () => {
      api.closeMenu();
      trigger.focus();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!menuOpen) return;
      if (picker.contains(event.target) || layer.contains(event.target)) return;
      api.closeMenu();
    }, true);

    const initialValue = hiddenInput.value.trim();
    const defaultTool = tools.find((tool) => tool.value === initialValue)
      || tools.find((tool) => tool.isDefault)
      || tools[0]
      || null;
    if (defaultTool) {
      api.setValue(defaultTool.value);
    } else {
      syncTrigger();
    }

    return api;
  }

  async function getTools() {
    try {
      const response = await fetch("/api/plugin/menu");
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const payload = await response.json();
      const tools = mapPluginMenuToTools(payload && Array.isArray(payload.menu) ? payload.menu : []);
      return tools.length > 0 ? tools : FALLBACK_TOOLS.slice();
    } catch (_) {
      return FALLBACK_TOOLS.slice();
    }
  }

  function initTaskRunner() {
    const toolHost = document.querySelector("[data-task-tool-picker]");
    const toolValueInput = document.querySelector("[data-task-tool-value]");
    if (!toolHost || !toolValueInput) {
      return;
    }

    getTools().then((tools) => {
      buildTaskToolPicker(tools, toolHost, toolValueInput);
    });
  }

  function buildInputRow(values) {
    const row = document.createElement("div");
    row.className = "task-input-editor-row task-input-editor-row-derived";
    row.setAttribute("data-task-input-row", "");
    row.setAttribute("data-task-input-name", values && values.name ? values.name : "");

    const identity = document.createElement("div");
    identity.className = "task-input-identity";

    const identityLabel = document.createElement("span");
    identityLabel.className = "task-input-identity-label";
    identityLabel.textContent = "Template variable";
    identity.appendChild(identityLabel);

    const identityChip = document.createElement("span");
    identityChip.className = "task-derived-input-chip";
    identityChip.textContent = `{{${values && values.name ? values.name : ""}}}`;
    identity.appendChild(identityChip);

    const labelField = document.createElement("label");
    labelField.className = "task-field task-field-tight";

    const labelFieldLabel = document.createElement("span");
    labelFieldLabel.className = "task-label";
    labelFieldLabel.textContent = "Label shown in Pinokio";
    labelField.appendChild(labelFieldLabel);

    const labelInput = document.createElement("input");
    labelInput.className = "task-input";
    labelInput.type = "text";
    labelInput.placeholder = humanizeInputName(values && values.name ? values.name : "");
    labelInput.setAttribute("data-task-input-label", "");
    labelInput.value = values && values.label ? values.label : "";
    labelField.appendChild(labelInput);

    const requiredToggle = document.createElement("label");
    requiredToggle.className = "task-toggle task-toggle-compact";
    const requiredInput = document.createElement("input");
    requiredInput.type = "checkbox";
    requiredInput.setAttribute("data-task-input-required", "");
    requiredInput.checked = !values || values.required !== false;
    const requiredText = document.createElement("span");
    requiredText.textContent = "Required";
    requiredToggle.appendChild(requiredInput);
    requiredToggle.appendChild(requiredText);

    row.appendChild(identity);
    row.appendChild(labelField);
    row.appendChild(requiredToggle);
    return row;
  }

  function syncTemplateVariables() {
    const builder = document.querySelector("[data-task-builder]");
    if (!builder) {
      return;
    }
    const templateEl = builder.querySelector("[data-task-template]");
    const listEl = builder.querySelector("[data-task-variable-list]");
    const emptyEl = builder.querySelector("[data-task-variable-empty]");
    if (!templateEl || !listEl) {
      return;
    }
    const variables = extractTemplateVariableNames(templateEl.value);
    listEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.classList.toggle("task-hidden", variables.length > 0);
    }
    variables.forEach((name) => {
      const chip = document.createElement("span");
      chip.className = "task-variable-chip";
      chip.textContent = `{{${name}}}`;
      listEl.appendChild(chip);
    });
  }

  function initTaskBuilder() {
    const builder = document.querySelector("[data-task-builder]");
    if (!builder) {
      return;
    }

    const section = builder.querySelector("[data-task-inputs-section]");
    const list = builder.querySelector("[data-task-input-editor]");
    const countNote = builder.querySelector("[data-task-input-count-note]");
    const inputsJsonField = builder.querySelector("[data-task-inputs-json]");
    const templateEl = builder.querySelector("[data-task-template]");

    if (!list || !inputsJsonField || !templateEl) {
      return;
    }

    const initialInputsRaw = builder.getAttribute("data-initial-inputs") || "[]";
    let initialInputs = [];
    try {
      initialInputs = JSON.parse(initialInputsRaw);
    } catch (_) {
      initialInputs = [];
    }

    const inputDrafts = new Map();
    if (Array.isArray(initialInputs)) {
      initialInputs.forEach((entry) => {
        if (!entry || !entry.name) {
          return;
        }
        inputDrafts.set(entry.name, {
          name: entry.name,
          label: entry.label || humanizeInputName(entry.name),
          required: entry.required !== false
        });
      });
    }

    function syncInputsJson() {
      const payload = Array.from(list.querySelectorAll("[data-task-input-row]")).map((row) => {
        const name = row.getAttribute("data-task-input-name") || "";
        if (!name) {
          return null;
        }
        const label = row.querySelector("[data-task-input-label]").value.trim() || humanizeInputName(name);
        const required = row.querySelector("[data-task-input-required]").checked;
        return {
          name,
          label,
          required
        };
      }).filter(Boolean);
      inputsJsonField.value = JSON.stringify(payload);
    }

    function readRowsIntoDrafts() {
      Array.from(list.querySelectorAll("[data-task-input-row]")).forEach((row) => {
        const name = row.getAttribute("data-task-input-name") || "";
        if (!name) {
          return;
        }
        inputDrafts.set(name, {
          name,
          label: row.querySelector("[data-task-input-label]").value.trim() || humanizeInputName(name),
          required: row.querySelector("[data-task-input-required]").checked
        });
      });
    }

    function renderInputRows() {
      const variables = extractTemplateVariableNames(templateEl.value);
      list.innerHTML = "";

      if (section) {
        const hasVariables = variables.length > 0;
        section.classList.toggle("task-hidden", !hasVariables);
        section.setAttribute("aria-hidden", hasVariables ? "false" : "true");
      }
      if (countNote) {
        countNote.textContent = `${variables.length} input${variables.length === 1 ? "" : "s"}`;
      }

      variables.forEach((name) => {
        const existing = inputDrafts.get(name) || {
          name,
          label: humanizeInputName(name),
          required: true
        };
        list.appendChild(buildInputRow(existing));
      });
      syncInputsJson();
    }

    list.addEventListener("input", () => {
      readRowsIntoDrafts();
      syncInputsJson();
    });
    list.addEventListener("change", () => {
      readRowsIntoDrafts();
      syncInputsJson();
    });

    builder.addEventListener("submit", () => {
      readRowsIntoDrafts();
      syncInputsJson();
    });

    templateEl.addEventListener("input", () => {
      readRowsIntoDrafts();
      syncTemplateVariables();
      renderInputRows();
    });
    syncTemplateVariables();
    renderInputRows();
  }

  function initTaskLibraryPage() {
    const library = document.querySelector("[data-task-library]");
    if (!library) {
      return;
    }

    const searchInput = library.querySelector("[data-task-library-search]");
    const clearButton = library.querySelector("[data-task-library-clear]");
    const list = library.querySelector("[data-task-library-list]");
    const emptyState = library.querySelector("[data-task-library-empty]");
    const items = list ? Array.from(list.querySelectorAll("[data-task-library-item]")) : [];

    function renderSearchResults() {
      if (!searchInput || !items.length) {
        return;
      }
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      items.forEach((item) => {
        const haystack = (item.getAttribute("data-task-search") || "").toLowerCase();
        const matches = !query || haystack.includes(query);
        item.hidden = !matches;
        item.setAttribute("aria-hidden", matches ? "false" : "true");
        if (matches) {
          visibleCount += 1;
        }
      });

      if (list) {
        list.hidden = visibleCount === 0;
      }
      if (emptyState) {
        emptyState.hidden = !(query && visibleCount === 0);
      }
      if (clearButton) {
        clearButton.hidden = !query;
      }
    }

    if (searchInput && items.length) {
      searchInput.addEventListener("input", renderSearchResults);
      if (clearButton) {
        clearButton.addEventListener("click", () => {
          searchInput.value = "";
          renderSearchResults();
          searchInput.focus();
        });
      }
      renderSearchResults();
    }

    const layer = document.querySelector("[data-task-library-download-layer]");
    if (!layer) {
      return;
    }

    const downloadInput = layer.querySelector("[data-task-library-download-input]");
    const openButtons = Array.from(document.querySelectorAll("[data-task-library-download-open]"));
    const closeButtons = Array.from(layer.querySelectorAll("[data-task-library-download-close]"));
    let lastFocused = null;

    function openDownloadModal() {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      layer.hidden = false;
      document.body.classList.add("task-modal-open");
      requestAnimationFrame(() => {
        if (downloadInput) {
          downloadInput.focus();
        }
      });
    }

    function closeDownloadModal() {
      layer.hidden = true;
      document.body.classList.remove("task-modal-open");
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
    }

    openButtons.forEach((button) => {
      button.addEventListener("click", openDownloadModal);
    });
    closeButtons.forEach((button) => {
      button.addEventListener("click", closeDownloadModal);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !layer.hidden) {
        closeDownloadModal();
      }
    });
  }

  function initTaskConfirmForms() {
    const forms = Array.from(document.querySelectorAll("form[data-task-confirm]"));
    forms.forEach((form) => {
      form.addEventListener("submit", (event) => {
        const message = form.getAttribute("data-task-confirm") || "Are you sure?";
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      });
    });
  }

  let taskLauncherBooted = false;

  function bootTaskLauncher() {
    if (taskLauncherBooted) {
      return;
    }
    taskLauncherBooted = true;
    initTaskRunner();
    initTaskBuilder();
    initTaskLibraryPage();
    initTaskConfirmForms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootTaskLauncher, { once: true });
  } else {
    bootTaskLauncher();
  }
})(window, document);
