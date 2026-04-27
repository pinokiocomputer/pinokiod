(function () {
  if (window.__PinokioDraftsLoaded) {
    return;
  }
  window.__PinokioDraftsLoaded = true;

  const context = window.PinokioDraftContext || {};
  const activeCwd = typeof context.cwd === "string" ? context.cwd.trim() : "";
  if (!activeCwd) {
    return;
  }
  const PUSH_ENDPOINT = "/push";
  const SOUND_PREF_STORAGE_KEY = "pinokio:idle-sound";
  const SOUND_SILENT_CHOICE = "__silent__";
  const DRAFT_NOTIFIED_PREFIX = "pinokio:draft-notified:";
  const state = {
    expanded: new Set(),
    initialRefreshComplete: false,
    items: [],
    lastSignature: "",
    notifiedIds: new Set()
  };

  function resolveNotificationSound() {
    try {
      const raw = localStorage.getItem(SOUND_PREF_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const choice = parsed && typeof parsed.choice === "string" ? parsed.choice.trim() : "";
      if (choice === SOUND_SILENT_CHOICE) {
        return false;
      }
      const withLeading = choice.startsWith("/") ? choice : `/${choice}`;
      const decoded = decodeURIComponent(withLeading);
      if (decoded.startsWith("/sound/") && !decoded.includes("..")) {
        return withLeading;
      }
    } catch (_) {}
    return true;
  }

  function claimDraftNotification(id) {
    const normalized = typeof id === "string" ? id.trim() : "";
    if (!normalized) {
      return false;
    }
    if (state.notifiedIds.has(normalized)) {
      return false;
    }
    state.notifiedIds.add(normalized);
    try {
      const key = `${DRAFT_NOTIFIED_PREFIX}${normalized}`;
      if (localStorage.getItem(key)) {
        return false;
      }
      const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, token);
      return localStorage.getItem(key) === token;
    } catch (_) {
      return true;
    }
  }

  function notifyDraftReady(item) {
    if (!item || !claimDraftNotification(item.id)) {
      return;
    }
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Draft";
    const workspaceName = typeof item.workspaceName === "string" && item.workspaceName.trim() ? item.workspaceName.trim() : "";
    const message = workspaceName ? `${workspaceName}: ${title}` : `Draft ready: ${title}`;
    const sound = resolveNotificationSound();
    const playedInline = typeof window.PinokioPlayNotificationSound === "function"
      ? window.PinokioPlayNotificationSound(sound)
      : false;
    const payload = {
      title: "Pinokio",
      message,
      timeout: 60,
      sound: playedInline ? false : sound,
      audience: "device",
      device_id: (typeof window.PinokioGetDeviceId === "function") ? window.PinokioGetDeviceId() : undefined
    };
    try {
      fetch(PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (_) {
    }
  }

  function ensureStyles() {
    if (document.getElementById("pinokio-drafts-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "pinokio-drafts-style";
    style.textContent = `
      .pinokio-drafts {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(390px, calc(100vw - 24px));
        pointer-events: none;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .pinokio-draft-card {
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.96);
        box-shadow: 0 16px 42px rgba(2, 6, 23, 0.4);
        overflow: hidden;
        pointer-events: auto;
      }
      .pinokio-draft-head {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 12px 12px 10px;
      }
      .pinokio-draft-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border-radius: 7px;
        background: #0f766e;
        color: white;
        font-size: 14px;
      }
      .pinokio-draft-copy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .pinokio-draft-kicker {
        color: #99f6e4;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
        line-height: 1.2;
        margin-bottom: 3px;
      }
      .pinokio-draft-title {
        color: #f8fafc;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .pinokio-draft-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        margin-top: 7px;
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.25;
      }
      .pinokio-draft-close {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #cbd5e1;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }
      .pinokio-draft-close:hover,
      .pinokio-draft-close:focus {
        background: rgba(148, 163, 184, 0.16);
        color: #ffffff;
      }
      .pinokio-draft-preview {
        border-top: 1px solid rgba(148, 163, 184, 0.24);
        padding: 10px 12px 0;
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.45;
      }
      .pinokio-draft-path {
        margin-top: 8px;
        color: #94a3b8;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .pinokio-draft-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px 12px;
      }
      .pinokio-draft-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 30px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 6px;
        background: rgba(30, 41, 59, 0.92);
        color: #f8fafc;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.1;
        padding: 7px 10px;
        white-space: nowrap;
      }
      .pinokio-draft-button:hover,
      .pinokio-draft-button:focus {
        border-color: rgba(45, 212, 191, 0.7);
        background: rgba(15, 118, 110, 0.65);
      }
      .pinokio-draft-button.secondary {
        color: #dbeafe;
        background: transparent;
      }
      .pinokio-draft-more {
        align-self: flex-end;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(148, 163, 184, 0.35);
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.2;
        padding: 6px 10px;
        pointer-events: auto;
      }
      @media (max-width: 520px) {
        .pinokio-drafts {
          right: 12px;
          bottom: 12px;
        }
        .pinokio-draft-actions {
          flex-wrap: wrap;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getRoot() {
    ensureStyles();
    let root = document.getElementById("pinokio-drafts");
    if (!root) {
      root = document.createElement("div");
      root.id = "pinokio-drafts";
      root.className = "pinokio-drafts";
      root.setAttribute("aria-live", "polite");
      document.body.appendChild(root);
    }
    return root;
  }

  function removeRoot() {
    const root = document.getElementById("pinokio-drafts");
    if (root) {
      root.remove();
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  }

  function createIcon(name) {
    const icon = createElement("i", name);
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) {
      return "";
    }
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "";
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function getApiUrl() {
    const url = new URL("/drafts", window.location.origin);
    if (activeCwd) {
      url.searchParams.set("cwd", activeCwd);
    }
    return url.toString();
  }

  async function dismissItem(id) {
    if (!id) {
      return;
    }
    state.items = state.items.filter((item) => item.id !== id);
    state.expanded.delete(id);
    render();
    await fetch(`/drafts/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{}"
    }).catch(() => {});
  }

  async function openDraft(item, button) {
    if (!item || !item.postPath) {
      return;
    }
    const originalText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Opening...";
    }
    try {
      await fetch("/openfs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: item.postPath
        })
      });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || "Open draft";
      }
    }
  }

  function renderItem(item) {
    const card = createElement("div", "pinokio-draft-card");
    const head = createElement("div", "pinokio-draft-head");
    const iconWrap = createElement("div", "pinokio-draft-icon");
    iconWrap.appendChild(createIcon("fa-solid fa-file-lines"));

    const copy = createElement("div", "pinokio-draft-copy");
    copy.appendChild(createElement("div", "pinokio-draft-kicker", "Draft ready"));
    copy.appendChild(createElement("div", "pinokio-draft-title", item.title || "Draft"));

    const meta = createElement("div", "pinokio-draft-meta");
    const updatedAt = formatUpdatedAt(item.updatedAt);
    const postSize = formatBytes(item.postBytes);
    const mediaBits = [];
    if (item.workspaceName) {
      mediaBits.push(item.workspaceName);
    }
    if (updatedAt) {
      mediaBits.push(updatedAt);
    }
    if (postSize) {
      mediaBits.push(postSize);
    }
    const mediaCount = Number(item.mediaCount || 0);
    if (mediaCount > 0) {
      mediaBits.push(`${mediaCount} media ${mediaCount === 1 ? "file" : "files"}`);
    }
    const missingMedia = Number(item.missingMediaCount || 0);
    if (missingMedia > 0) {
      mediaBits.push(`${missingMedia} missing`);
    }
    meta.textContent = mediaBits.join(" / ");
    copy.appendChild(meta);

    const close = createElement("button", "pinokio-draft-close", "x");
    close.type = "button";
    close.title = "Dismiss";
    close.setAttribute("aria-label", "Dismiss draft");
    close.addEventListener("click", () => {
      void dismissItem(item.id);
    });

    head.appendChild(iconWrap);
    head.appendChild(copy);
    head.appendChild(close);
    card.appendChild(head);

    if (state.expanded.has(item.id)) {
      const preview = createElement("div", "pinokio-draft-preview");
      preview.appendChild(createElement("div", "", item.excerpt || "No preview available."));
      if (item.postPath) {
        preview.appendChild(createElement("div", "pinokio-draft-path", item.postPath));
      }
      card.appendChild(preview);
    }

    const actions = createElement("div", "pinokio-draft-actions");
    const openButton = createElement("button", "pinokio-draft-button", "Open draft");
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void openDraft(item, openButton);
    });

    const previewButton = createElement(
      "button",
      "pinokio-draft-button secondary",
      state.expanded.has(item.id) ? "Hide preview" : "Preview"
    );
    previewButton.type = "button";
    previewButton.addEventListener("click", () => {
      if (state.expanded.has(item.id)) {
        state.expanded.delete(item.id);
      } else {
        state.expanded.add(item.id);
      }
      render();
    });

    const dismissButton = createElement("button", "pinokio-draft-button secondary", "Dismiss");
    dismissButton.type = "button";
    dismissButton.addEventListener("click", () => {
      void dismissItem(item.id);
    });

    actions.appendChild(openButton);
    actions.appendChild(previewButton);
    actions.appendChild(dismissButton);
    card.appendChild(actions);

    return card;
  }

  function render() {
    const items = Array.isArray(state.items) ? state.items : [];
    if (items.length === 0) {
      removeRoot();
      state.lastSignature = "";
      return;
    }
    const root = getRoot();
    root.innerHTML = "";
    items.slice(0, 3).forEach((item) => {
      root.appendChild(renderItem(item));
    });
    if (items.length > 3) {
      root.appendChild(createElement("div", "pinokio-draft-more", `${items.length - 3} more drafts`));
    }
  }

  async function refresh() {
    try {
      const response = await fetch(getApiUrl(), {
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const items = payload && Array.isArray(payload.items) ? payload.items : [];
      const signature = items.map((item) => `${item.id}:${item.updatedAt}`).join("|");
      if (signature === state.lastSignature) {
        state.initialRefreshComplete = true;
        return;
      }
      const previousIds = new Set((Array.isArray(state.items) ? state.items : []).map((item) => item && item.id).filter(Boolean));
      const newItems = state.initialRefreshComplete
        ? items.filter((item) => item && item.id && !previousIds.has(item.id))
        : [];
      state.lastSignature = signature;
      state.items = items;
      render();
      newItems.forEach(notifyDraftReady);
      state.initialRefreshComplete = true;
    } catch (_) {
    }
  }

  function start() {
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    void refresh();
    window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refresh();
      }
    });
  }

  start();
})();
