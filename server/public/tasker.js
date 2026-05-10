(function(window, document) {
  "use strict";

  const VARIABLE_FILTER_KEYS = new Set([
    "var",
    "vars",
    "variable",
    "variables",
    "require",
    "requires"
  ]);
  const PASSTHROUGH_KEYS = new Set([
    "tool",
    "folderName"
  ]);
  const RESERVED_QUERY_KEYS = new Set([
    "q",
    "search",
    ...VARIABLE_FILTER_KEYS,
    ...PASSTHROUGH_KEYS
  ]);
  const TASK_INPUT_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeTaskInputName(value) {
    const normalized = String(value || "").trim();
    return TASK_INPUT_NAME_PATTERN.test(normalized) ? normalized : "";
  }

  function splitVariableList(value) {
    return String(value || "")
      .split(/[,\s]+/)
      .map(normalizeTaskInputName)
      .filter(Boolean);
  }

  function getRequiredVariables(params) {
    const variables = new Set();
    VARIABLE_FILTER_KEYS.forEach((key) => {
      params.getAll(key).forEach((value) => {
        splitVariableList(value).forEach((name) => variables.add(name));
      });
    });
    return Array.from(variables);
  }

  function getInitialSearchQuery(params) {
    return (params.get("q") || params.get("search") || "").trim();
  }

  function getTemplateVariableNames(template) {
    const names = new Set();
    const regex = /{{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]*)\s*}}/g;
    let match;
    while ((match = regex.exec(String(template || ""))) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  function getTaskVariableSet(task) {
    const names = new Set();
    const inputs = Array.isArray(task && task.inputs) ? task.inputs : [];
    inputs.forEach((input) => {
      const name = normalizeTaskInputName(input && input.name);
      if (name) {
        names.add(name);
      }
    });
    getTemplateVariableNames(task && task.template).forEach((name) => {
      names.add(name);
    });
    return names;
  }

  function taskMatchesRequiredVariables(task, requiredVariables) {
    if (!requiredVariables.length) {
      return true;
    }
    const taskVariables = getTaskVariableSet(task);
    return requiredVariables.every((name) => taskVariables.has(name));
  }

  function formatTaskTemplateSummary(task) {
    const preview = normalizeText((task && (task.template || task.description)) || "");
    if (!preview) {
      return "Task";
    }
    return preview.length > 150 ? `${preview.slice(0, 147).trimEnd()}...` : preview;
  }

  function formatRecentUsage(value) {
    const timestamp = Date.parse(typeof value === "string" ? value : "");
    if (!Number.isFinite(timestamp)) {
      return "";
    }
    const diffMs = Math.max(0, Date.now() - timestamp);
    const dayMs = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor(diffMs / dayMs);
    if (diffDays === 0) return "Used today";
    if (diffDays === 1) return "Used yesterday";
    if (diffDays < 7) return `Used ${diffDays}d ago`;
    if (diffDays < 30) return `Used ${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `Used ${Math.floor(diffDays / 30)}mo ago`;
    return `Used ${Math.floor(diffDays / 365)}y ago`;
  }

  function getTaskHref(task, params) {
    const id = task && typeof task.id === "string" ? task.id.trim() : "";
    if (!id) {
      return "/tasks";
    }

    const taskVariables = getTaskVariableSet(task);
    const url = new URL("/task", window.location.origin);
    url.searchParams.set("id", id);

    params.forEach((value, key) => {
      if (key.startsWith("input.")) {
        const inputName = normalizeTaskInputName(key.slice("input.".length));
        if (inputName && taskVariables.has(inputName)) {
          url.searchParams.set(`input.${inputName}`, value);
        }
        return;
      }
      if (PASSTHROUGH_KEYS.has(key) && value) {
        url.searchParams.set(key, value);
        return;
      }
      if (RESERVED_QUERY_KEYS.has(key)) {
        return;
      }
      const inputName = normalizeTaskInputName(key);
      if (inputName && taskVariables.has(inputName)) {
        url.searchParams.set(`input.${inputName}`, value);
      }
    });

    return `${url.pathname}${url.search}`;
  }

  function getSearchText(task) {
    const inputs = Array.isArray(task && task.inputs) ? task.inputs : [];
    return [
      task && task.id,
      task && task.ref,
      task && task.title,
      task && task.description,
      task && task.template,
      task && task.path,
      task && task.target,
      ...inputs.flatMap((input) => [
        input && input.name,
        input && input.label
      ])
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function createTaskRow(task, params) {
    const row = document.createElement("a");
    row.className = "tasker-row";
    row.href = getTaskHref(task, params);
    row.tabIndex = -1;

    const icon = document.createElement("span");
    icon.className = "tasker-row-icon";
    icon.setAttribute("aria-hidden", "true");
    const iconGlyph = document.createElement("i");
    iconGlyph.className = "fa-solid fa-bookmark";
    icon.appendChild(iconGlyph);
    row.appendChild(icon);

    const copy = document.createElement("span");
    copy.className = "tasker-row-copy";

    const label = document.createElement("span");
    label.className = "tasker-row-label";
    label.textContent = (task && (task.title || task.id)) || "Untitled task";
    copy.appendChild(label);

    const meta = document.createElement("span");
    meta.className = "tasker-row-meta";
    const metaBits = [formatTaskTemplateSummary(task)];
    const inputs = Array.isArray(task && task.inputs) ? task.inputs : [];
    if (inputs.length > 0) {
      metaBits.push(`${inputs.length} input${inputs.length === 1 ? "" : "s"}`);
    }
    const usage = formatRecentUsage(task && task.last_used_at);
    if (usage) {
      metaBits.push(usage);
    }
    meta.textContent = metaBits.filter(Boolean).join(" - ");
    copy.appendChild(meta);

    row.appendChild(copy);

    const hint = document.createElement("span");
    hint.className = "tasker-row-hint";
    hint.setAttribute("aria-hidden", "true");
    const hintGlyph = document.createElement("i");
    hintGlyph.className = "fa-solid fa-chevron-right";
    hint.appendChild(hintGlyph);
    row.appendChild(hint);

    return row;
  }

  function initTasker() {
    const root = document.querySelector("[data-tasker]");
    if (!root) {
      return;
    }

    const searchInput = root.querySelector("[data-tasker-search]");
    const clearButton = root.querySelector("[data-tasker-clear]");
    const status = root.querySelector("[data-tasker-status]");
    const list = root.querySelector("[data-tasker-list]");
    const empty = root.querySelector("[data-tasker-empty]");
    const params = new URLSearchParams(window.location.search);
    const requiredVariables = getRequiredVariables(params);
    const initialSearchQuery = getInitialSearchQuery(params);
    let tasks = [];
    let sourceTaskCount = 0;
    let visibleTasks = [];
    let selectedIndex = -1;
    let loading = true;
    let error = "";

    if (searchInput && initialSearchQuery) {
      searchInput.value = initialSearchQuery;
    }

    function syncSelectedRow() {
      if (!list) {
        return;
      }
      const rows = Array.from(list.querySelectorAll(".tasker-row"));
      rows.forEach((row, index) => {
        const selected = index === selectedIndex;
        row.classList.toggle("selected", selected);
        row.setAttribute("aria-selected", selected ? "true" : "false");
        if (selected) {
          row.scrollIntoView({
            block: "nearest"
          });
        }
      });
    }

    function selectResult(index) {
      if (!visibleTasks.length) {
        selectedIndex = -1;
        syncSelectedRow();
        return;
      }
      const max = visibleTasks.length - 1;
      selectedIndex = Math.max(0, Math.min(index, max));
      syncSelectedRow();
    }

    function moveSelection(delta) {
      if (!visibleTasks.length) {
        return;
      }
      if (selectedIndex < 0) {
        selectResult(delta > 0 ? 0 : visibleTasks.length - 1);
        return;
      }
      const nextIndex = (selectedIndex + delta + visibleTasks.length) % visibleTasks.length;
      selectResult(nextIndex);
    }

    function openSelectedResult() {
      if (!visibleTasks.length || selectedIndex < 0) {
        return;
      }
      const row = list ? list.querySelectorAll(".tasker-row")[selectedIndex] : null;
      const href = row ? row.getAttribute("href") : "";
      if (href) {
        window.location.href = href;
      }
    }

    function setStatus(copy) {
      if (status) {
        status.textContent = copy || "";
        status.hidden = !copy;
      }
    }

    function render() {
      if (!list || !empty || !searchInput) {
        return;
      }

      const query = searchInput.value.trim().toLowerCase();
      visibleTasks = query
        ? tasks.filter((task) => getSearchText(task).includes(query))
        : tasks.slice();
      if (visibleTasks.length) {
        selectedIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex, visibleTasks.length - 1);
      } else {
        selectedIndex = -1;
      }

      list.innerHTML = "";
      visibleTasks.forEach((task, index) => {
        const row = createTaskRow(task, params);
        row.addEventListener("mouseenter", () => {
          selectedIndex = index;
          syncSelectedRow();
        });
        list.appendChild(row);
      });
      syncSelectedRow();

      const hasRows = visibleTasks.length > 0;
      list.hidden = !hasRows;
      empty.hidden = hasRows || loading || Boolean(error);

      if (clearButton) {
        clearButton.hidden = !query;
      }

      if (loading) {
        setStatus("Loading tasks...");
      } else if (error) {
        setStatus(error);
      } else if (!tasks.length) {
        setStatus("");
        empty.hidden = false;
        empty.textContent = requiredVariables.length && sourceTaskCount
          ? `No tasks match ${requiredVariables.join(", ")}.`
          : "No saved tasks yet.";
      } else if (query && !hasRows) {
        setStatus("");
        empty.hidden = false;
        empty.textContent = "No tasks match this search.";
      } else {
        const noun = visibleTasks.length === 1 ? "task" : "tasks";
        setStatus(`${visibleTasks.length} ${noun}`);
      }
    }

    async function loadTasks() {
      loading = true;
      error = "";
      render();
      try {
        const response = await fetch("/api/tasks", {
          cache: "no-store"
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !Array.isArray(payload.items)) {
          throw new Error("Failed to load tasks.");
        }
        sourceTaskCount = payload.items.length;
        tasks = payload.items.filter((task) => taskMatchesRequiredVariables(task, requiredVariables));
      } catch (loadError) {
        tasks = [];
        sourceTaskCount = 0;
        error = loadError && loadError.message ? loadError.message : "Failed to load tasks.";
      } finally {
        loading = false;
        render();
      }
    }

    if (searchInput) {
      searchInput.addEventListener("input", render);
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSelection(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSelection(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          openSelectedResult();
          return;
        }
        if (event.key === "Home" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          selectResult(0);
          return;
        }
        if (event.key === "End" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          selectResult(visibleTasks.length - 1);
        }
      });
      window.requestAnimationFrame(() => {
        searchInput.focus();
        searchInput.select();
      });
    }
    if (clearButton && searchInput) {
      clearButton.addEventListener("click", () => {
        searchInput.value = "";
        render();
        searchInput.focus();
      });
    }

    loadTasks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTasker, { once: true });
  } else {
    initTasker();
  }
})(window, document);
