(function(window, document) {
  "use strict";

  function normalizePath(value) {
    return typeof value === "string" && value.trim()
      ? value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
      : "";
  }

  function isPathWithin(candidate, parent) {
    const normalizedCandidate = normalizePath(candidate);
    const normalizedParent = normalizePath(parent);
    if (!normalizedCandidate || !normalizedParent) {
      return false;
    }
    if (normalizedCandidate === normalizedParent) {
      return true;
    }
    return normalizedCandidate.startsWith(`${normalizedParent}/`);
  }

  function getFirstPromptLine(prompt) {
    const lines = String(prompt || "").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line) {
        return line;
      }
    }
    return "";
  }

  function getWorkspaceName(cwd) {
    const normalized = normalizePath(cwd);
    if (!normalized) {
      return "";
    }
    const segments = normalized.split("/").filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : "";
  }

  function suggestTitle(prompt, cwd) {
    const firstLine = getFirstPromptLine(prompt);
    if (firstLine) {
      return firstLine.slice(0, 120);
    }
    const workspaceName = getWorkspaceName(cwd);
    return workspaceName ? `Task for ${workspaceName}` : "New task";
  }

  function getPrompt() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return typeof params.get("prompt") === "string"
        ? params.get("prompt").trim()
        : "";
    } catch (_) {
      return "";
    }
  }

  function openTaskBuilder(url) {
    const popup = window.open(url.toString(), "_blank", "noopener");
    if (!popup) {
      window.location.href = url.toString();
    }
  }

  function initRunTaskSave() {
    const button = document.querySelector("[data-save-task-button]");
    const body = document.body;
    if (!button || !body) {
      return;
    }

    const cwd = body.dataset.taskSaveCwd || "";
    const workspacesRoot = body.dataset.taskSaveWorkspacesRoot || "";
    const prompt = getPrompt();
    if (!cwd || !workspacesRoot || !prompt) {
      return;
    }

    const normalizedCwd = normalizePath(cwd);
    const normalizedRoot = normalizePath(workspacesRoot);
    if (!isPathWithin(normalizedCwd, normalizedRoot) || normalizedCwd === normalizedRoot) {
      return;
    }

    const url = new URL("/tasks/new", window.location.origin);
    url.searchParams.set("path", "workspaces");
    url.searchParams.set("lockPath", "1");
    url.searchParams.set("title", suggestTitle(prompt, normalizedCwd));
    url.searchParams.set("template", prompt);
    url.searchParams.set("sourceWorkspaceCwd", cwd);

    button.hidden = false;
    button.classList.remove("hidden");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openTaskBuilder(url);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRunTaskSave, { once: true });
  } else {
    initRunTaskSave();
  }
})(window, document);
