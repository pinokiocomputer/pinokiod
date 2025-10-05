(() => {
  if (window.PinokioIdleNotifierInitialized) {
    return;
  }
  window.PinokioIdleNotifierInitialized = true;

  const PUSH_ENDPOINT = '/push';
  const TAB_UPDATED_SELECTOR = '.tab-updated';
  const FRAME_LINK_SELECTOR = '.frame-link';
  const LIVE_CLASS = 'is-live';
  const MAX_MESSAGE_PREVIEW = 140;

  const tabStates = new Map();
  const observedIndicators = new WeakSet();

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

  const ensureIndicatorObservers = aggregateDebounce(() => {
    document.querySelectorAll(TAB_UPDATED_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (observedIndicators.has(node)) {
        return;
      }
      indicatorObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
      observedIndicators.add(node);
      log('Observing indicator', node);
    });
  });

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
        lastLiveTimestamp: 0,
      };
      tabStates.set(frameName, state);
      log('Created state for frame', frameName);
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
    return null;
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

  const findIndicatorForFrame = (frameName) => {
    const link = findLinkByFrameName(frameName);
    if (!link) {
      return null;
    }
    return link.querySelector(TAB_UPDATED_SELECTOR);
  };

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
    const subtitle = title || 'Pinokio';
    const message = state.lastInput ? `Last input: ${state.lastInput}` : 'Tab is now idle.';

    const payload = {
      title: 'Pinokio',
      icon: "/pinokio-black.png",
      subtitle,
      message,
      sound: true,
      timeout: 60,
    };

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

  const handleIndicatorChange = (indicator) => {
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
    const isLive = indicator.classList.contains(LIVE_CLASS);
    state.isLive = isLive;
    log('Indicator change', { frameName, isLive, awaitingLive: state.awaitingLive, awaitingIdle: state.awaitingIdle });

    if (isLive) {
      state.lastLiveTimestamp = Date.now();
      if (state.awaitingLive && state.hasRecentInput) {
        state.awaitingLive = false;
        state.awaitingIdle = true;
      }
      return;
    }

    if (state.awaitingIdle && state.hasRecentInput && !state.notified) {
      if (shouldNotify(link)) {
        sendNotification(link, state);
        state.notified = true;
        log('Idle notification dispatched', frameName);
      }
    }

    state.hasRecentInput = false;
    state.awaitingIdle = false;
    state.awaitingLive = false;
  };

  const indicatorObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        handleIndicatorChange(mutation.target);
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
          indicatorObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
          observedIndicators.add(node);
          log('Observed newly added indicator', node);
        } else if (node.querySelector) {
          if (node.querySelector(TAB_UPDATED_SELECTOR)) {
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
    treeObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('message', handleMessageEvent, true);
    window.addEventListener('storage', (event) => {
      if (event.key === DEBUG_STORAGE_KEY) {
        updateDebugFlag();
        log('Debug flag updated via storage event');
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
      log('Force scan triggered');
    }
  };
})();
