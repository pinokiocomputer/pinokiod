(function(window, document) {
  "use strict";

  const CATEGORY_ORDER = ["CLI", "IDE"];
  const FALLBACK_TOOLS = [
    {
      value: "code/claude",
      label: "Claude Code",
      isDefault: true,
      category: "CLI"
    },
    {
      value: "code/codex",
      label: "OpenAI Codex",
      isDefault: false,
      category: "CLI"
    },
    {
      value: "code/gemini",
      label: "Google Gemini CLI",
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
        category: hasExec ? "IDE" : "CLI",
        isDefault: plugin.default === true
      };
    }).filter(Boolean);
  }

  function getCategoryLabel(category) {
    return category === "IDE" ? "Desktop app" : category;
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
    const toolSelect = document.querySelector("[data-task-tool-select]");
    if (!toolSelect) {
      return;
    }

    const statusEl = document.querySelector("[data-task-tool-status]");
    const selectedValue = toolSelect.getAttribute("data-selected") || "";

    getTools().then((tools) => {
      toolSelect.innerHTML = "";
      const grouped = tools.reduce((acc, tool) => {
        const category = tool.category || "CLI";
        if (!acc.has(category)) {
          acc.set(category, []);
        }
        acc.get(category).push(tool);
        return acc;
      }, new Map());

      const orderedGroups = [];
      CATEGORY_ORDER.forEach((category) => {
        if (grouped.has(category)) {
          orderedGroups.push([category, grouped.get(category)]);
          grouped.delete(category);
        }
      });
      grouped.forEach((items, category) => {
        orderedGroups.push([category, items]);
      });

      let resolvedSelection = "";
      orderedGroups.forEach(([category, items]) => {
        const group = document.createElement("optgroup");
        group.label = getCategoryLabel(category);
        items.forEach((tool) => {
          const option = document.createElement("option");
          option.value = tool.value;
          option.textContent = tool.label;
          if (!resolvedSelection && selectedValue && selectedValue === tool.value) {
            option.selected = true;
            resolvedSelection = tool.value;
          }
          group.appendChild(option);
        });
        toolSelect.appendChild(group);
      });

      if (!resolvedSelection) {
        const defaultTool = tools.find((tool) => tool.isDefault) || tools[0] || null;
        if (defaultTool) {
          toolSelect.value = defaultTool.value;
        }
      }

      if (statusEl) {
        statusEl.textContent = "Choose the tool that should run this task.";
      }
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

  document.addEventListener("DOMContentLoaded", () => {
    initTaskRunner();
    initTaskBuilder();
  });
})(window, document);
