(() => {
  const configEl = document.getElementById('pinokio-layout-config');
  if (!configEl) {
    console.warn('[PinokioLayout] Missing configuration element.');
    return;
  }

  let parsedConfig = {};
  try {
    parsedConfig = JSON.parse(configEl.textContent || '{}');
  } catch (error) {
    console.error('[PinokioLayout] Failed to parse configuration JSON.', error);
    parsedConfig = {};
  }
  configEl.remove();

  const rootEl = document.getElementById('layout-root');
  if (!rootEl) {
    console.warn('[PinokioLayout] Missing layout root container.');
    return;
  }

  const HOST_ORIGIN = window.location.origin;
  const STORAGE_PREFIX = 'pinokio:layout:';
  const MIN_PANEL_SIZE = 120;
  const GUTTER_SIZE = 6;

  const state = {
    sessionId: typeof parsedConfig.sessionId === 'string' && parsedConfig.sessionId.trim() ? parsedConfig.sessionId.trim() : null,
    root: null,
    defaultPath: null,
    initialPath: null,
  };

  const nodeById = new Map();
  const parentById = new Map();
  const leafElements = new Map();
  const gutterElements = new Map();
  const layoutCache = new Map();
  const PRESERVED_QUERY_PARAMS = new Set(['session']);

  function stripTransientQueryParams() {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      const keys = Array.from(url.searchParams.keys());
      keys.forEach((key) => {
        if (!PRESERVED_QUERY_PARAMS.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      });
      if (changed) {
        window.history.replaceState(window.history.state, '', url.toString());
      }
    } catch (_) {
      // ignore malformed URLs
    }
  }

  function normalizeSrc(raw) {
    if (!raw || typeof raw !== 'string') {
      return state.defaultPath || '/home';
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return state.defaultPath || '/home';
    }
    try {
      const url = new URL(trimmed, HOST_ORIGIN);
      if (url.origin === HOST_ORIGIN) {
        if (url.pathname === '/') {
          url.pathname = '/home';
        }
        if (url.searchParams.has('embed')) {
          url.searchParams.delete('embed');
        }
        return url.pathname + url.search + url.hash;
      }
      return url.href;
    } catch (_) {
      if (trimmed.startsWith('/')) {
        try {
          const url = new URL(trimmed, HOST_ORIGIN);
          if (url.pathname === '/') {
            url.pathname = '/home';
          }
          if (url.searchParams.has('embed')) {
            url.searchParams.delete('embed');
          }
          return url.pathname + url.search + url.hash;
        } catch (err) {
          return trimmed;
        }
      }
      return trimmed;
    }
  }

  state.defaultPath = normalizeSrc(parsedConfig.defaultPath || '/home');
  state.initialPath = normalizeSrc(parsedConfig.initialPath || state.defaultPath);

  function storageKey(sessionId) {
    return `${STORAGE_PREFIX}${sessionId}`;
  }

  function generateId() {
    return 'f_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function sanitizeDirection(direction) {
    return direction === 'rows' ? 'rows' : 'columns';
  }

  function clampRatio(value) {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    return Math.min(0.95, Math.max(0.05, value));
  }

  function createLeaf(src, options = {}) {
    return {
      id: typeof options.id === 'string' ? options.id : generateId(),
      type: 'leaf',
      src: normalizeSrc(src || state.defaultPath),
    };
  }

  function createSplit(direction, first, second, ratio = 0.5, options = {}) {
    return {
      id: typeof options.id === 'string' ? options.id : generateId(),
      type: 'split',
      direction: sanitizeDirection(direction),
      ratio: clampRatio(ratio),
      children: [first, second],
    };
  }

  function hydrateNode(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    if (raw.type === 'split') {
      if (!Array.isArray(raw.children) || raw.children.length !== 2) {
        return null;
      }
      const first = hydrateNode(raw.children[0]);
      const second = hydrateNode(raw.children[1]);
      if (!first || !second) {
        return null;
      }
      return createSplit(raw.direction, first, second, typeof raw.ratio === 'number' ? raw.ratio : 0.5, { id: typeof raw.id === 'string' ? raw.id : undefined });
    }
    return createLeaf(raw.src, { id: typeof raw.id === 'string' ? raw.id : undefined });
  }

  function serializeNode(node) {
    if (!node) {
      return null;
    }
    if (node.type === 'split') {
      return {
        id: node.id,
        type: 'split',
        direction: node.direction,
        ratio: node.ratio,
        children: node.children.map(serializeNode),
      };
    }
    return {
      id: node.id,
      type: 'leaf',
      src: node.src,
    };
  }

  function rebuildNodeIndex() {
    nodeById.clear();
    parentById.clear();
    (function walk(node, parent, index) {
      if (!node) {
        return;
      }
      nodeById.set(node.id, node);
      if (parent) {
        parentById.set(node.id, { parentId: parent.id, index });
      }
      if (node.type === 'split') {
        node.children.forEach((child, idx) => walk(child, node, idx));
      }
    })(state.root, null, 0);
  }

  function ensureLeafElement(node) {
    if (!node || node.type !== 'leaf') {
      return null;
    }
    let entry = leafElements.get(node.id);
    if (entry) {
      return entry;
    }
    const container = document.createElement('div');
    container.className = 'layout-leaf';
    container.dataset.nodeId = node.id;

    const iframe = document.createElement('iframe');
    iframe.dataset.nodeId = node.id;
    iframe.name = node.id;
    iframe.src = node.src || state.defaultPath;
    iframe.setAttribute('allow', 'fullscreen *;');
    iframe.setAttribute('allowfullscreen', '');

    container.appendChild(iframe);
    rootEl.appendChild(container);

    const updateNodeLocation = () => {
      if (!nodeById.has(node.id)) {
        return;
      }
      let resolved;
      try {
        if (iframe.contentWindow && iframe.contentWindow.location) {
          resolved = iframe.contentWindow.location.href;
        }
      } catch (_) {
        resolved = iframe.dataset.src || iframe.src;
      }
      if (resolved) {
        node.src = normalizeSrc(resolved);
        iframe.dataset.src = node.src;
        saveStateToStorage();
      }
    };

    iframe.addEventListener('load', updateNodeLocation);

    entry = { container, iframe, updateNodeLocation };
    leafElements.set(node.id, entry);
    return entry;
  }

  function removeLeafElement(nodeId) {
    const entry = leafElements.get(nodeId);
    if (!entry) {
      return;
    }
    if (entry.container.parentNode === rootEl) {
      rootEl.removeChild(entry.container);
    } else {
      entry.container.remove();
    }
    leafElements.delete(nodeId);
  }

  function ensureGutterElement(node) {
    let gutter = gutterElements.get(node.id);
    if (gutter) {
      return gutter;
    }
    gutter = document.createElement('div');
    gutter.className = `layout-gutter layout-gutter-${node.direction}`;
    gutter.dataset.nodeId = node.id;
    gutter.tabIndex = 0;
    gutter.setAttribute('role', 'separator');
    gutter.setAttribute('aria-orientation', node.direction === 'rows' ? 'horizontal' : 'vertical');
    rootEl.appendChild(gutter);
    gutterElements.set(node.id, gutter);
    return gutter;
  }

  function removeGutterElement(splitId) {
    const gutter = gutterElements.get(splitId);
    if (!gutter) {
      return;
    }
    gutter.remove();
    gutterElements.delete(splitId);
  }

  function loadStateFromStorage() {
    if (!state.sessionId) {
      return false;
    }
    try {
      const raw = window.localStorage.getItem(storageKey(state.sessionId));
      if (!raw) {
        return false;
      }
      const parsed = JSON.parse(raw);
      const hydrated = hydrateNode(parsed);
      if (!hydrated) {
        return false;
      }
      state.root = hydrated;
      return true;
    } catch (error) {
      console.warn('[PinokioLayout] Failed to load layout for session', state.sessionId, error);
      return false;
    }
  }

  function saveStateToStorage() {
    if (!state.sessionId || !state.root) {
      return;
    }
    try {
      const serialized = serializeNode(state.root);
      const payload = JSON.stringify(serialized);
      window.localStorage.setItem(storageKey(state.sessionId), payload);
    } catch (error) {
      console.warn('[PinokioLayout] Failed to persist layout state', error);
    }
  }

  function ensureSession() {
    if (state.sessionId) {
      return state.sessionId;
    }
    state.sessionId = generateId();
    const url = new URL(window.location.href);
    url.searchParams.set('session', state.sessionId);
    window.history.replaceState(window.history.state, '', url.toString());
    return state.sessionId;
  }

  function cleanupSessionIfSingleLeaf() {
    if (!state.root || state.root.type !== 'leaf') {
      return;
    }
    if (!state.sessionId) {
      ensureSession();
    }
    saveStateToStorage();
  }

  function getNodeInfo(nodeId) {
    const node = nodeById.get(nodeId);
    if (!node) {
      return null;
    }
    const parentMeta = parentById.get(nodeId) || null;
    const parent = parentMeta ? nodeById.get(parentMeta.parentId) || null : null;
    const index = parentMeta ? parentMeta.index : null;
    return { node, parent, index };
  }

  function captureLeafSnapshot(nodeId) {
    const entry = leafElements.get(nodeId);
    if (!entry) {
      return;
    }
    const { iframe } = entry;
    try {
      if (iframe.contentWindow && iframe.contentWindow.location) {
        iframe.dataset.src = iframe.contentWindow.location.href;
      }
    } catch (_) {
      iframe.dataset.src = iframe.src;
    }
    if (iframe.dataset.src) {
      const node = nodeById.get(nodeId);
      if (node && node.type === 'leaf') {
        node.src = normalizeSrc(iframe.dataset.src);
      }
    }
  }

  function layoutLeaves(node, bounds, activeLeafIds, activeSplitIds) {
    if (!node) {
      return;
    }
    layoutCache.set(node.id, bounds);
    if (node.type === 'leaf') {
      activeLeafIds.add(node.id);
      const entry = ensureLeafElement(node);
      if (entry) {
        entry.container.style.left = `${bounds.x}px`;
        entry.container.style.top = `${bounds.y}px`;
        entry.container.style.width = `${Math.max(0, bounds.width)}px`;
        entry.container.style.height = `${Math.max(0, bounds.height)}px`;
      }
      return;
    }

    activeSplitIds.add(node.id);

    const direction = node.direction;
    const ratio = clampRatio(node.ratio);
    let firstBounds;
    let secondBounds;

    if (direction === 'rows') {
      const total = bounds.height;
      const gutter = Math.min(GUTTER_SIZE, total);
      const firstSize = Math.max(MIN_PANEL_SIZE, Math.min(total - MIN_PANEL_SIZE, total * ratio));
      const secondSize = Math.max(0, total - gutter - firstSize);
      firstBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: firstSize };
      secondBounds = { x: bounds.x, y: bounds.y + firstSize + gutter, width: bounds.width, height: secondSize };
      node.ratio = clampRatio(firstSize / total);
    } else {
      const total = bounds.width;
      const gutter = Math.min(GUTTER_SIZE, total);
      const firstSize = Math.max(MIN_PANEL_SIZE, Math.min(total - MIN_PANEL_SIZE, total * ratio));
      const secondSize = Math.max(0, total - gutter - firstSize);
      firstBounds = { x: bounds.x, y: bounds.y, width: firstSize, height: bounds.height };
      secondBounds = { x: bounds.x + firstSize + gutter, y: bounds.y, width: secondSize, height: bounds.height };
      node.ratio = clampRatio(firstSize / total);
    }

    const gutterEl = ensureGutterElement(node);
    if (direction === 'rows') {
      const gutterHeight = Math.min(GUTTER_SIZE, bounds.height);
      gutterEl.style.left = `${bounds.x}px`;
      gutterEl.style.width = `${bounds.width}px`;
      gutterEl.style.top = `${firstBounds.y + firstBounds.height}px`;
      gutterEl.style.height = `${gutterHeight}px`;
    } else {
      const gutterWidth = Math.min(GUTTER_SIZE, bounds.width);
      gutterEl.style.left = `${firstBounds.x + firstBounds.width}px`;
      gutterEl.style.width = `${gutterWidth}px`;
      gutterEl.style.top = `${bounds.y}px`;
      gutterEl.style.height = `${bounds.height}px`;
    }

    layoutLeaves(node.children[0], firstBounds, activeLeafIds, activeSplitIds);
    layoutLeaves(node.children[1], secondBounds, activeLeafIds, activeSplitIds);
  }

  function applyLayout() {
    if (!state.root) {
      return;
    }
    const rect = rootEl.getBoundingClientRect();
    const rootBounds = { x: 0, y: 0, width: rect.width, height: rect.height };
    const activeLeafIds = new Set();
    const activeSplitIds = new Set();

    layoutCache.clear();
    layoutLeaves(state.root, rootBounds, activeLeafIds, activeSplitIds);

    leafElements.forEach((entry, id) => {
      if (!activeLeafIds.has(id)) {
        removeLeafElement(id);
      }
    });
    gutterElements.forEach((_, id) => {
      if (!activeSplitIds.has(id)) {
        removeGutterElement(id);
      }
    });
  }

  function broadcastLayoutState(targetWindow = null, frameId = null) {
    const closable = leafElements.size > 1;
    const total = leafElements.size;
    const payload = {
      e: 'layout-state',
      closable,
      total,
    };
    if (frameId) {
      payload.frameId = frameId;
    }
    const sendToWindow = (win) => {
      if (!win) {
        return;
      }
      try {
        win.postMessage(payload, '*');
      } catch (_) {}
    };
    if (targetWindow) {
      sendToWindow(targetWindow);
      return;
    }
    leafElements.forEach((entry) => {
      sendToWindow(entry.iframe?.contentWindow || null);
    });
  }

  let activeResize = null;

  function beginResize(splitId, pointerEvent) {
    const splitNode = nodeById.get(splitId);
    if (!splitNode || splitNode.type !== 'split') {
      return;
    }
    const firstNode = splitNode.children[0];
    const secondNode = splitNode.children[1];
    const firstBounds = layoutCache.get(firstNode.id);
    const secondBounds = layoutCache.get(secondNode.id);
    const parentBounds = layoutCache.get(splitNode.id);
    if (!firstBounds || !secondBounds || !parentBounds) {
      return;
    }

    const direction = splitNode.direction;
    const startCoord = direction === 'rows' ? pointerEvent.clientY : pointerEvent.clientX;
    const firstSize = direction === 'rows' ? firstBounds.height : firstBounds.width;
    const secondSize = direction === 'rows' ? secondBounds.height : secondBounds.width;
    const gutterSize = Math.min(GUTTER_SIZE, direction === 'rows' ? parentBounds.height : parentBounds.width);
    const total = firstSize + secondSize + gutterSize;

    activeResize = {
      splitId,
      direction,
      startCoord,
      firstSize,
      total,
    };

    document.body.classList.add('layout-resizing');
    document.body.classList.toggle('layout-resize-rows', direction === 'rows');
    document.body.classList.toggle('layout-resize-columns', direction === 'columns');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
  }

  function onPointerMove(event) {
    if (!activeResize) {
      return;
    }
    const splitNode = nodeById.get(activeResize.splitId);
    if (!splitNode || splitNode.type !== 'split') {
      return;
    }

    const rootRect = rootEl.getBoundingClientRect();
    const currentCoord = activeResize.direction === 'rows' ? event.clientY : event.clientX;
    const delta = currentCoord - activeResize.startCoord;
    const newPrimary = Math.max(MIN_PANEL_SIZE, Math.min(activeResize.total - MIN_PANEL_SIZE, activeResize.firstSize + delta));
    const ratio = newPrimary / activeResize.total;
    splitNode.ratio = clampRatio(ratio);
    applyLayout();
    saveStateToStorage();
  }

  function endResize() {
    if (!activeResize) {
      return;
    }
    activeResize = null;
    document.body.classList.remove('layout-resizing', 'layout-resize-rows', 'layout-resize-columns');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endResize);
    window.removeEventListener('pointercancel', endResize);
    saveStateToStorage();
  }

  function attachGutterHandlers() {
    gutterElements.forEach((gutter, splitId) => {
      gutter.onpointerdown = null;
      gutter.onpointerdown = (event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        beginResize(splitId, event);
      };

      gutter.onkeydown = null;
      gutter.onkeydown = (event) => {
        const splitNode = nodeById.get(splitId);
        if (!splitNode || splitNode.type !== 'split') {
          return;
        }
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          const next = clampRatio(splitNode.ratio - step);
          splitNode.ratio = next;
          applyLayout();
          attachGutterHandlers();
          saveStateToStorage();
          event.preventDefault();
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          const next = clampRatio(splitNode.ratio + step);
          splitNode.ratio = next;
          applyLayout();
          attachGutterHandlers();
          saveStateToStorage();
          event.preventDefault();
        }
      };
    });
  }

  function splitLeaf(frameId, direction, targetUrl) {
    const info = getNodeInfo(frameId);
    if (!info || info.node.type !== 'leaf') {
      console.warn('[PinokioLayout] Unable to locate leaf to split', frameId);
      return false;
    }

    captureLeafSnapshot(frameId);

    const existingLeaf = info.node;
    const newLeaf = createLeaf(targetUrl);
    ensureLeafElement(newLeaf);

    const splitNode = createSplit(direction, existingLeaf, newLeaf, 0.5);

    if (!info.parent) {
      state.root = splitNode;
    } else {
      info.parent.children[info.index] = splitNode;
    }

    ensureSession();
    rebuildNodeIndex();
    applyLayout();
    attachGutterHandlers();
    saveStateToStorage();
    broadcastLayoutState();
    return true;
  }

  function closeLeaf(frameId) {
    const info = getNodeInfo(frameId);
    if (!info || info.node.type !== 'leaf') {
      return false;
    }

    captureLeafSnapshot(frameId);

    const parentNode = info.parent;
    if (!parentNode) {
      const leaf = info.node;
      leaf.src = state.defaultPath;
      const entry = leafElements.get(leaf.id);
      if (entry) {
        entry.iframe.src = leaf.src;
      }
      cleanupSessionIfSingleLeaf();
      applyLayout();
      broadcastLayoutState();
      return true;
    }

    const siblingIndex = info.index === 0 ? 1 : 0;
    const siblingNode = parentNode.children[siblingIndex];
    const grandMeta = parentById.get(parentNode.id) || null;
    const grandParent = grandMeta ? nodeById.get(grandMeta.parentId) || null : null;

    if (grandParent) {
      grandParent.children[grandMeta.index] = siblingNode;
    } else {
      state.root = siblingNode;
    }

    removeLeafElement(info.node.id);
    removeGutterElement(parentNode.id);

    rebuildNodeIndex();
    applyLayout();
    attachGutterHandlers();
    cleanupSessionIfSingleLeaf();
    saveStateToStorage();
    broadcastLayoutState();
    return true;
  }

  function onMessage(event) {
    if (!event || !event.data || typeof event.data !== 'object') {
      return;
    }
    if (event.data.e === 'layout-state-request') {
      let frameEntry = null;
      let frameId = null;
      for (const entry of leafElements.values()) {
        if (entry.iframe && entry.iframe.contentWindow === event.source) {
          frameEntry = entry;
          frameId = entry.iframe.dataset?.nodeId || null;
          break;
        }
      }
      broadcastLayoutState(event.source, frameId);
      return;
    }
    if (event.data.e === 'layout-split-request') {
      const { requestId = null, direction = null, targetUrl = null } = event.data;
      let ok = false;
      if (direction && targetUrl) {
        let frameId = null;
        for (const [id, entry] of leafElements.entries()) {
          if (entry.iframe && entry.iframe.contentWindow === event.source) {
            frameId = id;
            break;
          }
        }
        if (frameId) {
          const nextDirection = direction === 'rows' ? 'rows' : 'columns';
          try {
            ok = splitLeaf(frameId, nextDirection, normalizeSrc(targetUrl));
            if (ok) {
              ensureSession();
            }
          } catch (error) {
            console.error('[PinokioLayout] Split via message failed', error);
            ok = false;
          }
        } else {
          console.warn('[PinokioLayout] Unable to resolve frame for split request');
        }
      }
      try {
        event.source?.postMessage({
          e: 'layout-split-response',
          requestId,
          ok,
        }, event.origin || '*');
      } catch (error) {
        console.warn('[PinokioLayout] Failed to respond to split request', error);
      }
      return;
    }
    if (event.data.e === 'close') {
      const frameId = (() => {
        for (const [id, entry] of leafElements.entries()) {
          if (entry.iframe.contentWindow === event.source) {
            return id;
          }
        }
        return null;
      })();
      if (frameId) {
        closeLeaf(frameId);
      }
    }
  }

  function initLayout() {
    const restored = loadStateFromStorage();
    if (!restored) {
      state.root = createLeaf(state.initialPath || state.defaultPath);
      ensureSession();
      saveStateToStorage();
    }

    rebuildNodeIndex();

    nodeById.forEach((node) => {
      if (node.type === 'leaf') {
        const entry = ensureLeafElement(node);
        if (entry && entry.iframe.src !== node.src) {
          entry.iframe.src = node.src;
        }
      }
    });

    applyLayout();
    attachGutterHandlers();
    broadcastLayoutState();
    stripTransientQueryParams();
  }

  let resizeScheduled = false;
  function onResize() {
    if (resizeScheduled) {
      return;
    }
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      applyLayout();
      attachGutterHandlers();
    });
  }

  initLayout();
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', onResize);
  window.addEventListener('pinokio:viewport-change', onResize);

  const api = {
    split({ frameId, direction, targetUrl }) {
      if (!frameId || !direction || !targetUrl) {
        return false;
      }
      try {
        return splitLeaf(frameId, direction, normalizeSrc(targetUrl));
      } catch (error) {
        console.error('[PinokioLayout] Split failed', error);
        return false;
      }
    },
    close(frameId) {
      try {
        return closeLeaf(frameId);
      } catch (error) {
        console.error('[PinokioLayout] Close failed', error);
        return false;
      }
    },
    ensureSession,
    getSessionId() {
      return state.sessionId;
    },
    save: saveStateToStorage,
  };

  window.PinokioLayout = api;
  // Mobile "Tap to connect" curtain is centralized in common.js to avoid duplicates
  
  // Top-level notification listener (indicator + optional chime) for mobile
  (function initTopLevelNotificationListener() {
    try { if (window.top && window.top !== window) return; } catch (_) { return; }
    if (window.__pinokioTopNotifyListener) {
      return;
    }
    window.__pinokioTopNotifyListener = true;

    const ensureIndicator = (() => {
      let el = null;
      let styleInjected = false;
      return () => {
        if (!styleInjected) {
          const style = document.createElement('style');
          style.textContent = `
.pinokio-notify-indicator{position:fixed;top:12px;right:12px;z-index:2147483647;display:none;align-items:center;gap:8px;padding:8px 10px;border-radius:999px;background:rgba(15,23,42,0.92);color:#fff;font:600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.35)}
.pinokio-notify-indicator .bell{font-size:14px}
.pinokio-notify-indicator.show{display:inline-flex;animation:pinokioNotifyPop 160ms ease-out, pinokioNotifyFade 1600ms ease-in 700ms forwards}
@keyframes pinokioNotifyPop{from{transform:translateY(-6px) scale(.98);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
@keyframes pinokioNotifyFade{to{opacity:0;transform:translateY(-4px)}}
@media (max-width: 768px){.pinokio-notify-indicator{top:10px;right:10px;padding:7px 9px;font-size:12px}}
          `;
          document.head.appendChild(style);
          styleInjected = true;
        }
        if (!el) {
          el = document.createElement('div');
          el.className = 'pinokio-notify-indicator';
          const icon = document.createElement('span');
          icon.className = 'bell';
          icon.textContent = '🔔';
          const text = document.createElement('span');
          text.className = 'text';
          text.textContent = 'Notification received';
          el.appendChild(icon);
          el.appendChild(text);
          document.body.appendChild(el);
        }
        return el;
      };
    })();

    const flashIndicator = (message) => {
      const node = ensureIndicator();
      const text = node.querySelector('.text');
      if (text) {
        const msg = (message && typeof message === 'string' && message.trim()) ? message.trim() : 'Notification received';
        text.textContent = msg.length > 80 ? (msg.slice(0,77) + '…') : msg;
      }
      node.classList.remove('show');
      void node.offsetWidth;
      node.classList.add('show');
      setTimeout(() => node.classList.remove('show'), 2400);
    };

    const isFalseyString = (value) => {
      return typeof value === 'string' && ['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
    };

    const tryPlay = (url) => {
      if (!url || url === false || isFalseyString(url)) {
        return;
      }
      try {
        const isString = typeof url === 'string';
        const trimmed = isString ? url.trim() : '';
        const hasCustom = isString && trimmed.length > 0 && trimmed.toLowerCase() !== 'true';
        const src = hasCustom ? url : '/chime.mp3';
        let a = window.__pinokioChimeAudio;
        if (!a) {
          a = new Audio(src);
          a.preload = 'auto';
          a.loop = false;
          a.muted = false;
          window.__pinokioChimeAudio = a;
        } else {
          try { if (a.src && !a.src.endsWith(src)) a.src = src; } catch (_) {}
        }
        try { a.currentTime = 0; } catch (_) {}
        const p = a.play();
        if (p && typeof p.catch === 'function') { p.catch(() => {}); }
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(80); } catch (_) {}
        }
      } catch (_) {}
    };

    const listen = () => {
      const SocketCtor = typeof window.Socket === 'function' ? window.Socket : (typeof Socket === 'function' ? Socket : null);
      if (!SocketCtor || typeof WebSocket === 'undefined') {
        return;
      }
      const socket = new SocketCtor();
      try {
        socket.run({ method: 'kernel.notifications', mode: 'listen', device_id: (typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : undefined }, (packet) => {
          if (!packet || packet.id !== 'kernel.notifications' || packet.type !== 'notification') {
            return;
          }
          const payload = packet.data || {};
          // If targeted to a specific device, ignore only when our id exists and mismatches
          try {
            const targetId = (typeof payload.device_id === 'string' && payload.device_id.trim()) ? payload.device_id.trim() : null;
            if (targetId) {
              const myId = (typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : null;
              if (myId && myId !== targetId) return;
            }
          } catch (_) {}
          flashIndicator(payload.message);
          tryPlay(payload.sound);
        }).then(() => {
          // socket closed; ignore
        }).catch(() => {});
        window.__pinokioTopNotifySocket = socket;
      } catch (_) {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', listen, { once: true });
    } else {
      listen();
    }
  })();
})();
