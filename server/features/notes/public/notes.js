(function () {
  if (window.__PinokioNotesLoaded) {
    return;
  }
  window.__PinokioNotesLoaded = true;

  const context = window.PinokioNoteContext || {};
  const activeCwd = typeof context.cwd === "string" ? context.cwd.trim() : "";
  if (!activeCwd) {
    return;
  }
  const PUSH_ENDPOINT = "/push";
  const SOUND_PREF_STORAGE_KEY = "pinokio:idle-sound";
  const SOUND_SILENT_CHOICE = "__silent__";
  const NOTE_NOTIFIED_PREFIX = "pinokio:note-notified:";
  const state = {
    initialRefreshComplete: false,
    items: [],
    lastSignature: "",
    notifiedIds: new Set(),
    drawerOpen: false,
    drawerItemId: "",
    drawerTab: "preview",
    highlightItemId: "",
    panelMode: "list",
    unseen: new Map(),
    edits: new Map()
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

  function claimNoteNotification(id) {
    const normalized = typeof id === "string" ? id.trim() : "";
    if (!normalized) {
      return false;
    }
    if (state.notifiedIds.has(normalized)) {
      return false;
    }
    state.notifiedIds.add(normalized);
    try {
      const key = `${NOTE_NOTIFIED_PREFIX}${normalized}`;
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

  function notifyNoteReady(item) {
    const notificationKey = item && item.id
      ? `${item.id}:${item.revision || item.updatedAt || ""}`
      : "";
    if (!item || !claimNoteNotification(notificationKey)) {
      return;
    }
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Note";
    const workspaceName = typeof item.workspaceName === "string" && item.workspaceName.trim() ? item.workspaceName.trim() : "";
    const message = workspaceName ? `${workspaceName}: ${title}` : `Note ready: ${title}`;
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

  function getRoot() {
    let root = document.getElementById("pinokio-notes");
    if (!root) {
      const slot = document.getElementById("pinokio-notes-slot");
      root = document.createElement("div");
      root.id = "pinokio-notes";
      root.className = `pinokio-notes ${slot ? "is-inline" : "is-floating"}`;
      root.setAttribute("aria-live", "polite");
      (slot || document.body).appendChild(root);
    }
    return root;
  }

  function removeRoot() {
    const root = document.getElementById("pinokio-notes");
    if (root) {
      root.remove();
    }
  }

  function getSheetHost() {
    const slot = document.getElementById("pinokio-notes-slot");
    if (!slot) {
      return document.body;
    }
    const scopedHost = slot.closest("[data-pinokio-notes-scope]");
    if (scopedHost) {
      return scopedHost;
    }
    return document.body;
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
    text.setAttribute("data-pinokio-note-label", "true");
    button.appendChild(text);
    return button;
  }

  function setActionButtonLabel(button, label) {
    if (!button) {
      return;
    }
    const text = button.querySelector("[data-pinokio-note-label]");
    if (text) {
      text.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  function canPublishToRegistry(item) {
    const publish = item && item.publish && typeof item.publish === "object" ? item.publish : null;
    const target = publish && typeof publish.target === "string" ? publish.target.trim().toLowerCase() : "";
    const type = publish && typeof publish.type === "string" ? publish.type.trim().toLowerCase() : "post";
    return target === "registry" && type === "post";
  }

  function noteSignature(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => `${item.id}:${item.revision || item.updatedAt}`)
      .join("|");
  }

  function getNoteEdit(item) {
    if (!item || !item.id) {
      return {
        markdown: String((item && item.markdown) || ""),
        originalMarkdown: String((item && item.markdown) || ""),
        revision: item && item.revision ? item.revision : "",
        dirty: false
      };
    }
    const existing = state.edits.get(item.id);
    const markdown = String(item.markdown || "");
    const revision = item.revision || item.updatedAt || "";
    if (existing) {
      if (existing.dirty) {
        return existing;
      }
      if (existing.revision === revision) {
        return existing;
      }
    }
    const next = {
      markdown,
      originalMarkdown: markdown,
      revision,
      dirty: false
    };
    state.edits.set(item.id, next);
    return next;
  }

  function getEditedMarkdown(item) {
    return getNoteEdit(item).markdown;
  }

  function isNoteDirty(item) {
    return !!getNoteEdit(item).dirty;
  }

  function setNoteMarkdown(item, value) {
    if (!item || !item.id) {
      return;
    }
    const edit = getNoteEdit(item);
    edit.markdown = String(value || "");
    edit.dirty = edit.markdown !== edit.originalMarkdown;
    state.edits.set(item.id, edit);
  }

  function resetNoteEdit(item) {
    if (!item || !item.id) {
      return;
    }
    state.edits.set(item.id, {
      markdown: String(item.markdown || ""),
      originalMarkdown: String(item.markdown || ""),
      revision: item.revision || item.updatedAt || "",
      dirty: false
    });
  }

  function replaceNoteItem(nextItem) {
    if (!nextItem || !nextItem.id) {
      return;
    }
    const index = state.items.findIndex((item) => item && item.id === nextItem.id);
    if (index >= 0) {
      state.items.splice(index, 1, nextItem);
    } else {
      state.items.unshift(nextItem);
    }
    resetNoteEdit(nextItem);
    state.drawerItemId = nextItem.id;
    state.lastSignature = noteSignature(state.items);
  }

  function setButtonsForNote(item, dirty) {
    const id = item && item.id ? item.id : "";
    document.querySelectorAll("[data-pinokio-note-save]").forEach((button) => {
      if (button.dataset.pinokioNoteSave === id) {
        button.hidden = !dirty;
        button.disabled = !dirty;
      }
    });
    document.querySelectorAll("[data-pinokio-note-revert]").forEach((button) => {
      if (button.dataset.pinokioNoteRevert === id) {
        button.hidden = !dirty;
        button.disabled = !dirty;
      }
    });
    document.querySelectorAll("[data-pinokio-note-publish]").forEach((button) => {
      if (button.dataset.pinokioNotePublish === id) {
        button.disabled = !!dirty;
        button.title = dirty ? "Save changes before publishing" : "";
      }
    });
    document.querySelectorAll("[data-pinokio-note-unsaved]").forEach((badge) => {
      if (badge.dataset.pinokioNoteUnsaved === id) {
        badge.hidden = !dirty;
      }
    });
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

  function getNoteMetaParts(item) {
    const parts = [];
    const updatedAt = formatUpdatedAt(item && item.updatedAt);
    const noteSize = formatBytes(item && item.noteBytes);
    const mediaCount = Number(item && item.mediaCount || 0);
    const missingMedia = Number(item && item.missingMediaCount || 0);
    if (item && item.workspaceName) {
      parts.push(item.workspaceName);
    }
    if (updatedAt) {
      parts.push(updatedAt);
    }
    if (noteSize) {
      parts.push(noteSize);
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
    return `/notes/${encodeURIComponent(item.id)}/media/${encodeURIComponent(String(media.index))}`;
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
    const figure = createElement("figure", "pinokio-note-media-figure");
    const missing = createElement("div", "pinokio-note-media-item");
    const icon = createElement("div", "pinokio-note-media-item-icon");
    icon.appendChild(createIcon("fa-solid fa-triangle-exclamation"));
    const copy = createElement("div", "pinokio-note-media-item-copy");
    copy.appendChild(createElement("div", "pinokio-note-media-item-title", ref || "Missing media"));
    copy.appendChild(createElement("div", "pinokio-note-media-item-meta", "Referenced file was not found in the note folder."));
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
    const figure = createElement("figure", "pinokio-note-media-figure");
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
    figure.appendChild(createElement("figcaption", "pinokio-note-media-caption", captionBits.filter(Boolean).join(" / ")));
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
    const markdown = getEditedMarkdown(item);
    const lines = markdown.split(/\r?\n/);
    const root = createElement("div", "pinokio-note-markdown");
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

  function renderMarkdownEditor(container, item) {
    const edit = getNoteEdit(item);
    const shell = createElement("div", "pinokio-note-editor");
    const textarea = document.createElement("textarea");
    textarea.className = "pinokio-note-markdown-editor";
    textarea.value = edit.markdown;
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Edit note markdown");
    textarea.addEventListener("input", () => {
      setNoteMarkdown(item, textarea.value);
      setButtonsForNote(item, isNoteDirty(item));
    });
    shell.appendChild(textarea);
    container.appendChild(shell);
  }

  function renderMediaList(container, item) {
    const mediaItems = getMediaItems(item);
    const list = createElement("div", "pinokio-note-media-list");
    if (!mediaItems.length) {
      list.appendChild(createElement("div", "pinokio-note-media-item", "No media files referenced from this note."));
      container.appendChild(list);
      return;
    }
    mediaItems.forEach((media) => {
      const row = createElement("div", "pinokio-note-media-item");
      const icon = createElement("div", "pinokio-note-media-item-icon");
      const kind = mediaKind(media);
      icon.appendChild(createIcon(kind === "video"
        ? "fa-solid fa-video"
        : (kind === "audio" ? "fa-solid fa-volume-high" : (kind === "image" ? "fa-solid fa-image" : "fa-solid fa-file"))));
      const copy = createElement("div", "pinokio-note-media-item-copy");
      copy.appendChild(createElement("div", "pinokio-note-media-item-title", media.ref || "Media"));
      const size = formatBytes(media.bytes);
      copy.appendChild(createElement("div", "pinokio-note-media-item-meta", [media.exists ? "Ready" : "Missing", size].filter(Boolean).join(" / ")));
      row.appendChild(icon);
      row.appendChild(copy);
      if (media.exists) {
        const link = createActionButton("pinokio-note-button secondary", "Open", "fa-solid fa-up-right-from-square");
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
    const url = new URL("/notes", window.location.origin);
    if (activeCwd) {
      url.searchParams.set("cwd", activeCwd);
    }
    if (context.publish && typeof context.publish === "object" && !Array.isArray(context.publish)) {
      try {
        url.searchParams.set("publish", JSON.stringify(context.publish));
      } catch (_) {}
    }
    return url.toString();
  }

  async function openNote(item, button) {
    if (!item || !item.notePath) {
      return;
    }
    const originalTextNode = button ? button.querySelector("[data-pinokio-note-label]") : null;
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
          path: item.notePath
        })
      });
    } finally {
      if (button) {
        button.disabled = false;
        setActionButtonLabel(button, originalText || "File explorer");
      }
    }
  }

  async function saveNote(item, button) {
    if (!item || !item.id) {
      return;
    }
    const edit = getNoteEdit(item);
    if (!edit.dirty) {
      return;
    }
    const originalTextNode = button ? button.querySelector("[data-pinokio-note-label]") : null;
    const originalText = originalTextNode ? originalTextNode.textContent : (button ? button.textContent : "");
    if (button) {
      button.disabled = true;
      setActionButtonLabel(button, "Saving...");
    }
    try {
      const response = await fetch(`/notes/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Accept: "application/json",
          "X-Pinokio-Note-Revision": edit.revision || ""
        },
        body: edit.markdown
      });
      const data = await response.json().catch(() => null);
      if (response.status === 409) {
        throw new Error((data && data.error) || "Note changed on disk. Reload it before saving.");
      }
      if (!response.ok || !data || !data.item) {
        throw new Error((data && data.error) || "Unable to save note.");
      }
      replaceNoteItem(data.item);
      render();
    } catch (error) {
      window.alert(error && error.message ? error.message : "Unable to save note.");
      setButtonsForNote(item, true);
    } finally {
      if (button) {
        button.disabled = false;
        setActionButtonLabel(button, originalText || "Save");
      }
    }
  }

  function revertNote(item) {
    resetNoteEdit(item);
    renderDrawer();
  }

  function closeNoteDrawer() {
    state.drawerOpen = false;
    state.drawerItemId = "";
    state.panelMode = "list";
    const existing = document.getElementById("pinokio-note-sheet-root");
    if (existing) {
      existing.remove();
    }
  }

  function openNoteDrawer(item, tab) {
    state.drawerOpen = true;
    if (item && item.id) {
      state.drawerItemId = item.id;
      state.panelMode = "detail";
    } else if (!state.drawerItemId && state.items[0] && state.items[0].id) {
      state.drawerItemId = state.items[0].id;
      state.panelMode = "list";
    } else {
      state.panelMode = "list";
    }
    if (tab === "list") {
      state.panelMode = "list";
    } else {
      state.drawerTab = tab || state.drawerTab || "preview";
    }
    renderDrawer();
  }

  function createDrawerTab(label, tab) {
    const button = createElement("button", `pinokio-note-tab${state.drawerTab === tab ? " is-active" : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-selected", state.drawerTab === tab ? "true" : "false");
    button.addEventListener("click", () => {
      state.drawerTab = tab;
      renderDrawer();
    });
    return button;
  }

  function renderDrawer() {
    const previous = document.getElementById("pinokio-note-sheet-root");
    if (previous) {
      previous.remove();
    }
    if (!state.drawerOpen) {
      return;
    }
    const items = Array.isArray(state.items) ? state.items : [];
    let item = getItemById(state.drawerItemId);
    if (!item && items[0]) {
      item = items[0];
      state.drawerItemId = item.id;
    }

    const backdrop = createElement("div", "pinokio-note-sheet-backdrop");
    backdrop.id = "pinokio-note-sheet-root";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeNoteDrawer();
      }
    });

    const sheet = createElement("section", "pinokio-note-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Notes");

    const header = createElement("div", "pinokio-note-sheet-header");
    const titleBlock = createElement("div", "pinokio-note-sheet-title-block");
    const dirty = state.panelMode === "detail" && item ? isNoteDirty(item) : false;
    titleBlock.appendChild(createElement("div", "pinokio-note-sheet-kicker", `${items.length} ${items.length === 1 ? "note" : "notes"}`));
    const titleRow = createElement("div", "pinokio-note-sheet-title-row");
    titleRow.appendChild(createElement("div", "pinokio-note-sheet-title", state.panelMode === "detail" && item ? item.title || "Note" : "Notes"));
    if (state.panelMode === "detail" && item) {
      const unsaved = createElement("span", "pinokio-note-unsaved-badge", "Unsaved");
      unsaved.dataset.pinokioNoteUnsaved = item.id;
      unsaved.hidden = !dirty;
      titleRow.appendChild(unsaved);
    }
    titleBlock.appendChild(titleRow);
    titleBlock.appendChild(createElement("div", "pinokio-note-sheet-meta", state.panelMode === "detail" && item ? getNoteMetaParts(item).join(" / ") : activeCwd));
    const headerActions = createElement("div", "pinokio-note-sheet-header-actions");
    const close = createElement("button", "pinokio-note-sheet-close", "x");
    close.type = "button";
    close.setAttribute("aria-label", "Close note preview");
    close.addEventListener("click", closeNoteDrawer);
    header.appendChild(titleBlock);
    headerActions.appendChild(close);
    header.appendChild(headerActions);

    const bodyShell = createElement("div", "pinokio-note-sheet-body");

    if (state.panelMode !== "detail" || !item) {
      const list = createElement("div", "pinokio-note-list");
      if (!items.length) {
        const empty = createElement("div", "pinokio-note-list-empty");
        empty.appendChild(createElement("div", "pinokio-note-list-empty-title", "No notes yet"));
        empty.appendChild(createElement("div", "pinokio-note-list-empty-copy", "Ask the agent to save useful work as a local note. Saved notes stay private until you publish them."));
        empty.appendChild(createElement("div", "pinokio-note-list-empty-prompt", "Try: Save this as a note."));
        list.appendChild(empty);
      } else {
        items.forEach((note) => {
          const marker = state.unseen && state.unseen.get(note.id);
          const row = createElement("button", `pinokio-note-list-item${note.id === state.highlightItemId ? " is-highlighted" : ""}${marker ? " has-update" : ""}`);
          row.type = "button";
          const rowTop = createElement("div", "pinokio-note-list-top");
          rowTop.appendChild(createElement("div", "pinokio-note-list-title", note.title || "Note"));
          if (marker) {
            rowTop.appendChild(createElement("span", "pinokio-note-list-badge", marker === "updated" ? "Updated" : "New"));
          }
          row.appendChild(rowTop);
          row.appendChild(createElement("div", "pinokio-note-list-meta", getNoteMetaParts(note).join(" / ")));
          row.addEventListener("click", () => {
            state.drawerItemId = note.id;
            state.panelMode = "detail";
            state.unseen.delete(note.id);
            if (state.highlightItemId === note.id) {
              state.highlightItemId = "";
            }
            renderDrawer();
            render();
          });
          list.appendChild(row);
        });
      }
      bodyShell.appendChild(list);
      sheet.appendChild(header);
      sheet.appendChild(bodyShell);
      backdrop.appendChild(sheet);
      getSheetHost().appendChild(backdrop);
      return;
    }

    const detail = createElement("div", "pinokio-note-detail");
    const toolbar = createElement("div", "pinokio-note-sheet-toolbar");
    const back = createActionButton("pinokio-note-button secondary compact", "Notes", "fa-solid fa-chevron-left");
    back.type = "button";
    back.addEventListener("click", () => {
      state.panelMode = "list";
      renderDrawer();
    });
    const tabs = createElement("div", "pinokio-note-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.appendChild(createDrawerTab("Preview", "preview"));
    tabs.appendChild(createDrawerTab("Markdown", "markdown"));
    tabs.appendChild(createDrawerTab("Media", "media"));
    const actions = createElement("div", "pinokio-note-sheet-actions");
    const saveButton = createActionButton("pinokio-note-button", "Save", "fa-solid fa-floppy-disk");
    saveButton.type = "button";
    saveButton.dataset.pinokioNoteSave = item.id;
    saveButton.hidden = !isNoteDirty(item);
    saveButton.disabled = !isNoteDirty(item);
    saveButton.addEventListener("click", () => {
      void saveNote(item, saveButton);
    });
    const revertButton = createActionButton("pinokio-note-button secondary", "Revert", "fa-solid fa-arrow-rotate-left");
    revertButton.type = "button";
    revertButton.dataset.pinokioNoteRevert = item.id;
    revertButton.hidden = !isNoteDirty(item);
    revertButton.disabled = !isNoteDirty(item);
    revertButton.addEventListener("click", () => {
      revertNote(item);
    });
    actions.appendChild(saveButton);
    actions.appendChild(revertButton);
    const openButton = createActionButton("pinokio-note-button secondary", "File explorer", "fa-solid fa-folder-open");
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void openNote(item, openButton);
    });
    actions.appendChild(openButton);
    if (canPublishToRegistry(item)) {
      const publishButton = createActionButton("pinokio-note-button", "Publish", "fa-solid fa-arrow-up-from-bracket");
      publishButton.type = "button";
      publishButton.dataset.pinokioNotePublish = item.id;
      publishButton.disabled = isNoteDirty(item);
      publishButton.title = isNoteDirty(item) ? "Save changes before publishing" : "";
      publishButton.addEventListener("click", () => {
        if (isNoteDirty(item)) {
          window.alert("Save changes before publishing.");
          return;
        }
        void openRegistryNoteImport(item);
      });
      actions.appendChild(publishButton);
    }
    toolbar.appendChild(back);
    toolbar.appendChild(tabs);
    toolbar.appendChild(actions);

    const body = createElement("div", "pinokio-note-detail-body");
    if (state.drawerTab === "markdown") {
      renderMarkdownEditor(body, item);
    } else if (state.drawerTab === "media") {
      renderMediaList(body, item);
    } else {
      renderMarkdownPreview(body, item);
    }

    detail.appendChild(toolbar);
    detail.appendChild(body);
    bodyShell.appendChild(detail);
    sheet.appendChild(header);
    sheet.appendChild(bodyShell);
    backdrop.appendChild(sheet);
    getSheetHost().appendChild(backdrop);
  }

  async function openRegistryNoteImport(item) {
    if (!item || !item.id || !canPublishToRegistry(item)) {
      return;
    }
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
      if (!response.ok || !data || !data.authorizeUrl) {
        throw new Error((data && data.error) || "Unable to start registry import.");
      }
      const openResponse = await fetch("/pinokio/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: data.authorizeUrl,
          surface: "browser"
        })
      });
      if (!openResponse.ok) {
        throw new Error("Unable to open registry.");
      }
    } catch (error) {
      window.alert(error && error.message ? error.message : "Unable to start registry import.");
    }
  }

  function render() {
    renderFooter();
    if (state.drawerOpen) {
      renderDrawer();
    }
  }

  function renderFooter() {
    const items = Array.isArray(state.items) ? state.items : [];
    const root = getRoot();
    root.innerHTML = "";
    const highlighted = getItemById(state.highlightItemId);
    const item = highlighted || getItemById(state.drawerItemId) || items[0];
    const unseenValues = state.unseen ? Array.from(state.unseen.values()).filter(Boolean) : [];
    const hasUnseen = unseenValues.length > 0;
    const allNew = hasUnseen && unseenValues.every((value) => value === "new");
    const allUpdated = hasUnseen && unseenValues.every((value) => value === "updated");
    const hasNewNote = hasUnseen && unseenValues.includes("new");
    const countLabel = `${items.length} note${items.length === 1 ? "" : "s"}`;
    const updateLabel = !hasUnseen
      ? ""
      : (unseenValues.length === 1
        ? (unseenValues[0] === "updated" ? "Updated" : "New")
        : (allNew ? `${unseenValues.length} new` : allUpdated ? `${unseenValues.length} updated` : `${unseenValues.length} updates`));
    const footer = createElement("button", `pinokio-note-footer${hasUnseen ? " has-update" : ""}${items.length ? "" : " is-empty"}`);
    footer.type = "button";
    footer.setAttribute("aria-label", items.length ? `Open ${items.length} note${items.length === 1 ? "" : "s"}` : "Open notes");
    const accent = createElement("div", "pinokio-note-footer-accent");
    const icon = createElement("div", "pinokio-note-footer-icon");
    icon.appendChild(createIcon(hasUnseen ? "fa-solid fa-circle-check" : "fa-solid fa-file-lines"));
    const copy = createElement("div", "pinokio-note-footer-copy");
    const top = createElement("div", "pinokio-note-footer-top");
    top.appendChild(createElement("span", "pinokio-note-footer-count", countLabel));
    if (updateLabel) {
      top.appendChild(createElement("span", `pinokio-note-footer-badge${hasNewNote ? " is-new" : " is-updated"}`, updateLabel));
    }
    copy.appendChild(top);
    copy.appendChild(createElement("div", "pinokio-note-footer-title", item && item.title ? item.title : "Notes"));
    copy.appendChild(createElement("div", "pinokio-note-footer-meta", item ? getNoteMetaParts(item).join(" / ") : "Ask the agent: \"Save this as a note.\""));
    const chevron = createElement("div", "pinokio-note-footer-chevron");
    chevron.appendChild(createElement("span", "", "Open notes"));
    chevron.appendChild(createIcon("fa-solid fa-chevron-right"));
    footer.appendChild(accent);
    footer.appendChild(icon);
    footer.appendChild(copy);
    footer.appendChild(chevron);
    footer.addEventListener("click", () => {
      if (state.unseen) {
        state.unseen.clear();
      }
      openNoteDrawer(null, "list");
      render();
    });
    root.appendChild(footer);
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
      const signature = noteSignature(items);
      if (signature === state.lastSignature && state.initialRefreshComplete) {
        state.initialRefreshComplete = true;
        return;
      }
      const previousVersions = new Map((Array.isArray(state.items) ? state.items : [])
        .filter((item) => item && item.id)
        .map((item) => [item.id, item.revision || item.updatedAt || ""]));
      const changedItems = state.initialRefreshComplete
        ? items.filter((item) => {
          if (!item || !item.id) {
            return false;
          }
          const nextVersion = item.revision || item.updatedAt || "";
          return !previousVersions.has(item.id) || previousVersions.get(item.id) !== nextVersion;
        })
        : [];
      state.lastSignature = signature;
      state.items = items;
      const liveIds = new Set(items.map((item) => item && item.id).filter(Boolean));
      Array.from(state.unseen.keys()).forEach((id) => {
        if (!liveIds.has(id)) {
          state.unseen.delete(id);
        }
      });
      changedItems.forEach((item) => {
        state.unseen.set(item.id, previousVersions.has(item.id) ? "updated" : "new");
        notifyNoteReady(item);
      });
      if (changedItems[0]) {
        state.highlightItemId = changedItems[0].id;
      }
      render();
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
