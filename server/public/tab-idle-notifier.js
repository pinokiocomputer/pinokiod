(() => {
  if (window.PinokioIdleNotifierInitialized) {
    return;
  }
  window.PinokioIdleNotifierInitialized = true;

  const PUSH_ENDPOINT = '/push';
  const TAB_UPDATED_SELECTOR = '.tab-updated';
  const CAN_NOTIFY_ATTR = 'data-can-notify';
  const FRAME_LINK_SELECTOR = '.frame-link';
  const LIVE_CLASS = 'is-live';
  const MAX_MESSAGE_PREVIEW = 140;
  const MIN_COMMAND_DURATION_MS = 2000;

  const tabStates = new Map();
  const observedIndicators = new WeakSet();
  const containerObservers = new WeakMap();
  const TAB_MAIN_CLASS = 'tab-main';
  const TAB_DETAILS_CLASS = 'tab-details';
  const PREF_STORAGE_KEY = 'pinokio:idle-prefs';
  const notifyPreferences = new Map();

  const hydratePreferences = () => {
    try {
      const raw = localStorage.getItem(PREF_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      Object.entries(parsed).forEach(([key, value]) => {
        notifyPreferences.set(key, Boolean(value));
      });
    } catch (error) {
      log('Failed to hydrate notification preferences', error);
    }
  };

  const persistPreferences = () => {
    try {
      const serialisable = {};
      notifyPreferences.forEach((value, key) => {
        serialisable[key] = value;
      });
      if (Object.keys(serialisable).length === 0) {
        localStorage.removeItem(PREF_STORAGE_KEY);
      } else {
        localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(serialisable));
      }
    } catch (error) {
      log('Failed to persist notification preferences', error);
    }
  };

  const getPreference = (frameName) => {
    if (!frameName) {
      return true;
    }
    if (notifyPreferences.has(frameName)) {
      return Boolean(notifyPreferences.get(frameName));
    }
    return true;
  };

  const setPreference = (frameName, enabled) => {
    if (!frameName) {
      return;
    }
    if (enabled) {
      notifyPreferences.delete(frameName);
    } else {
      notifyPreferences.set(frameName, false);
    }
    persistPreferences();
  };

  const DEBUG_STORAGE_KEY = 'pinokio:idle-debug';
  const readDebugFlag = () => {
    try {
      return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  };

  let DEBUG = readDebugFlag();
  const log = (...args) => {
    if (DEBUG) {
      console.debug('[PinokioIdleNotifier]', ...args);
    }
  };

  const updateDebugFlag = () => {
    DEBUG = readDebugFlag();
  };

  const aggregateDebounce = (fn, delay = 100) => {
    let timer = null;
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delay);
    };
  };

  hydratePreferences();

  let ensureIndicatorObservers;

  const escapeForSelector = (value) => {
    if (typeof value !== 'string') {
      return '';
    }
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/([\0-\x1F\x7F"\\#.:;?+*~\[\]\s])/g, '\\$1');
  };

  const getOrCreateState = (frameName) => {
    if (!frameName) {
      return null;
    }
    let state = tabStates.get(frameName);
    if (!state) {
      state = {
        hasRecentInput: false,
        awaitingLive: false,
        awaitingIdle: false,
        isLive: false,
        notified: false,
        lastInput: '',
        commandStartTimestamp: 0,
        lastLiveTimestamp: 0,
        lastActivityTimestamp: 0,
        notifyEnabled: getPreference(frameName),
      };
      tabStates.set(frameName, state);
      log('Created state for frame', frameName);
    } else if (typeof state.notifyEnabled === 'undefined') {
      state.notifyEnabled = getPreference(frameName);
    }
    return state;
  };

  const sanitisePreview = (value) => {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.length <= MAX_MESSAGE_PREVIEW) {
      return trimmed;
    }
    return `${trimmed.slice(0, MAX_MESSAGE_PREVIEW)}…`;
  };

  const extractFrameNameFromLink = (link) => {
    if (!link) {
      return null;
    }
    const attrCandidates = [
      'target',
      'data-target-full',
      'data-shell',
      'data-script',
    ];
    for (const attr of attrCandidates) {
      const value = link.getAttribute(attr);
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return '/pinokio-black.png';
  };

  const findLinkByFrameName = (frameName) => {
    if (!frameName) {
      return null;
    }
    const escaped = escapeForSelector(frameName);
    if (!escaped) {
      return null;
    }
    let link = document.querySelector(`${FRAME_LINK_SELECTOR}[target="${escaped}"]`);
    if (link) {
      return link;
    }
    link = document.querySelector(`${FRAME_LINK_SELECTOR}[data-target-full="${escaped}"]`);
    if (link) {
      return link;
    }
    return null;
  };

  const normaliseImageSrc = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const url = new URL(trimmed, window.location.origin);
      if (url.origin === window.location.origin) {
        if (url.pathname.startsWith('/asset/')) {
          return url.pathname;
        }
        return url.href;
      }
      return url.href;
    } catch (_) {
      if (trimmed.startsWith('/')) {
        return trimmed;
      }
      return null;
    }
  };

  const resolveTabImage = (link) => {
    if (!link) {
      return null;
    }
    const direct = link.querySelector('img.menu-item-image');
    if (direct) {
      const candidates = [direct.currentSrc, direct.src, direct.getAttribute('src')];
      for (const candidate of candidates) {
        const normalised = normaliseImageSrc(candidate);
        if (normalised) {
          return normalised;
        }
      }
    }
    const attrCandidates = ['data-iconpath', 'data-icon'];
    for (const attr of attrCandidates) {
      if (link.hasAttribute(attr)) {
        const normalised = normaliseImageSrc(link.getAttribute(attr));
        if (normalised) {
          return normalised;
        }
      }
    }
    return null;
  };

  const findIndicatorForFrame = (frameName) => {
    const link = findLinkByFrameName(frameName);
    if (!link) {
      return null;
    }
    return link.querySelector(TAB_UPDATED_SELECTOR);
  };

  const TOGGLE_CLASS = 'tab-notify-toggle';
  let toggleStylesInjected = false;

  const injectToggleStyles = () => {
    if (toggleStylesInjected) {
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
.${TOGGLE_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.85em;
  color: inherit;
  user-select: none;
}
.${TOGGLE_CLASS}[data-enabled="false"] {
  opacity: 0.45;
}
.frame-link .${TOGGLE_CLASS} i {
  font-size: 12px !important;
  pointer-events: none;
}
.frame-link .${TOGGLE_CLASS}:focus-visible {
  outline: 2px solid var(--pinokio-focus-color, #4c9afe);
  outline-offset: 2px;
}
`; // style injection for notify toggle
    document.head.appendChild(style);
    toggleStylesInjected = true;
  };

const syncToggleAppearance = (toggle, enabled) => {
  if (!toggle) {
    return;
  }
  const icon = toggle.querySelector('i') || toggle;
    icon.classList.add('fa-solid');
    icon.classList.toggle('fa-bell', enabled);
    icon.classList.toggle('fa-bell-slash', !enabled);
    toggle.dataset.enabled = enabled ? 'true' : 'false';
  toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  toggle.setAttribute('title', enabled ? 'Desktop notifications enabled' : 'Desktop notifications disabled');
  toggle.setAttribute('aria-label', enabled ? 'Disable desktop notifications for this tab' : 'Enable desktop notifications for this tab');
};

  const positionToggleWithinTab = (tab, toggle) => {
    if (!tab || !toggle) {
      return;
    }
    const container = tab.querySelector(`.${TAB_MAIN_CLASS}`) || tab;

    if (toggle.parentNode !== container) {
      container.insertBefore(toggle, container.firstChild);
    }

    const iconHost = Array.from(container.children).find((node) => {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'img') {
        return true;
      }
      if (tag === 'i' && node !== toggle && !node.classList.contains(TOGGLE_CLASS)) {
        return true;
      }
      return false;
    });

    if (iconHost) {
      if (iconHost.nextSibling !== toggle) {
        iconHost.parentNode.insertBefore(toggle, iconHost.nextSibling);
      }
    } else {
      const details = container.querySelector(`.${TAB_DETAILS_CLASS}`);
      if (details && details !== toggle) {
        if (details.previousSibling !== toggle) {
          container.insertBefore(toggle, details);
        }
      } else if (container.firstChild !== toggle) {
        container.insertBefore(toggle, container.firstChild);
      }
    }
  };

  const installToggleForLink = (link, frameName, state) => {
    if (!(link instanceof HTMLElement)) {
      return;
    }
    const tab = link.querySelector('.tab');
    if (!tab) {
      return;
    }
    let toggle = tab.querySelector(`.${TOGGLE_CLASS}`);
    if (!toggle) {
      injectToggleStyles();
      toggle = document.createElement('span');
      toggle.className = TOGGLE_CLASS;
      toggle.setAttribute('role', 'button');
      toggle.setAttribute('tabindex', '0');
      const icon = document.createElement('i');
      toggle.appendChild(icon);
      (tab.querySelector(`.${TAB_MAIN_CLASS}`) || tab).appendChild(toggle);

      const activate = () => {
        const current = getOrCreateState(frameName);
        if (!current) {
          return;
        }
        const next = !current.notifyEnabled;
        current.notifyEnabled = next;
        setPreference(frameName, next);
        syncToggleAppearance(toggle, next);
        log('Notification preference changed', { frameName, enabled: next });
      };

      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activate();
      });

      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
    }
    positionToggleWithinTab(tab, toggle);
    const container = tab.querySelector(`.${TAB_MAIN_CLASS}`) || tab;
    if (!containerObservers.has(container)) {
      const observer = new MutationObserver(() => {
        positionToggleWithinTab(tab, toggle);
      });
      observer.observe(container, { childList: true });
      containerObservers.set(container, observer);
    }
    syncToggleAppearance(toggle, state.notifyEnabled);
  };

const detachToggleForLink = (link) => {
  if (!(link instanceof HTMLElement)) {
    return;
  }
  const tab = link.querySelector('.tab');
  if (!tab) {
    return;
  }
  const toggle = tab.querySelector(`.${TOGGLE_CLASS}`);
  if (toggle && toggle.parentNode) {
    toggle.parentNode.removeChild(toggle);
  }
  const container = tab.querySelector(`.${TAB_MAIN_CLASS}`) || tab;
  const observer = containerObservers.get(container);
  if (observer) {
    observer.disconnect();
    containerObservers.delete(container);
  }
};

const ensureTabAccessories = aggregateDebounce(() => {
  document.querySelectorAll(FRAME_LINK_SELECTOR).forEach((link) => {
    if (!(link instanceof HTMLElement)) {
      return;
    }
    const frameName = extractFrameNameFromLink(link);
    if (!frameName) {
      detachToggleForLink(link);
      return;
    }
    const canNotify = link.getAttribute(CAN_NOTIFY_ATTR);
    if (canNotify !== 'true') {
      detachToggleForLink(link);
      return;
    }
    const state = getOrCreateState(frameName);
    if (!state) {
      return;
    }
    installToggleForLink(link, frameName, state);
  });
});

  ensureIndicatorObservers = aggregateDebounce(() => {
    document.querySelectorAll(TAB_UPDATED_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (observedIndicators.has(node)) {
        return;
      }
      indicatorObserver.observe(node, { attributes: true, attributeFilter: ['class', 'data-timestamp'] });
      observedIndicators.add(node);
      log('Observing indicator', node);
    });
    ensureTabAccessories();
  });

  const resolveFrameName = (frameHint, sourceWindow) => {
    if (typeof frameHint === 'string' && frameHint.length > 0) {
      return frameHint;
    }
    if (!sourceWindow) {
      return null;
    }
    const frames = document.querySelectorAll('iframe');
    for (const frame of frames) {
      if (frame.contentWindow === sourceWindow) {
        return frame.name || frame.dataset?.src || null;
      }
    }
    return null;
  };

  const sendNotification = (link, state) => {
    if (!link || !state) {
      return;
    }
    const tab = link.querySelector('.tab');
    const title = tab ? tab.textContent.trim() : 'Tab activity';
    //const subtitle = title || 'Pinokio';
    //const message = state.lastInput ? `Last input: ${state.lastInput}` : 'Tab is now idle.';
    const message = state.lastInput ? `From: "${state.lastInput}"` : "Tab is now idle."
    const image = resolveTabImage(link);

    const payload = {
      title: 'Pinokio',
      //subtitle,
      message,
      timeout: 60,
      sound: true,
      // Target this notification to this browser/device only
      audience: 'device',
      device_id: (typeof window !== 'undefined' && typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : undefined,
    };
    if (image) {
      payload.image = image;
    }

    try {
      log('Sending notification payload', payload);
      fetch(PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_) {
      // Ignore failures – desktop notifications are best-effort.
    }
  };

  const shouldNotify = (link) => {
    if (!link) {
      return false;
    }
    return true;
  };

  const updateActivityTimestamp = (indicator, state) => {
    if (!indicator || !state) {
      return;
    }
    const rawTimestamp = Number(indicator.dataset?.timestamp);
    if (Number.isFinite(rawTimestamp)) {
      state.lastActivityTimestamp = rawTimestamp;
    }
  };

  const handleIndicatorChange = (indicator, changedAttribute = 'class') => {
    const link = indicator.closest(FRAME_LINK_SELECTOR);
    if (!link) {
      return;
    }
    const frameName = extractFrameNameFromLink(link);
    if (!frameName) {
      return;
    }
    const state = getOrCreateState(frameName);
    if (!state) {
      return;
    }
    if (changedAttribute === 'data-timestamp') {
      updateActivityTimestamp(indicator, state);
      return;
    }

    const isLive = indicator.classList.contains(LIVE_CLASS);
    state.isLive = isLive;
    updateActivityTimestamp(indicator, state);
    log('Indicator change', { frameName, isLive, awaitingLive: state.awaitingLive, awaitingIdle: state.awaitingIdle });

    if (isLive) {
      state.lastLiveTimestamp = Date.now();
      if (!state.commandStartTimestamp) {
        state.commandStartTimestamp = state.lastActivityTimestamp || state.lastLiveTimestamp;
      }
      if (state.awaitingLive && state.hasRecentInput) {
        state.awaitingLive = false;
        state.awaitingIdle = true;
      }
      return;
    }

    if (state.awaitingIdle && state.hasRecentInput && !state.notified) {
      const activityTs = Number.isFinite(state.lastActivityTimestamp)
        ? state.lastActivityTimestamp
        : Number(indicator.dataset?.timestamp);
      const startTs = Number.isFinite(state.commandStartTimestamp)
        ? state.commandStartTimestamp
        : null;

      let runtimeMs = null;
      if (Number.isFinite(activityTs) && Number.isFinite(startTs) && activityTs >= startTs) {
        runtimeMs = activityTs - startTs;
      }

      if (runtimeMs !== null && runtimeMs < MIN_COMMAND_DURATION_MS) {
        log('Skipping idle notification (command completed quickly)', { frameName, runtimeMs });
      } else if (!state.notifyEnabled) {
        log('Notifications disabled for frame', frameName);
      } else if (shouldNotify(link)) {
        sendNotification(link, state);
        state.notified = true;
        log('Idle notification dispatched', { frameName, runtimeMs });
      }
    }

    state.hasRecentInput = false;
    state.awaitingIdle = false;
    state.awaitingLive = false;
    state.commandStartTimestamp = 0;
    state.lastLiveTimestamp = 0;
    state.lastActivityTimestamp = 0;
  };

  const indicatorObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        handleIndicatorChange(mutation.target, mutation.attributeName || 'class');
      }
    }
  });

  const treeObserver = new MutationObserver((mutations) => {
    let shouldRescan = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches(TAB_UPDATED_SELECTOR)) {
          indicatorObserver.observe(node, { attributes: true, attributeFilter: ['class', 'data-timestamp'] });
          observedIndicators.add(node);
          log('Observed newly added indicator', node);
          shouldRescan = true;
        } else if (node.classList && node.classList.contains('frame-link')) {
          shouldRescan = true;
        } else if (node.querySelector) {
          if (node.querySelector(TAB_UPDATED_SELECTOR) || node.querySelector(FRAME_LINK_SELECTOR)) {
            shouldRescan = true;
          }
        }
      }
    }
    if (shouldRescan) {
      ensureIndicatorObservers();
    }
  });

  const handleTerminalInput = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    const hasContent = typeof data.hasContent === 'boolean'
      ? data.hasContent
      : Boolean(data.line && data.line.length > 0);
    if (!hasContent) {
      return;
    }
    const frameName = resolveFrameName(data.frame, event.source);
    if (!frameName) {
      return;
    }
    const state = getOrCreateState(frameName);
    if (!state) {
      return;
    }
    state.hasRecentInput = true;
    state.awaitingLive = true;
    state.awaitingIdle = false;
    state.notified = false;
    state.lastInput = sanitisePreview(data.line || '');
    state.commandStartTimestamp = Date.now();
    state.lastActivityTimestamp = 0;
    state.lastLiveTimestamp = 0;
    log('Terminal input captured', { frameName, line: data.line, state: { ...state } });

    const indicator = findIndicatorForFrame(frameName);
    if (indicator && indicator.classList.contains(LIVE_CLASS)) {
      state.awaitingLive = false;
      state.awaitingIdle = true;
      log('Indicator already live when input arrived', frameName);
    }
  };

  const handleMessageEvent = (event) => {
    if (!event || typeof event.data !== 'object' || event.data === null) {
      return;
    }
    if (event.data.type === 'terminal-input') {
      handleTerminalInput(event);
    }
  };

  const initialise = () => {
    log('Initialising idle notifier');
    ensureIndicatorObservers();
    ensureTabAccessories();
    treeObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('message', handleMessageEvent, true);
    window.addEventListener('storage', (event) => {
      if (event.key === DEBUG_STORAGE_KEY) {
        updateDebugFlag();
        log('Debug flag updated via storage event');
      } else if (event.key === PREF_STORAGE_KEY) {
        notifyPreferences.clear();
        hydratePreferences();
        tabStates.forEach((state, frame) => {
          state.notifyEnabled = getPreference(frame);
        });
        ensureTabAccessories();
        log('Notification preferences refreshed from storage event');
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
  window.PinokioIdleNotifier = {
    enableDebug() {
      try {
        localStorage.setItem(DEBUG_STORAGE_KEY, '1');
      } catch (_) {}
      updateDebugFlag();
      log('Debug enabled');
    },
    disableDebug() {
      try {
        localStorage.removeItem(DEBUG_STORAGE_KEY);
      } catch (_) {}
      updateDebugFlag();
      log('Debug disabled');
    },
    refreshDebug: updateDebugFlag,
    forceScan() {
      ensureIndicatorObservers();
      ensureTabAccessories();
      log('Force scan triggered');
    }
  };
})();
