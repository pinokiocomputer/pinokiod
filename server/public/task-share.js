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

  const nextTitleEl = document.querySelector("[data-task-share-next-title]");
  const nextCopyEl = document.querySelector("[data-task-share-next-copy]");
  const nextActionsEl = document.querySelector("[data-task-share-next-actions]");
  const createCancel = document.querySelector("[data-task-share-create-cancel]");
  const linkInput = document.getElementById("task-share-link");
  const linkCopy = document.querySelector("[data-task-share-copy]");
  const linkNote = document.querySelector("[data-task-share-link-note]");
  const linkCopyEl = document.querySelector("[data-task-share-link-copy]");
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

  let refreshInFlight = false;
  let createFormOpen = false;

  function humanizeCount(count) {
    const value = Number.isFinite(Number(count)) ? Number(count) : 0;
    return `${value} local change${value === 1 ? "" : "s"}`;
  }

  function humanizeVersionCount(count) {
    const value = Number.isFinite(Number(count)) ? Number(count) : 0;
    return `${value} saved version${value === 1 ? "" : "s"}`;
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
    overlayTitle.textContent = title || "GitHub flow";
    overlayCopy.textContent = copy || "Finish the flow in this panel, then click Done, check again.";
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
      showFeedback("Refreshing status...", "info");
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
        showFeedback("Status updated.", "success");
      }
    } catch (error) {
      if (!opts.quiet) {
        showFeedback(error && error.message ? error.message : "Failed to refresh status.", "error");
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
        throw new Error(payload && payload.error ? payload.error : "Failed to initialize git.");
      }
      showFeedback("Git tracking started.", "success");
      refreshState({ quiet: true });
    } catch (error) {
      showFeedback(error && error.message ? error.message : "Failed to initialize git.", "error");
    }
  }

  function buildCreateRepoUrl() {
    const name = repoNameInput ? repoNameInput.value.trim() : "";
    if (!name) {
      showFeedback("Repository name is required.", "error");
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
        title: "Connect GitHub",
        copy: "Connect GitHub to publish this task.",
        actions: [
          { label: "Open GitHub", icon: "fa-brands fa-github", href: "/github", newTab: true, primary: true },
          { label: "Check again", icon: "fa-solid fa-rotate-right", action: "refresh" }
        ]
      };
    }
    if (!share.gitInitialized) {
      return {
        title: "Start tracking",
        copy: "Start version tracking for this task.",
        actions: [
          { label: "Start tracking", icon: "fa-solid fa-code-branch", action: "init", primary: true }
        ]
      };
    }
    if (!share.hasCommit) {
      return {
        title: "Save first version",
        copy: "Save the first version.",
        actions: [
          { label: "Save version", icon: "fa-solid fa-floppy-disk", action: "commit", primary: true }
        ]
      };
    }
    if (Number(share.changeCount || 0) > 0) {
      return {
        title: "Save changes",
        copy: `${humanizeCount(share.changeCount)} still need to be saved before publishing.`,
        actions: [
          { label: "Save version", icon: "fa-solid fa-floppy-disk", action: "commit", primary: true }
        ]
      };
    }
    if (!share.remoteUrl) {
      return {
        title: "Create GitHub repo",
        copy: createFormOpen
          ? "Choose the repository name, then continue."
          : "Create a GitHub repo and publish the first version.",
        actions: [
          { label: "Create on GitHub", icon: "fa-brands fa-github", action: "create", primary: true }
        ]
      };
    }
    if (!share.hasPublished) {
      return {
        title: "Publish first version",
        copy: "The GitHub repo exists, but the first version is not live yet.",
        actions: [
          { label: "Publish first version", icon: "fa-brands fa-github", action: "publish", primary: true }
        ]
      };
    }
    if (Number(share.aheadCount || 0) > 0) {
      return {
        title: "Publish changes",
        copy: `${humanizeVersionCount(share.aheadCount)} are still local.`,
        actions: [
          { label: "Publish changes", icon: "fa-brands fa-github", action: "publish", primary: true }
        ]
      };
    }
    return {
      title: "Ready to share",
      copy: "Copy the link below to share this task.",
      actions: []
    };
  }

  function renderNextStep() {
    if (!nextTitleEl || !nextCopyEl || !nextActionsEl) {
      return;
    }
    const next = computeNextStep();
    nextTitleEl.textContent = next.title;
    nextCopyEl.textContent = next.copy;
    clearNode(nextActionsEl);
    nextActionsEl.classList.toggle("task-hidden", !next.actions.length);
    next.actions.forEach((action) => {
      nextActionsEl.appendChild(createButton(action));
    });
  }

  function renderShareLink() {
    const hasShareUrl = Boolean(share.shareUrl) && Boolean(share.hasPublished);
    const linkBox = document.querySelector("[data-task-share-link-box]");
    if (linkInput) {
      linkInput.value = hasShareUrl ? share.shareUrl : "";
      linkInput.placeholder = hasShareUrl ? "" : "Publish this task to GitHub to unlock a shareable link.";
    }
    if (linkBox) {
      linkBox.classList.toggle("task-hidden", !hasShareUrl);
    }
    if (linkCopy) {
      linkCopy.disabled = !hasShareUrl;
    }
    if (linkNote) {
      if (share.remoteUrl && !share.hasPublished) {
        linkNote.textContent = "Remote created";
      } else if (hasShareUrl && (Number(share.changeCount || 0) > 0 || Number(share.aheadCount || 0) > 0)) {
        linkNote.textContent = "Out of date";
      } else {
        linkNote.textContent = hasShareUrl ? "Published" : "Not published";
      }
    }
    if (linkCopyEl) {
      if (!hasShareUrl) {
        linkCopyEl.classList.remove("task-hidden");
        linkCopyEl.textContent = share.remoteUrl && !share.hasPublished
          ? "Publish the first version to unlock a shareable task link."
          : "";
        if (!linkCopyEl.textContent) {
          linkCopyEl.classList.add("task-hidden");
        }
      } else {
        linkCopyEl.classList.remove("task-hidden");
        if (Number(share.changeCount || 0) > 0) {
          linkCopyEl.textContent = "Save and publish if you want people to get the latest version.";
        } else if (Number(share.aheadCount || 0) > 0) {
          linkCopyEl.textContent = "Publish first if you want people to get the latest version.";
        } else {
          linkCopyEl.textContent = "Anyone with Pinokio can open this link.";
        }
      }
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
        title: "Save version",
        copy: "Finish saving a version in this panel, then click Done, check again.",
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
        title: "Create GitHub repository",
        copy: "Create the repository and publish the first version in this panel, then click Done, check again.",
        src: createUrl
      });
      return;
    }
    if (action === "publish") {
      openOverlay({
        title: "Publish changes",
        copy: "Publish the latest task changes in this panel, then click Done, check again.",
        src: share.pushUrl
      });
      return;
    }
    if (action === "copy-link") {
      if (!share.shareUrl) {
        showFeedback("This task does not have a share link yet.", "error");
        return;
      }
      try {
        await copyText(share.shareUrl);
        showFeedback("Share link copied.", "success");
      } catch (_) {
        showFeedback("Copy failed.", "error");
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

  render();
})();
