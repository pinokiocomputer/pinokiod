(function () {
  const bootstrapNode = document.getElementById("task-share-bootstrap");
  if (!bootstrapNode) {
    return;
  }

  let bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapNode.textContent || "{}");
  } catch (_) {
    return;
  }

  const task = bootstrap.task || {};
  let share = bootstrap.share || {};
  const stateUrl = typeof bootstrap.stateUrl === "string" ? bootstrap.stateUrl : "";
  const I18N = window.PINOKIO_I18N || {};

  const nextWrapEl = document.querySelector("[data-task-share-next-wrap]");
  const nextCopyEl = document.querySelector("[data-task-share-next-copy]");
  const nextActionsEl = document.querySelector("[data-task-share-next-actions]");
  const createCancel = document.querySelector("[data-task-share-create-cancel]");
  const linkInput = document.getElementById("task-share-link");
  const linkCopy = document.querySelector("[data-task-share-copy]");
  const remoteLink = document.querySelector("[data-task-share-remote-link]");
  const refreshButtons = document.querySelectorAll("[data-task-share-refresh]");
  const feedback = document.querySelector("[data-task-share-feedback]");
  const createForm = document.querySelector("[data-task-share-create-form]");
  const repoNameInput = document.querySelector("[data-task-share-repo-name]");
  const visibilitySelect = document.querySelector("[data-task-share-visibility]");
  const overlay = document.querySelector("[data-task-share-overlay]");
  const overlayFrame = document.querySelector("[data-task-share-overlay-frame]");
  const overlayTitle = document.querySelector("[data-task-share-overlay-title]");
  const overlayCopy = document.querySelector("[data-task-share-overlay-copy]");
  const overlayCloseButtons = document.querySelectorAll("[data-task-share-overlay-close]");
  const overlayRefresh = document.querySelector("[data-task-share-overlay-refresh]");
  const renderedPromptEl = document.querySelector("[data-task-rendered-prompt]");
  const taskForm = document.querySelector(".task-run-form");
  const taskInputFields = taskForm
    ? Array.from(taskForm.querySelectorAll("[name^='input.']"))
    : [];
  const initialUrl = new URL(window.location.href);
  const initialRequestedId = initialUrl.searchParams.get("id") || "";
  const initialRequestedRef = initialUrl.searchParams.get("ref") || "";

  let refreshInFlight = false;
  let createFormOpen = false;
  let currentPermalink = "";
  let historyReplaceTimer = 0;

  function t(key, fallback, replacements = {}) {
    let value = typeof I18N[key] === "string" ? I18N[key] : `[missing translation: ${key}]`;
    Object.entries(replacements || {}).forEach(([name, replacement]) => {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
    });
    return value;
  }

  function humanizeCount(count) {
    const value = Number.isFinite(Number(count)) ? Number(count) : 0;
    return t(value === 1 ? "tasks.local_change_count_one" : "tasks.local_change_count", value === 1 ? "{count} local change" : "{count} local changes", { count: value });
  }

  function humanizeVersionCount(count) {
    const value = Number.isFinite(Number(count)) ? Number(count) : 0;
    return t(value === 1 ? "tasks.saved_version_count_one" : "tasks.saved_version_count", value === 1 ? "{count} saved version" : "{count} saved versions", { count: value });
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function applyTemplateValues(template, values) {
    let result = typeof template === "string" ? template : "";
    Object.entries(values || {}).forEach(([name, value]) => {
      if (value == null || String(value).trim() === "") {
        return;
      }
      const pattern = new RegExp(`{{\\s*${escapeRegExp(name)}\\s*}}`, "g");
      result = result.replace(pattern, String(value));
    });
    return result.replace(/\r\n?/g, "\n");
  }

  function slugify(value) {
    const normalized = typeof value === "string" ? value : "";
    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return slug || (task.id || "task");
  }

  function autoResizeTextarea(textarea) {
    if (!textarea || textarea.tagName !== "TEXTAREA") {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function collectInputValues() {
    return taskInputFields.reduce((values, field) => {
      if (!field || typeof field.name !== "string" || !field.name.startsWith("input.")) {
        return values;
      }
      values[field.name.slice("input.".length)] = field.value == null ? "" : String(field.value);
      return values;
    }, {});
  }

  function getPermalinkIdentity() {
    if (share.remoteRef) {
      return { key: "ref", value: share.remoteRef };
    }
    if (initialRequestedRef) {
      return { key: "ref", value: initialRequestedRef };
    }
    if (task.ref) {
      return { key: "ref", value: task.ref };
    }
    if (initialRequestedId) {
      return { key: "id", value: initialRequestedId };
    }
    if (task.id) {
      return { key: "id", value: task.id };
    }
    return { key: "", value: "" };
  }

  function buildCurrentTaskUrl() {
    const target = new URL(initialUrl.pathname || "/task", initialUrl.origin);
    const params = new URLSearchParams();
    const identity = getPermalinkIdentity();
    const inputValues = collectInputValues();
    if (identity.key && identity.value) {
      params.set(identity.key, identity.value);
    }
    Object.keys(inputValues).sort().forEach((name) => {
      const value = inputValues[name];
      if (value === "") {
        return;
      }
      params.set(`input.${name}`, value);
    });
    const query = params.toString();
    if (query) {
      target.search = query;
    }
    return target.toString();
  }

  function replaceHistoryUrl(nextUrl) {
    if (!nextUrl) {
      return;
    }
    const parsed = new URL(nextUrl);
    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath === currentPath) {
      return;
    }
    window.history.replaceState(null, "", nextPath);
  }

  function queueHistoryUrl(nextUrl, immediate) {
    window.clearTimeout(historyReplaceTimer);
    if (immediate) {
      replaceHistoryUrl(nextUrl);
      return;
    }
    historyReplaceTimer = window.setTimeout(() => {
      replaceHistoryUrl(nextUrl);
    }, 160);
  }

  function renderPromptPreview() {
    if (!renderedPromptEl) {
      return;
    }
    renderedPromptEl.textContent = applyTemplateValues(task.template || "", collectInputValues());
  }

  function syncTaskStateView(options) {
    const opts = options && typeof options === "object" ? options : {};
    currentPermalink = buildCurrentTaskUrl();
    if (linkInput) {
      linkInput.value = currentPermalink;
      autoResizeTextarea(linkInput);
    }
    renderPromptPreview();
    queueHistoryUrl(currentPermalink, opts.immediate === true);
  }

  function showFeedback(message, type) {
    if (!feedback) {
      return;
    }
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.dataset.state = type || "info";
    clearTimeout(showFeedback.timer);
    showFeedback.timer = window.setTimeout(() => {
      feedback.hidden = true;
      feedback.dataset.state = "";
    }, 2200);
  }

  async function copyText(text) {
    if (!text) {
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function createButton({ label, icon, action, primary, href, newTab }) {
    if (href) {
      const link = document.createElement("a");
      link.className = primary ? "task-link-button primary" : "task-link-button";
      link.href = href;
      if (newTab) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      if (icon) {
        const iconEl = document.createElement("i");
        iconEl.className = icon;
        iconEl.setAttribute("aria-hidden", "true");
        link.appendChild(iconEl);
      }
      const span = document.createElement("span");
      span.textContent = label;
      link.appendChild(span);
      return link;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "task-button primary" : "task-button";
    button.dataset.action = action || "";
    if (icon) {
      const iconEl = document.createElement("i");
      iconEl.className = icon;
      iconEl.setAttribute("aria-hidden", "true");
      button.appendChild(iconEl);
    }
    const span = document.createElement("span");
    span.textContent = label;
    button.appendChild(span);
    return button;
  }

  function openOverlay({ title, copy, src }) {
    if (!overlay || !overlayFrame) {
      if (src) {
        window.open(src, "_blank", "noopener,noreferrer");
      }
      return;
    }
    overlayTitle.textContent = title || t("tasks.github_flow", "GitHub flow");
    overlayCopy.textContent = copy || t("tasks.github_flow_panel_copy", "Finish the flow in this panel, then click Done, check again.");
    overlayFrame.src = src || "about:blank";
    overlay.classList.remove("task-hidden");
    document.body.classList.add("task-share-overlay-open");
  }

  function closeOverlay() {
    if (!overlay || !overlayFrame) {
      return;
    }
    overlay.classList.add("task-hidden");
    overlayFrame.src = "about:blank";
    document.body.classList.remove("task-share-overlay-open");
  }

  async function refreshState(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (!stateUrl || refreshInFlight) {
      return;
    }
    refreshInFlight = true;
    if (!opts.quiet) {
      showFeedback(t("tasks.refreshing_status", "Refreshing status..."), "info");
    }
    try {
      const response = await fetch(stateUrl, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
      }
      share = payload.share || {};
      render();
      if (!opts.quiet) {
        showFeedback(t("tasks.status_updated", "Status updated."), "success");
      }
    } catch (error) {
      if (!opts.quiet) {
        showFeedback(error && error.message ? error.message : t("tasks.failed_refresh_status", "Failed to refresh status."), "error");
      }
    } finally {
      refreshInFlight = false;
    }
  }

  async function initializeGit() {
    try {
      const response = await fetch("/terminals/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath: task.dir })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload && payload.error ? payload.error : t("tasks.failed_initialize_git", "Failed to initialize git."));
      }
      showFeedback(t("tasks.git_tracking_started", "Git tracking started."), "success");
      refreshState({ quiet: true });
    } catch (error) {
      showFeedback(error && error.message ? error.message : t("tasks.failed_initialize_git", "Failed to initialize git."), "error");
    }
  }

  function buildCreateRepoUrl() {
    const name = repoNameInput ? repoNameInput.value.trim() : "";
    if (!name) {
      showFeedback(t("tasks.repository_name_required", "Repository name is required."), "error");
      if (repoNameInput) {
        repoNameInput.focus();
      }
      return "";
    }
    const visibility = visibilitySelect ? visibilitySelect.value : "public";
    const separator = share.createUrl && share.createUrl.includes("?") ? "&" : "?";
    return `${share.createUrl}${separator}name=${encodeURIComponent(name)}&visibility=${encodeURIComponent(visibility)}&ts=${Date.now()}`;
  }

  function computeNextStep() {
    if (!share.githubConnected) {
      return {
        message: t("tasks.connect_github_to_publish_task", "Connect GitHub to publish this task."),
        actions: [
          { label: t("tasks.open_github", "Open GitHub"), icon: "fa-brands fa-github", href: "/github", newTab: true, primary: true },
          { label: t("tasks.check_again", "Check again"), icon: "fa-solid fa-rotate-right", action: "refresh" }
        ]
      };
    }
    if (!share.gitInitialized) {
      return {
        message: t("tasks.start_tracking_to_publish_task", "Start version tracking to publish this task."),
        actions: [
          { label: t("tasks.start_tracking", "Start tracking"), icon: "fa-solid fa-code-branch", action: "init", primary: true }
        ]
      };
    }
    if (!share.hasCommit) {
      return {
        message: t("tasks.save_first_version_to_publish_task", "Save the first version to publish this task."),
        actions: [
          { label: t("tasks.save_version", "Save version"), icon: "fa-solid fa-floppy-disk", action: "commit", primary: true }
        ]
      };
    }
    if (Number(share.changeCount || 0) > 0) {
      return {
        message: t("tasks.local_changes_need_save", "{count} still need to be saved before publishing.", { count: humanizeCount(share.changeCount) }),
        actions: [
          { label: t("tasks.save_version", "Save version"), icon: "fa-solid fa-floppy-disk", action: "commit", primary: true }
        ]
      };
    }
    if (!share.remoteUrl) {
      return {
        message: createFormOpen
          ? t("tasks.choose_repo_name_then_continue", "Choose the repository name, then continue.")
          : t("tasks.create_repo_publish_first", "Create a GitHub repo and publish the first version."),
        actions: [
          { label: t("tasks.create_on_github", "Create on GitHub"), icon: "fa-brands fa-github", action: "create", primary: true }
        ]
      };
    }
    if (!share.hasPublished) {
      return {
        message: t("tasks.publish_first_version_to_create_link", "Publish the first version to create a shareable link."),
        actions: [
          { label: t("tasks.publish_first_version", "Publish first version"), icon: "fa-brands fa-github", action: "publish", primary: true }
        ]
      };
    }
    if (Number(share.aheadCount || 0) > 0) {
      return {
        message: t("tasks.published_link_behind", "Published link is behind local changes."),
        actions: [
          { label: t("tasks.publish_changes", "Publish changes"), icon: "fa-brands fa-github", action: "publish", primary: true }
        ]
      };
    }
    return {
      message: "",
      actions: []
    };
  }

  function renderNextStep() {
    if (!nextWrapEl || !nextCopyEl || !nextActionsEl) {
      return;
    }
    const next = computeNextStep();
    nextCopyEl.textContent = next.message || "";
    clearNode(nextActionsEl);
    const hasMessage = Boolean(next.message);
    nextWrapEl.classList.toggle("task-hidden", !hasMessage && !next.actions.length);
    nextActionsEl.classList.toggle("task-hidden", !next.actions.length);
    next.actions.forEach((action) => {
      nextActionsEl.appendChild(createButton(action));
    });
  }

  function renderShareLink() {
    const hasPermalink = Boolean(currentPermalink);
    const linkBox = document.querySelector("[data-task-share-link-box]");
    if (linkInput) {
      linkInput.value = currentPermalink;
      linkInput.placeholder = "";
      autoResizeTextarea(linkInput);
    }
    if (linkBox) {
      linkBox.classList.toggle("task-hidden", !hasPermalink);
    }
    if (linkCopy) {
      linkCopy.disabled = !hasPermalink;
    }
    if (remoteLink) {
      if (share.remoteWebUrl) {
        remoteLink.href = share.remoteWebUrl;
        remoteLink.classList.remove("is-disabled", "task-hidden");
        remoteLink.removeAttribute("aria-disabled");
      } else {
        remoteLink.href = "#";
        remoteLink.classList.add("is-disabled", "task-hidden");
        remoteLink.setAttribute("aria-disabled", "true");
      }
    }
  }

  function syncCreateFormState() {
    const needsRemote = share.githubConnected && share.gitInitialized && share.hasCommit && !share.remoteUrl;
    if (!needsRemote) {
      createFormOpen = false;
    }
    if (createForm) {
      createForm.classList.toggle("task-hidden", !(needsRemote && createFormOpen));
    }
    if (repoNameInput && !repoNameInput.value) {
      repoNameInput.value = slugify(task.title || task.id || "task");
    }
  }

  function render() {
    syncTaskStateView({ immediate: true });
    renderNextStep();
    renderShareLink();
    syncCreateFormState();
  }

  async function handleAction(action) {
    if (!action) {
      return;
    }
    if (action === "refresh") {
      refreshState();
      return;
    }
    if (action === "init") {
      initializeGit();
      return;
    }
    if (action === "commit") {
      openOverlay({
        title: t("tasks.save_version", "Save version"),
        copy: t("tasks.save_version_panel_copy", "Finish saving a version in this panel, then click Done, check again."),
        src: share.commitUrl
      });
      return;
    }
    if (action === "create") {
      createFormOpen = true;
      render();
      if (repoNameInput) {
        requestAnimationFrame(() => {
          repoNameInput.focus();
          repoNameInput.select();
        });
      }
      return;
    }
    if (action === "create-cancel") {
      createFormOpen = false;
      render();
      return;
    }
    if (action === "submit-create") {
      const createUrl = buildCreateRepoUrl();
      if (!createUrl) {
        return;
      }
      openOverlay({
        title: t("tasks.create_github_repository", "Create GitHub repository"),
        copy: t("tasks.create_repository_panel_copy", "Create the repository and publish the first version in this panel, then click Done, check again."),
        src: createUrl
      });
      return;
    }
    if (action === "publish") {
      openOverlay({
        title: t("tasks.publish_changes", "Publish changes"),
        copy: t("tasks.publish_changes_panel_copy", "Publish the latest task changes in this panel, then click Done, check again."),
        src: share.pushUrl
      });
      return;
    }
    if (action === "copy-link") {
      if (!currentPermalink) {
        showFeedback(t("tasks.no_permalink", "This task does not have a permalink yet."), "error");
        return;
      }
      try {
        await copyText(currentPermalink);
        showFeedback(t("tasks.permalink_copied", "Permalink copied."), "success");
      } catch (_) {
        showFeedback(t("common.copy_failed", "Copy failed."), "error");
      }
      return;
    }
  }

  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) {
      event.preventDefault();
      handleAction(actionTarget.getAttribute("data-action"));
      return;
    }
    if (event.target.closest("[data-task-share-copy]")) {
      event.preventDefault();
      handleAction("copy-link");
      return;
    }
  });

  refreshButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refreshState();
    });
  });

  if (createForm) {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAction("submit-create");
    });
  }

  if (createCancel) {
    createCancel.addEventListener("click", () => {
      handleAction("create-cancel");
    });
  }

  overlayCloseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      closeOverlay();
    });
  });

  if (overlayRefresh) {
    overlayRefresh.addEventListener("click", () => {
      closeOverlay();
      refreshState();
    });
  }

  taskInputFields.forEach((field) => {
    field.addEventListener("input", () => {
      syncTaskStateView({ immediate: false });
      renderShareLink();
    });
    field.addEventListener("change", () => {
      syncTaskStateView({ immediate: false });
      renderShareLink();
    });
  });

  if (linkInput) {
    linkInput.addEventListener("focus", () => {
      linkInput.select();
    });
    linkInput.addEventListener("click", () => {
      linkInput.select();
    });
  }

  window.addEventListener("resize", () => {
    if (linkInput) {
      autoResizeTextarea(linkInput);
    }
  });

  render();
})();
