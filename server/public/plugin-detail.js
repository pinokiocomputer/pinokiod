(function () {
  const bootstrapNode = document.getElementById("plugin-detail-bootstrap");
  if (!bootstrapNode) {
    return;
  }

  let bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapNode.textContent || "{}");
  } catch (_) {
    return;
  }

  const plugin = bootstrap.plugin || {};
  let share = bootstrap.share || {};
  const apps = Array.isArray(bootstrap.apps) ? bootstrap.apps : [];
  const stateUrl = typeof bootstrap.stateUrl === "string" ? bootstrap.stateUrl : "";

  const ACTION_LABELS = {
    install: "Install",
    uninstall: "Uninstall",
    update: "Update"
  };
  const ACTION_ICONS = {
    install: "fa-solid fa-download",
    uninstall: "fa-solid fa-trash-can",
    update: "fa-solid fa-rotate-right"
  };

  const noteEl = document.querySelector("[data-plugin-share-note]");
  const nextTitleEl = document.querySelector("[data-plugin-share-next-title]");
  const nextCopyEl = document.querySelector("[data-plugin-share-next-copy]");
  const nextActionsEl = document.querySelector("[data-plugin-share-next-actions]");
  const createForm = document.querySelector("[data-plugin-share-create-form]");
  const createCancel = document.querySelector("[data-plugin-share-create-cancel]");
  const repoNameInput = document.querySelector("[data-plugin-share-repo-name]");
  const visibilitySelect = document.querySelector("[data-plugin-share-visibility]");
  const remoteLink = document.querySelector("[data-plugin-share-remote-link]");
  const refreshButton = document.querySelector("[data-plugin-share-refresh]");
  const shareCopyEl = document.querySelector("[data-plugin-share-copy]");
  const feedback = document.querySelector("[data-plugin-share-feedback]");
  const overlay = document.querySelector("[data-plugin-share-overlay]");
  const overlayFrame = document.querySelector("[data-plugin-share-overlay-frame]");
  const overlayTitle = document.querySelector("[data-plugin-share-overlay-title]");
  const overlayCopy = document.querySelector("[data-plugin-share-overlay-copy]");
  const overlayCloseButtons = document.querySelectorAll("[data-plugin-share-overlay-close]");
  const overlayRefresh = document.querySelector("[data-plugin-share-overlay-refresh]");

  let refreshInFlight = false;
  let createFormOpen = false;

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value || "";
    return div.innerHTML;
  }

  function slugify(value) {
    const normalized = typeof value === "string" ? value : "";
    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return slug || "plugin";
  }

  function humanizeCount(count) {
    const value = Number.isFinite(Number(count)) ? Number(count) : 0;
    return `${value} local change${value === 1 ? "" : "s"}`;
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
    button.dataset.pluginShareAction = action || "";
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

  function buildActionUrl(actionType) {
    if (!plugin || !plugin.pluginPath) return null;
    const normalizedPath = plugin.pluginPath.startsWith("/") ? plugin.pluginPath.slice(1) : plugin.pluginPath;
    if (!normalizedPath) return null;
    const encodedPath = normalizedPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `/action/${encodeURIComponent(actionType)}/${encodedPath}?ts=${Date.now()}`;
  }

  function showActionModal(actionType) {
    const targetUrl = buildActionUrl(actionType);
    if (!targetUrl) {
      alert("This action is missing a target script.");
      return;
    }
    const pluginTitle = plugin && plugin.title ? plugin.title : "Plugin";
    const title = `${ACTION_LABELS[actionType] || "Run"} ${escapeHtml(pluginTitle)}`;
    const subtitle = plugin && plugin.description ? escapeHtml(plugin.description) : "";
    const iconClass = ACTION_ICONS[actionType] || "fa-solid fa-terminal";
    const modalHtml = `
      <div class="pinokio-modal-surface">
        <div class="pinokio-modal-header">
          <div class="pinokio-modal-icon"><i class="${iconClass}"></i></div>
          <div class="pinokio-modal-heading">
            <div class="pinokio-modal-title">${title}</div>
            <div class="pinokio-modal-subtitle">${subtitle}</div>
          </div>
        </div>
        <div class="pinokio-modal-body pinokio-modal-body--iframe">
          <iframe src="${targetUrl}" allow="fullscreen *;" allowfullscreen></iframe>
        </div>
        <div class="pinokio-modal-footer pinokio-modal-footer--publish" data-publish-footer>
          <button type="button" class="pinokio-publish-close-btn" data-publish-close>Close</button>
        </div>
      </div>
    `;

    Swal.fire({
      html: modalHtml,
      customClass: {
        popup: "pinokio-modern-modal",
        htmlContainer: "pinokio-modern-html",
        closeButton: "pinokio-modern-close"
      },
      backdrop: "rgba(9,11,15,0.65)",
      width: "min(760px, 90vw)",
      showConfirmButton: false,
      showCloseButton: true,
      buttonsStyling: false,
      focusConfirm: false,
      didOpen: (popup) => {
        const iframe = popup.querySelector("iframe");
        const closeBtn = popup.querySelector("[data-publish-close]");
        if (iframe) {
          iframe.dataset.forceVisible = "true";
          iframe.classList.remove("hidden");
          iframe.removeAttribute("hidden");
        }
        if (closeBtn) {
          closeBtn.addEventListener("click", () => {
            Swal.close();
          });
        }
      }
    });
  }

  function createPluginModal(appList) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay url-modal-overlay plugin-modal-overlay";
    const pluginTitle = plugin && plugin.title ? plugin.title : "Plugin";
    let pluginArt = '<div class="plugin-modal-art plugin-modal-art-fallback" aria-hidden="true"><i class="fa-solid fa-plug"></i></div>';
    if (plugin && plugin.image) {
      pluginArt = `<img class="plugin-modal-art" src="${escapeHtml(plugin.image)}" alt="${escapeHtml(pluginTitle)} icon">`;
    } else if (plugin && plugin.icon) {
      pluginArt = `<div class="plugin-modal-art plugin-modal-art-icon" aria-hidden="true"><i class="${plugin.icon}"></i></div>`;
    }
    overlay.innerHTML = `
      <div class="url-modal-content plugin-modal-content" role="dialog" aria-modal="true" aria-labelledby="plugin-modal-title" aria-describedby="plugin-modal-description">
        <div class="plugin-modal-header">
          <div class="plugin-modal-heading">
            <div class="plugin-modal-title-row">
              ${pluginArt}
              <h3 id="plugin-modal-title">Run ${escapeHtml(pluginTitle)}</h3>
            </div>
            <p class="url-modal-description plugin-modal-description" id="plugin-modal-description">Choose a project to launch this plugin in.</p>
          </div>
          <button type="button" class="url-modal-close plugin-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="plugin-modal-search-shell">
          <div class="plugin-modal-input-wrap">
            <i class="fa-solid fa-magnifying-glass plugin-modal-search-icon" aria-hidden="true"></i>
            <input type="search" class="url-modal-input plugin-modal-input" placeholder="Filter projects" autocomplete="off" />
          </div>
          <div class="url-dropdown plugin-modal-dropdown"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector(".url-modal-close");
    const titleEl = overlay.querySelector("#plugin-modal-title");
    const descriptionEl = overlay.querySelector("#plugin-modal-description");
    const inputEl = overlay.querySelector(".url-modal-input");
    const dropdownEl = overlay.querySelector(".plugin-modal-dropdown");

    const state = {
      apps: Array.isArray(appList) ? appList : [],
      selectedIndex: -1,
      selectedElement: null,
      visibleIndices: []
    };

    function clearSelection() {
      if (state.selectedElement) {
        state.selectedElement.classList.remove("selected");
      }
      state.selectedElement = null;
      state.selectedIndex = -1;
    }

    function ensureVisible(element) {
      if (!element) return;
      element.scrollIntoView({ block: "nearest" });
    }

    function select(index, element, { autoLaunch = false } = {}) {
      if (state.selectedElement && state.selectedElement !== element) {
        state.selectedElement.classList.remove("selected");
      }
      state.selectedElement = element || null;
      state.selectedIndex = typeof index === "number" ? index : -1;
      if (state.selectedElement) {
        state.selectedElement.classList.add("selected");
        if (autoLaunch) {
          confirm();
        }
      }
    }

    function buildOption(app, index) {
      const option = document.createElement("div");
      option.className = "url-dropdown-item plugin-option";
      option.setAttribute("data-app-index", index);
      option.tabIndex = 0;
      const iconHtml = app.icon
        ? `<img class="option-icon" src="${escapeHtml(app.icon)}" alt="${escapeHtml(app.title || app.name || "App")} icon">`
        : '<div class="option-icon"><i class="fa-solid fa-folder"></i></div>';
      const description = app.description ? `<div class="option-description">${escapeHtml(app.description)}</div>` : "";
      const pathLabel = app.displayPath || app.cwd || "";
      option.innerHTML = `
        ${iconHtml}
        <div class="option-body">
          <div class="option-name">${escapeHtml(app.title || app.name || "Project")}</div>
          <div class="option-path">${escapeHtml(pathLabel)}</div>
          ${description}
        </div>
        <div class="option-action" aria-hidden="true">
          <i class="fa-solid fa-chevron-right"></i>
        </div>
      `;
      return option;
    }

    function renderList(query) {
      const term = (query || "").toLowerCase().trim();
      dropdownEl.innerHTML = "";
      dropdownEl.style.display = "grid";
      state.visibleIndices = [];
      clearSelection();
      overlay.classList.remove("has-results", "has-empty");

      const matches = [];
      for (let i = 0; i < state.apps.length; i++) {
        const app = state.apps[i];
        const searchable = [app.title, app.name, app.description, app.displayPath, app.cwd]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!term || searchable.includes(term)) {
          matches.push({ app, index: i });
        }
      }

      if (matches.length === 0) {
        overlay.classList.add("has-empty");
        dropdownEl.innerHTML = `
          <div class="url-dropdown-empty plugin-modal-empty">
            <div class="plugin-modal-empty-title">No matching projects</div>
            <div class="plugin-modal-empty-copy">Try a different name or create a project first.</div>
          </div>
        `;
        return;
      }

      overlay.classList.add("has-results");
      const fragment = document.createDocumentFragment();
      matches.forEach(({ app, index }) => {
        const option = buildOption(app, index);
        state.visibleIndices.push(index);
        option.addEventListener("click", () => {
          select(index, option, { autoLaunch: true });
        });
        option.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(index, option, { autoLaunch: true });
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            navigate(event.key === "ArrowDown" ? 1 : -1);
          }
        });
        fragment.appendChild(option);
      });
      dropdownEl.appendChild(fragment);
    }

    function navigate(delta) {
      if (state.visibleIndices.length === 0) return;
      const currentPos = state.visibleIndices.indexOf(state.selectedIndex);
      let nextPos;
      if (currentPos === -1) {
        nextPos = delta > 0 ? 0 : state.visibleIndices.length - 1;
      } else {
        nextPos = currentPos + delta;
        if (nextPos < 0) nextPos = 0;
        if (nextPos >= state.visibleIndices.length) nextPos = state.visibleIndices.length - 1;
      }
      const nextIndex = state.visibleIndices[nextPos];
      const element = dropdownEl.querySelector(`[data-app-index="${nextIndex}"]`);
      if (element) {
        select(nextIndex, element, { autoLaunch: false });
        element.focus();
        ensureVisible(element);
      }
    }

    function closeModal() {
      overlay.classList.remove("is-visible");
      overlay.classList.remove("has-results", "has-empty");
      document.removeEventListener("keydown", handleKeydown, true);
      window.setTimeout(() => {
        dropdownEl.innerHTML = "";
        dropdownEl.style.display = "none";
        inputEl.value = "";
        clearSelection();
      }, 150);
    }

    function confirm() {
      if (state.selectedIndex === -1) {
        return;
      }
      const app = state.apps[state.selectedIndex];
      if (!plugin || !plugin.pluginPath) {
        closeModal();
        alert("This plugin is missing a launch target.");
        return;
      }
      if (!app) {
        closeModal();
        alert("Select a project to continue.");
        return;
      }
      const queryPairs = [];
      const pushPair = (key, value, { rawValue = false } = {}) => {
        if (value === undefined || value === null) {
          return;
        }
        const encodedKey = encodeURIComponent(key);
        const encodedValue = rawValue ? String(value) : encodeURIComponent(String(value));
        queryPairs.push(`${encodedKey}=${encodedValue}`);
      };
      pushPair("plugin", plugin.pluginPath, { rawValue: true });
      if (Array.isArray(plugin.extraParams)) {
        plugin.extraParams.forEach(([key, value]) => {
          pushPair(key, value);
        });
      }
      const queryString = queryPairs.join("&");
      const target = queryPairs.length > 0 ? `/p/${app.name}/dev?${queryString}` : `/p/${app.name}/dev`;
      closeModal();
      location.href = target;
    }

    function handleKeydown(event) {
      if (!overlay.classList.contains("is-visible")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        navigate(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "Enter" && document.activeElement === inputEl) {
        event.preventDefault();
        if (state.visibleIndices.length === 1 && state.selectedIndex === -1) {
          const nextIndex = state.visibleIndices[0];
          const element = dropdownEl.querySelector(`[data-app-index="${nextIndex}"]`);
          select(nextIndex, element, { autoLaunch: true });
        } else if (state.selectedIndex !== -1) {
          confirm();
        }
      }
    }

    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal();
      }
    });
    inputEl.addEventListener("input", (event) => {
      renderList(event.target.value);
    });

    return {
      open() {
        titleEl.textContent = plugin && plugin.title ? `Run ${plugin.title}` : "Run Plugin";
        if (state.apps.length === 0) {
          descriptionEl.textContent = "No projects found under ~/pinokio/api. Create or download a project to continue.";
        } else {
          descriptionEl.textContent = "Choose a project to launch this plugin in.";
        }
        renderList("");
        dropdownEl.style.display = "grid";
        overlay.classList.add("is-visible");
        document.addEventListener("keydown", handleKeydown, true);
        requestAnimationFrame(() => {
          inputEl.focus();
          inputEl.select();
        });
      }
    };
  }

  const pluginModal = createPluginModal(apps);

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
        body: JSON.stringify({ workspacePath: share.dir })
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
        copy: "Connect GitHub to publish this plugin source.",
        actions: [
          { label: "Open GitHub", icon: "fa-brands fa-github", href: "/github", newTab: true, primary: true },
          { label: "Check again", icon: "fa-solid fa-rotate-right", action: "refresh" }
        ]
      };
    }
    if (!share.gitInitialized) {
      return {
        title: "Start tracking",
        copy: "Start version tracking for this plugin folder.",
        actions: [
          { label: "Start tracking", icon: "fa-solid fa-code-branch", action: "init", primary: true }
        ]
      };
    }
    if (!share.hasCommit) {
      return {
        title: "Save first version",
        copy: "Save the first version before you connect a repository.",
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
          : "Create a GitHub repo to publish this plugin source.",
        actions: [
          { label: "Create on GitHub", icon: "fa-brands fa-github", action: "create", primary: true }
        ]
      };
    }
    if (Number(share.changeCount || 0) > 0) {
      return {
        title: "Publish changes",
        copy: `${humanizeCount(share.changeCount)} are still local.`,
        actions: [
          { label: "Publish changes", icon: "fa-brands fa-github", action: "publish", primary: true }
        ]
      };
    }
    return {
      title: "Source repo ready",
      copy: "This plugin source is connected and up to date on GitHub.",
      actions: []
    };
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
      repoNameInput.value = slugify(plugin.title || "plugin");
    }
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

  function renderRemoteState() {
    if (noteEl) {
      if (!share.manageable) {
        noteEl.textContent = "Read only";
      } else if (share.remoteWebUrl) {
        noteEl.textContent = "Connected";
      } else if (share.gitInitialized) {
        noteEl.textContent = "Local only";
      } else {
        noteEl.textContent = "Setup needed";
      }
    }
    if (remoteLink) {
      if (share.remoteWebUrl) {
        remoteLink.href = share.remoteWebUrl;
        remoteLink.classList.remove("task-hidden", "is-disabled");
        remoteLink.removeAttribute("aria-disabled");
      } else {
        remoteLink.href = "#";
        remoteLink.classList.add("task-hidden", "is-disabled");
        remoteLink.setAttribute("aria-disabled", "true");
      }
    }
    if (shareCopyEl) {
      if (!share.manageable) {
        shareCopyEl.textContent = "";
      } else if (!share.remoteUrl) {
        shareCopyEl.textContent = "Create a GitHub repo when you're ready to publish this plugin source.";
      } else if (Number(share.changeCount || 0) > 0) {
        shareCopyEl.textContent = "Publish the local changes if you want GitHub to match this plugin folder.";
      } else {
        shareCopyEl.textContent = "GitHub is in sync with this local plugin folder.";
      }
    }
  }

  function render() {
    if (!share.manageable) {
      return;
    }
    renderNextStep();
    renderRemoteState();
    syncCreateFormState();
  }

  function handleShareAction(action) {
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
        copy: "Create the repository in this panel, then click Done, check again.",
        src: createUrl
      });
      return;
    }
    if (action === "publish") {
      openOverlay({
        title: "Publish changes",
        copy: "Publish the latest plugin changes in this panel, then click Done, check again.",
        src: share.pushUrl
      });
    }
  }

  const openButton = document.querySelector("[data-plugin-open]");
  if (openButton) {
    openButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (!apps.length) {
        alert("No projects found under ~/pinokio/api.");
        return;
      }
      pluginModal.open();
    });
  }

  document.querySelectorAll("[data-plugin-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const actionType = button.getAttribute("data-plugin-action");
      if (!actionType) {
        return;
      }
      showActionModal(actionType);
    });
  });

  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-plugin-share-action]");
    if (!actionTarget) {
      return;
    }
    event.preventDefault();
    handleShareAction(actionTarget.getAttribute("data-plugin-share-action"));
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", (event) => {
      event.preventDefault();
      handleShareAction("refresh");
    });
  }

  if (createCancel) {
    createCancel.addEventListener("click", (event) => {
      event.preventDefault();
      handleShareAction("create-cancel");
    });
  }

  if (createForm) {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleShareAction("submit-create");
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
