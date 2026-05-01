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
    notifiedIds: new Set(),
    drawerItemId: "",
    drawerTab: "preview"
  };
  let pendingRegistryImport = null;

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
    const notificationKey = item && item.id
      ? `${item.id}:${item.revision || item.updatedAt || ""}`
      : "";
    if (!item || !claimDraftNotification(notificationKey)) {
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
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .pinokio-draft-card {
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 38px rgba(15, 23, 42, 0.18);
        cursor: pointer;
        overflow: hidden;
        pointer-events: auto;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }
      .pinokio-draft-card:hover,
      .pinokio-draft-card:focus {
        border-color: rgba(15, 23, 42, 0.28);
        box-shadow: 0 16px 42px rgba(15, 23, 42, 0.22);
        outline: none;
        transform: translateY(-1px);
      }
      body.dark .pinokio-draft-card {
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(23, 23, 25, 0.96);
        box-shadow: 0 16px 42px rgba(0, 0, 0, 0.38);
      }
      body.dark .pinokio-draft-card:hover,
      body.dark .pinokio-draft-card:focus {
        border-color: rgba(251, 191, 36, 0.38);
        box-shadow: 0 18px 46px rgba(0, 0, 0, 0.46);
      }
      .pinokio-draft-head {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 14px 14px 16px;
      }
      .pinokio-draft-icon {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border-radius: 7px;
        background: #fef3c7;
        color: #a16207;
        font-size: 14px;
      }
      body.dark .pinokio-draft-icon {
        background: rgba(245, 158, 11, 0.18);
        color: #fbbf24;
      }
      .pinokio-draft-copy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .pinokio-draft-kicker {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #a16207;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
        line-height: 1.2;
        margin-bottom: 3px;
      }
      body.dark .pinokio-draft-kicker {
        color: #fbbf24;
      }
      .pinokio-draft-kicker i {
        font-size: 10px;
      }
      .pinokio-draft-title {
        color: #111827;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      body.dark .pinokio-draft-title {
        color: #f8fafc;
      }
      .pinokio-draft-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        margin-top: 7px;
        color: rgba(55, 65, 81, 0.78);
        font-size: 12px;
        line-height: 1.25;
      }
      body.dark .pinokio-draft-meta {
        color: rgba(212, 212, 216, 0.78);
      }
      .pinokio-draft-close {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(55, 65, 81, 0.74);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }
      body.dark .pinokio-draft-close {
        color: rgba(212, 212, 216, 0.78);
      }
      .pinokio-draft-close:hover,
      .pinokio-draft-close:focus {
        background: rgba(15, 23, 42, 0.06);
        color: #111827;
      }
      body.dark .pinokio-draft-close:hover,
      body.dark .pinokio-draft-close:focus {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }
      .pinokio-draft-preview {
        border-top: 1px solid rgba(15, 23, 42, 0.1);
        padding: 10px 12px 0;
        color: rgba(31, 41, 55, 0.9);
        font-size: 12px;
        line-height: 1.45;
      }
      body.dark .pinokio-draft-preview {
        border-top-color: rgba(255, 255, 255, 0.12);
        color: rgba(244, 244, 245, 0.9);
      }
      .pinokio-draft-path {
        margin-top: 8px;
        color: rgba(75, 85, 99, 0.82);
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      body.dark .pinokio-draft-path {
        color: rgba(161, 161, 170, 0.86);
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
        border: 1px solid var(--pinokio-chrome-accent-bg-light);
        border-radius: 6px;
        background: var(--pinokio-chrome-accent-bg-light);
        color: var(--pinokio-chrome-accent-fg-light);
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.1;
        padding: 7px 10px;
        white-space: nowrap;
      }
      .pinokio-draft-button:hover,
      .pinokio-draft-button:focus {
        border-color: color-mix(in srgb, var(--pinokio-chrome-accent-bg-light) 88%, #ffffff);
        background: color-mix(in srgb, var(--pinokio-chrome-accent-bg-light) 88%, #ffffff);
      }
      body.dark .pinokio-draft-button {
        border-color: #fbbf24;
        background: #fbbf24;
        color: var(--universal-launcher-surface-solid, #0a0a0b);
      }
      body.dark .pinokio-draft-button:hover,
      body.dark .pinokio-draft-button:focus {
        border-color: color-mix(in srgb, #fbbf24 90%, #ffffff);
        background: color-mix(in srgb, #fbbf24 90%, #ffffff);
        color: var(--universal-launcher-surface-solid, #0a0a0b);
      }
      .pinokio-draft-button.secondary {
        border-color: rgba(15, 23, 42, 0.14);
        color: #374151;
        background: rgba(255, 255, 255, 0.72);
      }
      .pinokio-draft-button.secondary:hover,
      .pinokio-draft-button.secondary:focus {
        border-color: rgba(15, 23, 42, 0.24);
        background: rgba(15, 23, 42, 0.04);
      }
      body.dark .pinokio-draft-button.secondary {
        border-color: rgba(148, 163, 184, 0.28);
        color: #dbeafe;
        background: transparent;
      }
      body.dark .pinokio-draft-button.secondary:hover,
      body.dark .pinokio-draft-button.secondary:focus {
        border-color: rgba(148, 163, 184, 0.38);
        background: rgba(255, 255, 255, 0.06);
      }
      .pinokio-draft-drawer .pinokio-draft-button.secondary {
        border-color: rgba(15, 23, 42, 0.18);
        color: #1f2937;
        background: #ffffff;
      }
      .pinokio-draft-drawer .pinokio-draft-button.secondary:hover,
      .pinokio-draft-drawer .pinokio-draft-button.secondary:focus {
        border-color: rgba(15, 23, 42, 0.28);
        background: rgba(15, 23, 42, 0.05);
      }
      body.dark .pinokio-draft-drawer .pinokio-draft-button.secondary {
        border-color: rgba(148, 163, 184, 0.28);
        color: #dbeafe;
        background: transparent;
      }
      body.dark .pinokio-draft-drawer .pinokio-draft-button.secondary:hover,
      body.dark .pinokio-draft-drawer .pinokio-draft-button.secondary:focus {
        border-color: rgba(148, 163, 184, 0.38);
        background: rgba(255, 255, 255, 0.06);
      }
      .pinokio-draft-button:disabled {
        cursor: default;
        opacity: 0.68;
      }
      .pinokio-draft-more {
        align-self: flex-end;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(15, 23, 42, 0.14);
        color: rgba(55, 65, 81, 0.82);
        font-size: 12px;
        line-height: 1.2;
        padding: 6px 10px;
        pointer-events: auto;
      }
      body.dark .pinokio-draft-more {
        background: rgba(23, 23, 25, 0.96);
        border-color: rgba(255, 255, 255, 0.16);
        color: rgba(212, 212, 216, 0.82);
      }
      .pinokio-draft-drawer-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483001;
        background: rgba(15, 23, 42, 0.28);
        display: flex;
        justify-content: flex-end;
        color: #111827;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .pinokio-draft-drawer {
        width: min(920px, calc(100vw - 34px));
        height: 100vh;
        background: #fbfbfc;
        border-left: 1px solid rgba(15, 23, 42, 0.12);
        box-shadow: -24px 0 72px rgba(15, 23, 42, 0.24);
        display: flex;
        flex-direction: column;
      }
      body.dark .pinokio-draft-drawer {
        background: #171719;
        border-left-color: rgba(255, 255, 255, 0.1);
        color: rgba(250, 250, 250, 0.96);
      }
      body.dark .pinokio-draft-drawer-backdrop {
        background: rgba(0, 0, 0, 0.42);
      }
      .pinokio-draft-drawer-header {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 22px 24px 18px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.1);
      }
      body.dark .pinokio-draft-drawer-header {
        border-bottom-color: rgba(255, 255, 255, 0.1);
      }
      .pinokio-draft-drawer-title-block {
        min-width: 0;
        flex: 1 1 auto;
      }
      .pinokio-draft-drawer-kicker {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #a16207;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .pinokio-draft-drawer-kicker i {
        font-size: 10px;
      }
      body.dark .pinokio-draft-drawer-kicker {
        color: #fbbf24;
      }
      .pinokio-draft-drawer-title {
        margin-top: 5px;
        color: inherit;
        font-size: 22px;
        font-weight: 800;
        line-height: 1.16;
        overflow-wrap: anywhere;
      }
      .pinokio-draft-drawer-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-top: 9px;
        color: rgba(55, 65, 81, 0.76);
        font-size: 12px;
        line-height: 1.3;
      }
      body.dark .pinokio-draft-drawer-meta {
        color: rgba(212, 212, 216, 0.78);
      }
      .pinokio-draft-drawer-close {
        width: 34px;
        height: 34px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 18px;
      }
      body.dark .pinokio-draft-drawer-close {
        border-color: rgba(255, 255, 255, 0.12);
      }
      .pinokio-draft-drawer-close:hover,
      .pinokio-draft-drawer-close:focus {
        background: rgba(15, 23, 42, 0.06);
      }
      body.dark .pinokio-draft-drawer-close:hover,
      body.dark .pinokio-draft-drawer-close:focus {
        background: rgba(255, 255, 255, 0.08);
      }
      .pinokio-draft-drawer-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 24px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.1);
      }
      body.dark .pinokio-draft-drawer-toolbar {
        border-bottom-color: rgba(255, 255, 255, 0.1);
      }
      .pinokio-draft-tabs {
        display: inline-flex;
        gap: 4px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        padding: 3px;
        background: rgba(15, 23, 42, 0.04);
      }
      body.dark .pinokio-draft-tabs {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
      }
      .pinokio-draft-tab {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(55, 65, 81, 0.86);
        cursor: pointer;
        font-size: 12px;
        font-weight: 800;
        padding: 7px 10px;
      }
      .pinokio-draft-tab.is-active {
        background: #ffffff;
        color: #111827;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      body.dark .pinokio-draft-tab {
        color: rgba(228, 228, 231, 0.78);
      }
      body.dark .pinokio-draft-tab.is-active {
        background: rgba(255, 255, 255, 0.12);
        color: #fafafa;
      }
      .pinokio-draft-drawer-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .pinokio-draft-drawer-body {
        min-height: 0;
        flex: 1 1 auto;
        overflow: auto;
        padding: 22px 24px 28px;
      }
      .pinokio-draft-markdown {
        max-width: 760px;
        color: #1f2937;
        font-size: 15px;
        line-height: 1.62;
      }
      body.dark .pinokio-draft-markdown {
        color: rgba(244, 244, 245, 0.92);
      }
      .pinokio-draft-markdown h1,
      .pinokio-draft-markdown h2,
      .pinokio-draft-markdown h3 {
        color: inherit;
        line-height: 1.18;
        letter-spacing: 0;
        margin: 24px 0 10px;
      }
      .pinokio-draft-markdown h1 { font-size: 26px; }
      .pinokio-draft-markdown h2 { font-size: 21px; }
      .pinokio-draft-markdown h3 { font-size: 17px; }
      .pinokio-draft-markdown p,
      .pinokio-draft-markdown ul,
      .pinokio-draft-markdown ol,
      .pinokio-draft-markdown blockquote,
      .pinokio-draft-markdown pre {
        margin: 0 0 14px;
      }
      .pinokio-draft-markdown ul,
      .pinokio-draft-markdown ol {
        padding-left: 24px;
      }
      .pinokio-draft-markdown a {
        color: #2563eb;
        text-decoration: none;
      }
      .pinokio-draft-markdown a:hover {
        text-decoration: underline;
      }
      body.dark .pinokio-draft-markdown a {
        color: #93c5fd;
      }
      .pinokio-draft-markdown code {
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 5px;
        background: rgba(15, 23, 42, 0.05);
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.9em;
        padding: 1px 4px;
      }
      body.dark .pinokio-draft-markdown code {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.07);
      }
      .pinokio-draft-markdown pre {
        overflow: auto;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.05);
        padding: 12px;
      }
      .pinokio-draft-markdown pre code {
        border: 0;
        background: transparent;
        padding: 0;
      }
      .pinokio-draft-markdown blockquote {
        border-left: 3px solid rgba(15, 23, 42, 0.2);
        color: rgba(55, 65, 81, 0.84);
        padding-left: 12px;
      }
      body.dark .pinokio-draft-markdown blockquote {
        border-left-color: rgba(255, 255, 255, 0.24);
        color: rgba(212, 212, 216, 0.84);
      }
      .pinokio-draft-markdown table {
        border-collapse: collapse;
        width: 100%;
        margin: 0 0 16px;
        font-size: 13px;
      }
      .pinokio-draft-markdown th,
      .pinokio-draft-markdown td {
        border: 1px solid rgba(15, 23, 42, 0.12);
        padding: 8px 9px;
        text-align: left;
        vertical-align: top;
      }
      .pinokio-draft-markdown th {
        background: rgba(15, 23, 42, 0.05);
        font-weight: 800;
      }
      body.dark .pinokio-draft-markdown th,
      body.dark .pinokio-draft-markdown td {
        border-color: rgba(255, 255, 255, 0.12);
      }
      body.dark .pinokio-draft-markdown th {
        background: rgba(255, 255, 255, 0.08);
      }
      .pinokio-draft-media-figure {
        margin: 0 0 16px;
      }
      .pinokio-draft-media-figure img,
      .pinokio-draft-media-figure video {
        display: block;
        max-width: 100%;
        max-height: 520px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.04);
      }
      .pinokio-draft-media-figure audio {
        width: min(520px, 100%);
      }
      body.dark .pinokio-draft-media-figure img,
      body.dark .pinokio-draft-media-figure video {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
      }
      .pinokio-draft-media-caption {
        margin-top: 6px;
        color: rgba(55, 65, 81, 0.72);
        font-size: 12px;
      }
      body.dark .pinokio-draft-media-caption {
        color: rgba(212, 212, 216, 0.72);
      }
      .pinokio-draft-raw {
        box-sizing: border-box;
        width: 100%;
        min-height: calc(100vh - 210px);
        margin: 0;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        overflow: auto;
        padding: 14px;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 13px;
        line-height: 1.55;
      }
      body.dark .pinokio-draft-raw {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(250, 250, 250, 0.92);
      }
      .pinokio-draft-media-list {
        display: grid;
        gap: 10px;
        max-width: 760px;
      }
      .pinokio-draft-media-item {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.72);
        padding: 11px 12px;
      }
      body.dark .pinokio-draft-media-item {
        border-color: rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
      }
      .pinokio-draft-media-item-icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 7px;
        background: rgba(15, 23, 42, 0.06);
        color: #0f766e;
      }
      body.dark .pinokio-draft-media-item-icon {
        background: rgba(255, 255, 255, 0.08);
        color: #5eead4;
      }
      .pinokio-draft-media-item-copy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .pinokio-draft-media-item-title {
        font-size: 13px;
        font-weight: 800;
        overflow-wrap: anywhere;
      }
      .pinokio-draft-media-item-meta {
        margin-top: 3px;
        color: rgba(55, 65, 81, 0.72);
        font-size: 12px;
      }
      body.dark .pinokio-draft-media-item-meta {
        color: rgba(212, 212, 216, 0.72);
      }
      @media (max-width: 520px) {
        .pinokio-drafts {
          right: 12px;
          bottom: 12px;
        }
        .pinokio-draft-actions {
          flex-wrap: wrap;
        }
        .pinokio-draft-drawer {
          width: 100vw;
        }
        .pinokio-draft-drawer-header,
        .pinokio-draft-drawer-toolbar,
        .pinokio-draft-drawer-body {
          padding-left: 16px;
          padding-right: 16px;
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

  function createActionButton(className, label, iconName) {
    const button = createElement("button", className);
    if (iconName) {
      button.appendChild(createIcon(iconName));
    }
    const text = createElement("span", "", label);
    text.setAttribute("data-pinokio-draft-label", "true");
    button.appendChild(text);
    return button;
  }

  function setActionButtonLabel(button, label) {
    if (!button) {
      return;
    }
    const text = button.querySelector("[data-pinokio-draft-label]");
    if (text) {
      text.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  function createDraftStatus(className) {
    const status = createElement("div", className);
    status.appendChild(createIcon("fa-solid fa-circle-check"));
    status.appendChild(document.createTextNode("Draft ready"));
    return status;
  }

  function canPublishToRegistry(item) {
    const publish = item && item.publish && typeof item.publish === "object" ? item.publish : null;
    const target = publish && typeof publish.target === "string" ? publish.target.trim().toLowerCase() : "";
    const type = publish && typeof publish.type === "string" ? publish.type.trim().toLowerCase() : "post";
    return target === "registry" && type === "post";
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

  function getItemById(id) {
    return (Array.isArray(state.items) ? state.items : []).find((item) => item && item.id === id) || null;
  }

  function getDraftMetaParts(item) {
    const parts = [];
    const updatedAt = formatUpdatedAt(item && item.updatedAt);
    const postSize = formatBytes(item && item.postBytes);
    const mediaCount = Number(item && item.mediaCount || 0);
    const missingMedia = Number(item && item.missingMediaCount || 0);
    if (item && item.workspaceName) {
      parts.push(item.workspaceName);
    }
    if (updatedAt) {
      parts.push(updatedAt);
    }
    if (postSize) {
      parts.push(postSize);
    }
    if (mediaCount > 0) {
      parts.push(`${mediaCount} media ${mediaCount === 1 ? "file" : "files"}`);
    }
    if (missingMedia > 0) {
      parts.push(`${missingMedia} missing`);
    }
    return parts;
  }

  function normalizeRef(value) {
    const raw = String(value || "").trim().replace(/^<|>$/g, "").replace(/\\/g, "/");
    if (!raw) {
      return "";
    }
    const withoutHash = raw.split("#")[0];
    return withoutHash.split("?")[0];
  }

  function getMediaItems(item) {
    return Array.isArray(item && item.media) ? item.media : [];
  }

  function findMediaByRef(item, ref) {
    const normalized = normalizeRef(ref);
    if (!normalized) {
      return null;
    }
    return getMediaItems(item).find((media) => normalizeRef(media && media.ref) === normalized) || null;
  }

  function getMediaUrl(item, media) {
    return `/drafts/${encodeURIComponent(item.id)}/media/${encodeURIComponent(String(media.index))}`;
  }

  function mediaKind(media) {
    const ext = String((media && media.ext) || "").toLowerCase();
    if ([".apng", ".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(ext)) {
      return "image";
    }
    if ([".mp4", ".webm", ".ogg"].includes(ext)) {
      return "video";
    }
    if ([".m4a", ".mp3", ".wav"].includes(ext)) {
      return "audio";
    }
    return "file";
  }

  function isSafeExternalHref(value) {
    return /^(https?:|mailto:)/i.test(String(value || "").trim());
  }

  function appendInline(parent, text, item) {
    const source = String(text || "");
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+]\([^)]+\))/g;
    let cursor = 0;
    let match = null;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) {
        parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      }
      const token = match[0];
      if (token.startsWith("`") && token.endsWith("`")) {
        parent.appendChild(createElement("code", "", token.slice(1, -1)));
      } else if (token.startsWith("**") && token.endsWith("**")) {
        const strong = createElement("strong");
        appendInline(strong, token.slice(2, -2), item);
        parent.appendChild(strong);
      } else {
        const linkMatch = token.match(/^\[([^\]]+)]\(([^)]+)\)$/);
        const label = linkMatch ? linkMatch[1] : token;
        const href = linkMatch ? String(linkMatch[2] || "").trim() : "";
        const media = findMediaByRef(item, href);
        const safeHref = media && media.exists
          ? getMediaUrl(item, media)
          : (isSafeExternalHref(href) ? href : "");
        if (safeHref) {
          const link = createElement("a");
          link.href = safeHref;
          if (isSafeExternalHref(safeHref)) {
            link.target = "_blank";
            link.rel = "noreferrer";
          }
          link.textContent = label;
          parent.appendChild(link);
        } else {
          parent.appendChild(document.createTextNode(label));
        }
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < source.length) {
      parent.appendChild(document.createTextNode(source.slice(cursor)));
    }
  }

  function createMissingMedia(ref) {
    const figure = createElement("figure", "pinokio-draft-media-figure");
    const missing = createElement("div", "pinokio-draft-media-item");
    const icon = createElement("div", "pinokio-draft-media-item-icon");
    icon.appendChild(createIcon("fa-solid fa-triangle-exclamation"));
    const copy = createElement("div", "pinokio-draft-media-item-copy");
    copy.appendChild(createElement("div", "pinokio-draft-media-item-title", ref || "Missing media"));
    copy.appendChild(createElement("div", "pinokio-draft-media-item-meta", "Referenced file was not found in the draft folder."));
    missing.appendChild(icon);
    missing.appendChild(copy);
    figure.appendChild(missing);
    return figure;
  }

  function createMediaFigure(item, ref, altText) {
    const media = findMediaByRef(item, ref);
    if (!media || !media.exists) {
      return createMissingMedia(ref);
    }
    const figure = createElement("figure", "pinokio-draft-media-figure");
    const kind = mediaKind(media);
    const url = getMediaUrl(item, media);
    let element = null;
    if (kind === "image") {
      element = document.createElement("img");
      element.alt = altText || media.ref || "";
      element.loading = "lazy";
    } else if (kind === "video") {
      element = document.createElement("video");
      element.controls = true;
      element.preload = "metadata";
    } else if (kind === "audio") {
      element = document.createElement("audio");
      element.controls = true;
      element.preload = "metadata";
    }
    if (!element) {
      const link = createElement("a", "", media.ref || "Open media");
      link.href = url;
      figure.appendChild(link);
    } else {
      element.src = url;
      figure.appendChild(element);
    }
    const captionBits = [media.ref || ""];
    const size = formatBytes(media.bytes);
    if (size) {
      captionBits.push(size);
    }
    figure.appendChild(createElement("figcaption", "pinokio-draft-media-caption", captionBits.filter(Boolean).join(" / ")));
    return figure;
  }

  function splitTableRow(line) {
    let value = String(line || "").trim();
    if (value.startsWith("|")) {
      value = value.slice(1);
    }
    if (value.endsWith("|")) {
      value = value.slice(0, -1);
    }
    return value.split("|").map((cell) => cell.trim());
  }

  function isMarkdownTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function renderMarkdownTable(root, item, headerLine, rowLines) {
    const table = createElement("table");
    const thead = createElement("thead");
    const headerRow = createElement("tr");
    splitTableRow(headerLine).forEach((cell) => {
      const th = createElement("th");
      appendInline(th, cell, item);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = createElement("tbody");
    rowLines.forEach((line) => {
      const row = createElement("tr");
      splitTableRow(line).forEach((cell) => {
        const td = createElement("td");
        appendInline(td, cell, item);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function renderMarkdownPreview(container, item) {
    const markdown = String((item && item.markdown) || "");
    const lines = markdown.split(/\r?\n/);
    const root = createElement("div", "pinokio-draft-markdown");
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
      if (!paragraph.length) {
        return;
      }
      const p = createElement("p");
      appendInline(p, paragraph.join(" "), item);
      root.appendChild(p);
      paragraph = [];
    };
    const flushList = () => {
      if (list) {
        root.appendChild(list);
        list = null;
      }
    };
    const flushCode = () => {
      if (!code) {
        return;
      }
      const pre = createElement("pre");
      const codeEl = createElement("code", "", code.join("\n"));
      pre.appendChild(codeEl);
      root.appendChild(pre);
      code = null;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const fenceMatch = line.match(/^```/);
      if (fenceMatch) {
        if (code) {
          flushCode();
        } else {
          flushParagraph();
          flushList();
          code = [];
        }
        continue;
      }
      if (code) {
        code.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      if (line.trim().startsWith("|") && isMarkdownTableSeparator(lines[lineIndex + 1])) {
        flushParagraph();
        flushList();
        const rowLines = [];
        lineIndex += 1;
        while (lineIndex + 1 < lines.length && lines[lineIndex + 1].trim().startsWith("|")) {
          lineIndex += 1;
          rowLines.push(lines[lineIndex]);
        }
        renderMarkdownTable(root, item, line, rowLines);
        continue;
      }
      const imageMatch = line.trim().match(/^!\[([^\]]*)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/);
      if (imageMatch) {
        flushParagraph();
        flushList();
        root.appendChild(createMediaFigure(item, imageMatch[2], imageMatch[1]));
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph();
        flushList();
        const h = createElement(`h${heading[1].length}`);
        appendInline(h, heading[2], item);
        root.appendChild(h);
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        flushList();
        const blockquote = createElement("blockquote");
        appendInline(blockquote, quote[1], item);
        root.appendChild(blockquote);
        continue;
      }
      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const tag = ordered ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== tag) {
          flushList();
          list = createElement(tag);
        }
        const li = createElement("li");
        appendInline(li, (unordered || ordered)[1], item);
        list.appendChild(li);
        continue;
      }
      paragraph.push(line.trim());
    }
    flushCode();
    flushParagraph();
    flushList();
    if (!root.childNodes.length) {
      root.appendChild(createElement("p", "", "No preview available."));
    }
    container.appendChild(root);
  }

  function renderRawMarkdown(container, item) {
    container.appendChild(createElement("pre", "pinokio-draft-raw", String((item && item.markdown) || "")));
  }

  function renderMediaList(container, item) {
    const mediaItems = getMediaItems(item);
    const list = createElement("div", "pinokio-draft-media-list");
    if (!mediaItems.length) {
      list.appendChild(createElement("div", "pinokio-draft-media-item", "No media files referenced from this draft."));
      container.appendChild(list);
      return;
    }
    mediaItems.forEach((media) => {
      const row = createElement("div", "pinokio-draft-media-item");
      const icon = createElement("div", "pinokio-draft-media-item-icon");
      const kind = mediaKind(media);
      icon.appendChild(createIcon(kind === "video"
        ? "fa-solid fa-video"
        : (kind === "audio" ? "fa-solid fa-volume-high" : (kind === "image" ? "fa-solid fa-image" : "fa-solid fa-file"))));
      const copy = createElement("div", "pinokio-draft-media-item-copy");
      copy.appendChild(createElement("div", "pinokio-draft-media-item-title", media.ref || "Media"));
      const size = formatBytes(media.bytes);
      copy.appendChild(createElement("div", "pinokio-draft-media-item-meta", [media.exists ? "Ready" : "Missing", size].filter(Boolean).join(" / ")));
      row.appendChild(icon);
      row.appendChild(copy);
      if (media.exists) {
        const link = createActionButton("pinokio-draft-button secondary", "Open", "fa-solid fa-up-right-from-square");
        link.type = "button";
        link.addEventListener("click", () => {
          window.open(getMediaUrl(item, media), "_blank");
        });
        row.appendChild(link);
      }
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  function getApiUrl() {
    const url = new URL("/drafts", window.location.origin);
    if (activeCwd) {
      url.searchParams.set("cwd", activeCwd);
    }
    return url.toString();
  }

  async function dismissItem(item) {
    const id = item && typeof item === "object" ? item.id : item;
    const revision = item && typeof item === "object" ? item.revision : "";
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
      body: JSON.stringify({
        revision: revision || ""
      })
    }).catch(() => {});
  }

  async function openDraft(item, button) {
    if (!item || !item.postPath) {
      return;
    }
    const originalTextNode = button ? button.querySelector("[data-pinokio-draft-label]") : null;
    const originalText = originalTextNode ? originalTextNode.textContent : (button ? button.textContent : "");
    if (button) {
      button.disabled = true;
      setActionButtonLabel(button, "Opening...");
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
        setActionButtonLabel(button, originalText || "File explorer");
      }
    }
  }

  function writeRegistryPopup(popup, message) {
    try {
      if (!popup || popup.closed || !popup.document) {
        return;
      }
      popup.document.title = "Pinokio draft import";
      popup.document.body.innerHTML = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;color:#111827;">${String(message || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]))}</div>`;
    } catch (_) {
    }
  }

  async function completeRegistryDraftImport(pending, payload) {
    const response = await fetch("/registry/draft-import/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft: pending.draftId,
        token: payload.token,
        registry: payload.registry,
        app: payload.app || ""
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.editUrl) {
      const detail = data && data.status ? ` (${data.status})` : "";
      throw new Error(((data && data.error) || "Import failed.") + detail);
    }
    if (pending.popup && !pending.popup.closed) {
      pending.popup.postMessage({
        type: "pinokio:draft-import-result",
        ok: true,
        editUrl: data.editUrl
      }, pending.registryOrigin);
    } else {
      window.location.href = data.editUrl;
    }
  }

  window.addEventListener("message", (event) => {
    const payload = event.data || {};
    if (!payload || payload.type !== "pinokio:draft-import-token" || !payload.token || !payload.registry) {
      return;
    }
    const pending = pendingRegistryImport;
    if (!pending || event.origin !== pending.registryOrigin) {
      return;
    }
    pendingRegistryImport = null;
    void completeRegistryDraftImport(pending, payload).catch((error) => {
      const message = error && error.message ? error.message : "Import failed.";
      if (pending.popup && !pending.popup.closed) {
        pending.popup.postMessage({
          type: "pinokio:draft-import-result",
          ok: false,
          error: message
        }, pending.registryOrigin);
      }
    });
  });

  function closeDraftDrawer() {
    state.drawerItemId = "";
    const existing = document.getElementById("pinokio-draft-drawer-root");
    if (existing) {
      existing.remove();
    }
  }

  function openDraftDrawer(item, tab) {
    if (!item || !item.id) {
      return;
    }
    state.drawerItemId = item.id;
    state.drawerTab = tab || "preview";
    renderDrawer();
  }

  function createDrawerTab(label, tab) {
    const button = createElement("button", `pinokio-draft-tab${state.drawerTab === tab ? " is-active" : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-selected", state.drawerTab === tab ? "true" : "false");
    button.addEventListener("click", () => {
      state.drawerTab = tab;
      renderDrawer();
    });
    return button;
  }

  function renderDrawer() {
    const previous = document.getElementById("pinokio-draft-drawer-root");
    if (previous) {
      previous.remove();
    }
    const item = getItemById(state.drawerItemId);
    if (!item) {
      state.drawerItemId = "";
      return;
    }

    const backdrop = createElement("div", "pinokio-draft-drawer-backdrop");
    backdrop.id = "pinokio-draft-drawer-root";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeDraftDrawer();
      }
    });

    const drawer = createElement("section", "pinokio-draft-drawer");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Draft preview");

    const header = createElement("div", "pinokio-draft-drawer-header");
    const titleBlock = createElement("div", "pinokio-draft-drawer-title-block");
    titleBlock.appendChild(createDraftStatus("pinokio-draft-drawer-kicker"));
    titleBlock.appendChild(createElement("div", "pinokio-draft-drawer-title", item.title || "Draft"));
    titleBlock.appendChild(createElement("div", "pinokio-draft-drawer-meta", getDraftMetaParts(item).join(" / ")));
    const close = createElement("button", "pinokio-draft-drawer-close", "x");
    close.type = "button";
    close.setAttribute("aria-label", "Close draft preview");
    close.addEventListener("click", closeDraftDrawer);
    header.appendChild(titleBlock);
    header.appendChild(close);

    const toolbar = createElement("div", "pinokio-draft-drawer-toolbar");
    const tabs = createElement("div", "pinokio-draft-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.appendChild(createDrawerTab("Preview", "preview"));
    tabs.appendChild(createDrawerTab("Markdown", "markdown"));
    tabs.appendChild(createDrawerTab("Media", "media"));
    const actions = createElement("div", "pinokio-draft-drawer-actions");
    const openButton = createActionButton("pinokio-draft-button secondary", "File explorer", "fa-solid fa-folder-open");
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void openDraft(item, openButton);
    });
    actions.appendChild(openButton);
    if (canPublishToRegistry(item)) {
      const publishButton = createActionButton("pinokio-draft-button", "Publish", "fa-solid fa-arrow-up-from-bracket");
      publishButton.type = "button";
      publishButton.addEventListener("click", () => {
        void openRegistryDraftImport(item);
      });
      actions.appendChild(publishButton);
    }
    toolbar.appendChild(tabs);
    toolbar.appendChild(actions);

    const body = createElement("div", "pinokio-draft-drawer-body");
    if (state.drawerTab === "markdown") {
      renderRawMarkdown(body, item);
    } else if (state.drawerTab === "media") {
      renderMediaList(body, item);
    } else {
      renderMarkdownPreview(body, item);
    }

    drawer.appendChild(header);
    drawer.appendChild(toolbar);
    drawer.appendChild(body);
    backdrop.appendChild(drawer);
    document.body.appendChild(backdrop);
  }

  async function openRegistryDraftImport(item) {
    if (!item || !item.id || !canPublishToRegistry(item)) {
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      const fallback = new URL("/registry/draft-import/start", window.location.origin);
      fallback.searchParams.set("draft", item.id);
      window.location.href = fallback.toString();
      return;
    }
    writeRegistryPopup(popup, "Opening registry...");
    try {
      const url = new URL("/registry/draft-import/authorize-url", window.location.origin);
      url.searchParams.set("draft", item.id);
      url.searchParams.set("_", String(Date.now()));
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json"
        }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.authorizeUrl || !data.registryOrigin) {
        throw new Error((data && data.error) || "Unable to start registry import.");
      }
      pendingRegistryImport = {
        draftId: data.draftId || item.id,
        registryOrigin: data.registryOrigin,
        popup
      };
      popup.location.href = data.authorizeUrl;
    } catch (error) {
      writeRegistryPopup(popup, error && error.message ? error.message : "Unable to start registry import.");
    }
  }

  function renderItem(item) {
    const card = createElement("div", "pinokio-draft-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open draft preview for ${item.title || "Draft"}`);
    card.addEventListener("click", () => {
      openDraftDrawer(item, "preview");
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDraftDrawer(item, "preview");
      }
    });

    const head = createElement("div", "pinokio-draft-head");
    const iconWrap = createElement("div", "pinokio-draft-icon");
    iconWrap.appendChild(createIcon("fa-solid fa-file-lines"));

    const copy = createElement("div", "pinokio-draft-copy");
    copy.appendChild(createDraftStatus("pinokio-draft-kicker"));
    copy.appendChild(createElement("div", "pinokio-draft-title", item.title || "Draft"));

    const meta = createElement("div", "pinokio-draft-meta");
    meta.textContent = getDraftMetaParts(item).join(" / ");
    copy.appendChild(meta);

    const close = createElement("button", "pinokio-draft-close", "x");
    close.type = "button";
    close.title = "Dismiss";
    close.setAttribute("aria-label", "Dismiss draft");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void dismissItem(item);
    });
    close.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    head.appendChild(iconWrap);
    head.appendChild(copy);
    head.appendChild(close);
    card.appendChild(head);

    return card;
  }

  function render() {
    const items = Array.isArray(state.items) ? state.items : [];
    if (items.length === 0) {
      removeRoot();
      closeDraftDrawer();
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
    if (state.drawerItemId) {
      renderDrawer();
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
      const signature = items.map((item) => `${item.id}:${item.revision || item.updatedAt}`).join("|");
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
