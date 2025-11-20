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
  const SOUND_PREF_STORAGE_KEY = 'pinokio:idle-sound';
  const SOUND_DEFAULT_CHOICE = '__default__';
  const SOUND_SILENT_CHOICE = '__silent__';
  const SOUND_LIST_ENDPOINT = '/pinokio/notification-sounds';
  const DEFAULT_SOUND_URL = '/chime.mp3';
  let globalSoundPreference = { choice: SOUND_DEFAULT_CHOICE };
  let soundOptionsCache = null;
  let soundOptionsPromise = null;
  let previewAudio = null;
  let soundMenuNode = null;
  let soundMenuContent = null;
  let openMenuContext = null;
  const MENU_KEY_TOGGLE = 'toggle';
  let dismissOverlay = null;

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
      console.log('Failed to hydrate notification preferences', error);
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
      console.log('Failed to persist notification preferences', error);
    }
  };

  const normaliseSoundAssetPath = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (!withLeading.startsWith('/sound/')) {
      return null;
    }
    try {
      const decoded = decodeURIComponent(withLeading);
      if (decoded.includes('..')) {
        return null;
      }
    } catch (_) {
      if (withLeading.includes('..')) {
        return null;
      }
    }
    return withLeading;
  };

  const normaliseSoundChoice = (value) => {
    if (value === SOUND_SILENT_CHOICE) {
      return SOUND_SILENT_CHOICE;
    }
    if (value === SOUND_DEFAULT_CHOICE) {
      return SOUND_DEFAULT_CHOICE;
    }
    const asset = normaliseSoundAssetPath(value);
    if (asset) {
      return asset;
    }
    return SOUND_DEFAULT_CHOICE;
  };

  const hydrateSoundPreference = () => {
    globalSoundPreference = { choice: SOUND_DEFAULT_CHOICE };
    try {
      const raw = localStorage.getItem(SOUND_PREF_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed !== null) {
        globalSoundPreference.choice = normaliseSoundChoice(parsed.choice);
      }
    } catch (error) {
      console.log('Failed to hydrate sound preference', error);
      globalSoundPreference = { choice: SOUND_DEFAULT_CHOICE };
    }
  };

  const persistSoundPreference = () => {
    try {
      const choice = globalSoundPreference?.choice;
      if (!choice || choice === SOUND_DEFAULT_CHOICE) {
        localStorage.removeItem(SOUND_PREF_STORAGE_KEY);
        return;
      }
      localStorage.setItem(SOUND_PREF_STORAGE_KEY, JSON.stringify({ choice }));
    } catch (error) {
      console.log('Failed to persist sound preference', error);
    }
  };

  const escapeHtml = (value) => {
    if (typeof value !== 'string') {
      return '';
    }
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const resolveNotificationSound = () => {
    const choice = globalSoundPreference?.choice;
    if (choice === SOUND_SILENT_CHOICE) {
      return false;
    }
    const asset = normaliseSoundAssetPath(choice);
    if (asset) {
      return asset;
    }
    return true;
  };

  const baseSoundOptions = () => ([
    { value: SOUND_DEFAULT_CHOICE, label: 'Default Chime', preview: DEFAULT_SOUND_URL },
    { value: SOUND_SILENT_CHOICE, label: 'Silent', preview: null },
  ]);

  const loadSoundOptions = () => {
    if (soundOptionsCache) {
      return Promise.resolve(soundOptionsCache.map((option) => ({ ...option })));
    }
    if (!soundOptionsPromise) {
      soundOptionsPromise = fetch(SOUND_LIST_ENDPOINT, { credentials: 'include' })
        .then((response) => {
          if (!response || !response.ok) {
            throw new Error(`Failed to load sound list (${response ? response.status : 'no response'})`);
          }
          return response.json();
        })
        .then((data) => {
          const dynamic = Array.isArray(data?.sounds) ? data.sounds : [];
          const mapped = dynamic
            .map((item) => {
              if (!item || typeof item.url !== 'string') {
                return null;
              }
              const asset = normaliseSoundAssetPath(item.url || item.id || item.filename);
              if (!asset) {
                return null;
              }
              const label = typeof item.label === 'string' && item.label.trim()
                ? item.label.trim()
                : (typeof item.filename === 'string' && item.filename.trim()
                  ? item.filename.trim()
                  : asset.replace(/^\/+/, ''));
              return {
                value: asset,
                label,
                preview: asset,
              };
            })
            .filter((option) => option && option.value && option.label);

          const deduped = new Map();
          baseSoundOptions().forEach((option) => {
            deduped.set(option.value, option);
          });
          mapped.forEach((option) => {
            deduped.set(option.value, option);
          });
          soundOptionsCache = Array.from(deduped.values());
          return soundOptionsCache.map((option) => ({ ...option }));
        })
        .catch((error) => {
          console.log('Failed to load notification sound list', error);
          return baseSoundOptions().map((option) => ({ ...option }));
        })
        .finally(() => {
          soundOptionsPromise = null;
        });
    }
    return soundOptionsPromise.then((options) => options.map((option) => ({ ...option })));
  };

  const getPreviewUrlForChoice = (choice) => {
    if (choice === SOUND_SILENT_CHOICE) {
      return null;
    }
    const asset = normaliseSoundAssetPath(choice);
    if (asset) {
      return asset;
    }
    return DEFAULT_SOUND_URL;
  };

  const playSoundPreview = (choice) => {
    const url = getPreviewUrlForChoice(choice);
    if (!url) {
      return;
    }
    try {
      if (!previewAudio) {
        previewAudio = new Audio();
        previewAudio.preload = 'auto';
        previewAudio.loop = false;
        previewAudio.muted = false;
      }
      const resolved = new URL(url, window.location.origin).toString();
      if (previewAudio.src !== resolved) {
        previewAudio.src = resolved;
      }
      try {
        previewAudio.currentTime = 0;
      } catch (_) {}
      const result = previewAudio.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (error) {
      console.log('Failed to play sound preview', error);
    }
  };

  const getMenuKeyForSoundValue = (value) => `sound:${value}`;

  const getMenuItems = () => {
    if (!soundMenuContent) {
      return [];
    }
    return Array.from(soundMenuContent.querySelectorAll('[data-menu-item="true"]'));
  };

  const positionSoundMenu = (menu, anchor) => {
    if (!menu || !anchor || typeof anchor.getBoundingClientRect !== 'function') {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const top = rect.bottom + scrollY + 6;
    let left = rect.left + scrollX;
    const menuWidth = menu.offsetWidth || 0;
    const viewportRight = scrollX + window.innerWidth;
    if (left + menuWidth > viewportRight - 12) {
      left = Math.max(scrollX + 12, viewportRight - menuWidth - 12);
    }
    if (left < scrollX + 12) {
      left = scrollX + 12;
    }
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  };

  const updateMenuPosition = () => {
    if (!openMenuContext || !soundMenuNode) {
      return;
    }
    positionSoundMenu(soundMenuNode, openMenuContext.toggle);
  };

  const closeSoundMenu = (focusAnchor = false) => {
    if (!openMenuContext) {
      return;
    }
    const { toggle } = openMenuContext;
    if (soundMenuNode) {
      soundMenuNode.classList.remove('is-open');
      soundMenuNode.setAttribute('aria-hidden', 'true');
      soundMenuNode.style.top = '-9999px';
      soundMenuNode.style.left = '-9999px';
    }
    if (dismissOverlay && dismissOverlay.parentNode) {
      dismissOverlay.parentNode.removeChild(dismissOverlay);
    }
    dismissOverlay = null;
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
    }
    const shouldFocus = focusAnchor && toggle && typeof toggle.focus === 'function';
    openMenuContext = null;
    if (shouldFocus) {
      try { toggle.focus(); } catch (_) {}
    }
  };

  const renderSoundMenu = (context, { options, loading } = {}) => {
    if (!context) {
      return;
    }
    const effectiveOptions = Array.isArray(options) && options.length > 0
      ? options
      : (soundOptionsCache && soundOptionsCache.length > 0 ? soundOptionsCache : baseSoundOptions());
    if (!soundMenuContent) {
      return;
    }
    const selectedChoice = globalSoundPreference?.choice || SOUND_DEFAULT_CHOICE;
    const tabEnabled = context.state ? Boolean(context.state.notifyEnabled) : true;
    const previousActive = (soundMenuContent.contains(document.activeElement) && document.activeElement instanceof HTMLElement)
      ? document.activeElement.getAttribute('data-menu-key')
      : context.focusKey || null;

    const soundItems = effectiveOptions.map((option) => {
      const value = option.value;
      const key = getMenuKeyForSoundValue(value);
      const isSelected = value === selectedChoice
        || (value === SOUND_DEFAULT_CHOICE && (selectedChoice === SOUND_DEFAULT_CHOICE || !selectedChoice));
      const label = option.label || 'Sound';
      const meta = value === SOUND_SILENT_CHOICE ? 'No sound' : (value === SOUND_DEFAULT_CHOICE ? 'Default' : null);
      const safeValue = escapeHtml(value);
      const safeLabel = escapeHtml(label);
      const safeMeta = meta ? escapeHtml(meta) : '';
      const safeKey = escapeHtml(key);
      return `
        <button type="button" class="pinokio-notify-item" data-menu-item="true" data-role="sound-option" data-sound-value="${safeValue}" data-menu-key="${safeKey}" role="menuitemradio" aria-checked="${isSelected ? 'true' : 'false'}" ${isSelected ? 'data-selected="true"' : ''}>
          <span class="pinokio-notify-item-icon">${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}</span>
          <span class="pinokio-notify-item-label">${safeLabel}</span>
          ${meta ? `<span class="pinokio-notify-item-meta">${safeMeta}</span>` : ''}
        </button>
      `;
    }).join('');

    const loadingRow = loading ? '<div class="pinokio-notify-loading">Loading sounds…</div>' : '';

    soundMenuContent.innerHTML = `
      <div class="pinokio-notify-section">
        <button type="button" class="pinokio-notify-item" data-menu-item="true" data-role="toggle" data-menu-key="${MENU_KEY_TOGGLE}" role="menuitemcheckbox" aria-checked="${tabEnabled ? 'true' : 'false'}">
          <span class="pinokio-notify-item-icon"><i class="fa-solid ${tabEnabled ? 'fa-bell' : 'fa-bell-slash'}"></i></span>
          <span class="pinokio-notify-item-label">Notifications ${tabEnabled ? 'on' : 'off'}</span>
          <span class="pinokio-notify-item-meta">This tab</span>
        </button>
      </div>
      <div class="pinokio-notify-divider" role="presentation"></div>
      <div class="pinokio-notify-section" role="group" aria-label="Notification sound">${soundItems}${loadingRow}</div>
      <p class="pinokio-notify-hint">Sound applies to all tabs</p>
    `;

    const items = getMenuItems();
    if (!items.length) {
      return;
    }

    let focusTarget = items.find((item) => item.getAttribute('data-menu-key') === previousActive);
    if (!focusTarget) {
      focusTarget = items[0];
    }
    items.forEach((item) => {
      item.setAttribute('tabindex', item === focusTarget ? '0' : '-1');
    });
    const shouldFocus = context.menuJustOpened
      || !soundMenuContent.contains(document.activeElement)
      || (focusTarget && document.activeElement !== focusTarget);
    if (shouldFocus && focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
    context.menuJustOpened = false;
    context.focusKey = focusTarget ? focusTarget.getAttribute('data-menu-key') : null;
    context.focusIndex = items.indexOf(focusTarget);
  };

  const applySoundSelection = (value) => {
    const choice = normaliseSoundChoice(value);
    const previous = globalSoundPreference.choice;
    globalSoundPreference.choice = choice;
    if (previous !== choice) {
      persistSoundPreference();
    }
    if (openMenuContext) {
      openMenuContext.focusKey = getMenuKeyForSoundValue(choice);
    }
    playSoundPreview(choice);
    if (openMenuContext) {
      renderSoundMenu(openMenuContext);
    }
  };

  const handleMenuClick = (event) => {
    if (!openMenuContext) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) {
      return;
    }
    const item = target.closest('[data-menu-item="true"]');
    if (!(item instanceof HTMLElement) || !soundMenuContent || !soundMenuContent.contains(item)) {
      return;
    }
    const role = item.getAttribute('data-role');
    if (role === 'toggle') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openMenuContext.onToggle === 'function') {
        openMenuContext.onToggle();
      }
      closeSoundMenu(true);
      return;
    }
    if (role === 'sound-option') {
      event.preventDefault();
      const value = item.getAttribute('data-sound-value');
      if (value) {
        applySoundSelection(value);
      }
    }
  };

  const focusMenuItemByIndex = (index) => {
    const items = getMenuItems();
    if (!items.length) {
      return;
    }
    let nextIndex = index;
    if (!Number.isInteger(nextIndex)) {
      nextIndex = 0;
    }
    if (nextIndex < 0) {
      nextIndex = 0;
    }
    if (nextIndex >= items.length) {
      nextIndex = items.length - 1;
    }
    const target = items[nextIndex];
    items.forEach((item, idx) => {
      item.setAttribute('tabindex', idx === nextIndex ? '0' : '-1');
    });
    openMenuContext.focusIndex = nextIndex;
    openMenuContext.focusKey = target ? target.getAttribute('data-menu-key') : null;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  };

  const focusMenuItemByDelta = (delta) => {
    const items = getMenuItems();
    if (!items.length) {
      return;
    }
    const current = document.activeElement && items.includes(document.activeElement)
      ? items.indexOf(document.activeElement)
      : (Number.isInteger(openMenuContext?.focusIndex) ? openMenuContext.focusIndex : 0);
    let nextIndex = current + delta;
    if (nextIndex < 0) {
      nextIndex = items.length - 1;
    } else if (nextIndex >= items.length) {
      nextIndex = 0;
    }
    focusMenuItemByIndex(nextIndex);
  };

  const focusMenuItemByKey = (key) => {
    const items = getMenuItems();
    if (!items.length) {
      return;
    }
    const target = items.find((item) => item.getAttribute('data-menu-key') === key);
    if (target) {
      focusMenuItemByIndex(items.indexOf(target));
    }
  };

  const handleMenuKeydown = (event) => {
    if (!openMenuContext) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItemByDelta(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItemByDelta(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusMenuItemByIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusMenuItemByIndex(getMenuItems().length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSoundMenu(true);
    }
  };

  const ensureSoundMenuNode = () => {
    if (soundMenuNode && soundMenuNode.parentNode) {
      return soundMenuNode;
    }
    soundMenuNode = document.createElement('div');
    soundMenuNode.className = 'pinokio-notify-popover';
    soundMenuNode.id = 'pinokio-notify-popover';
    soundMenuNode.setAttribute('aria-hidden', 'true');
    soundMenuNode.style.top = '-9999px';
    soundMenuNode.style.left = '-9999px';
    soundMenuContent = document.createElement('div');
    soundMenuContent.className = 'pinokio-notify-menu';
    soundMenuContent.setAttribute('role', 'menu');
    soundMenuContent.setAttribute('tabindex', '-1');
    soundMenuNode.appendChild(soundMenuContent);
    document.body.appendChild(soundMenuNode);
    soundMenuNode.addEventListener('click', handleMenuClick);
    soundMenuContent.addEventListener('keydown', handleMenuKeydown);
    return soundMenuNode;
  };

  const openSoundMenu = (toggle, frameName, state, onToggle) => {
    if (!toggle) {
      return;
    }
    if (openMenuContext && openMenuContext.toggle === toggle) {
      closeSoundMenu();
      return;
    }
    closeSoundMenu();
    const menu = ensureSoundMenuNode();
    openMenuContext = {
      toggle,
      frameName,
      state,
      onToggle,
      focusKey: MENU_KEY_TOGGLE,
      focusIndex: 0,
      menuJustOpened: true,
    };
    toggle.setAttribute('aria-expanded', 'true');
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.visibility = 'hidden';
    if (!dismissOverlay) {
      dismissOverlay = document.createElement('div');
      dismissOverlay.className = 'pinokio-notify-overlay';
      dismissOverlay.setAttribute('role', 'presentation');
      dismissOverlay.setAttribute('aria-hidden', 'true');
      dismissOverlay.addEventListener('click', () => {
        closeSoundMenu();
      });
      dismissOverlay.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
    }
    if (!dismissOverlay.parentNode) {
      document.body.appendChild(dismissOverlay);
    }
    if (dismissOverlay instanceof HTMLElement) {
      dismissOverlay.style.pointerEvents = 'auto';
    }
    renderSoundMenu(openMenuContext, {
      options: soundOptionsCache && soundOptionsCache.length ? soundOptionsCache : baseSoundOptions(),
      loading: !soundOptionsCache,
    });
    positionSoundMenu(menu, toggle);
    menu.style.visibility = '';
    updateMenuPosition();
    loadSoundOptions().then((options) => {
      if (!openMenuContext || openMenuContext.toggle !== toggle) {
        return;
      }
      renderSoundMenu(openMenuContext, { options, loading: false });
      updateMenuPosition();
    }).catch(() => {});
  };

  const handleDocumentPointerDown = (event) => {
    if (!openMenuContext) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (soundMenuNode && soundMenuNode.contains(target)) {
      return;
    }
    const toggle = openMenuContext.toggle;
    if (toggle && toggle.contains && toggle.contains(target)) {
      return;
    }
    closeSoundMenu();
  };

  const handleDocumentKeydown = (event) => {
    if (event.key === 'Escape' && openMenuContext) {
      event.preventDefault();
      closeSoundMenu(true);
    }
  };

  const handleViewportChange = () => {
    updateMenuPosition();
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
  hydrateSoundPreference();

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
        autoDetected: false,
        isLive: false,
        notified: false,
        lastInput: '',
        commandStartTimestamp: 0,
        lastLiveTimestamp: 0,
        lastActivityTimestamp: 0,
        notifyEnabled: getPreference(frameName),
      };
      tabStates.set(frameName, state);
      console.log('Created state for frame', frameName);
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
.${TOGGLE_CLASS}[aria-expanded="true"] {
  color: var(--pinokio-focus-color, #4c9afe);
}
.pinokio-notify-popover {
  position: absolute;
  z-index: 2147482000;
  min-width: 220px;
  max-width: 280px;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.97);
  border-radius: 10px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.45);
  padding: 8px;
  display: none;
}
.pinokio-notify-popover.is-open {
  display: block;
}
.pinokio-notify-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  outline: none;
}
.pinokio-notify-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pinokio-notify-divider {
  height: 1px;
  background: rgba(148, 163, 184, 0.15);
  margin: 4px 0;
}
.pinokio-notify-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.pinokio-notify-item:hover,
.pinokio-notify-item:focus-visible {
  background: rgba(148, 163, 184, 0.12);
}
.pinokio-notify-item[data-selected="true"] {
  background: rgba(148, 163, 184, 0.18);
}
.pinokio-notify-item .pinokio-notify-item-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.pinokio-notify-item .pinokio-notify-item-meta {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.75;
}
.pinokio-notify-hint {
  margin: 2px 2px 0;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.75);
}
.pinokio-notify-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(148, 163, 184, 0.9);
}
.pinokio-notify-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147481995;
  background: transparent;
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
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', (openMenuContext && openMenuContext.toggle === toggle) ? 'true' : 'false');
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
      toggle.setAttribute('aria-controls', 'pinokio-notify-popover');
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
        console.log('Notification preference changed', { frameName, enabled: next });
      };

      toggle._pinokioToggleActivate = activate;

      const handleToggleInteraction = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = getOrCreateState(frameName);
        if (!current) {
          return;
        }
        openSoundMenu(toggle, frameName, current, activate);
      };

      toggle.addEventListener('click', (event) => {
        handleToggleInteraction(event);
      });

      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleToggleInteraction(event);
        } else if (event.key === 'Escape' && openMenuContext && openMenuContext.toggle === toggle) {
          event.preventDefault();
          closeSoundMenu(true);
        }
      });
    }
    toggle.setAttribute('aria-controls', 'pinokio-notify-popover');
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
    if (openMenuContext && openMenuContext.toggle === toggle) {
      closeSoundMenu();
    }
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

  const playInlineSound = () => {
    const audioEl = window.__pinokioCustomNotificationAudio || window.__pinokioChimeAudio;
    if (!audioEl) {
      return;
    }
    try {
      audioEl.currentTime = 0;
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => console.log('inline audio blocked', err));
      }
    } catch (err) {
      console.log('inline audio play failed', err);
    }
  };

  const sendNotification = (link, state) => {
    if (!link || !state) {
      console.log('sendNotification skipped – link/state missing');
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
      sound: resolveNotificationSound(),
      // Target this notification to this browser/device only
      audience: 'device',
      device_id: (typeof window !== 'undefined' && typeof window.PinokioGetDeviceId === 'function') ? window.PinokioGetDeviceId() : undefined,
    };
    if (image) {
      payload.image = image;
    }

    const isInlineMode = () => Boolean(window.PinokioInlineIdle);
    if (isInlineMode()) {
      playInlineSound();
      return;
    }

    try {
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
      state.isLive = indicator.classList.contains(LIVE_CLASS);
      if (!state.hasRecentInput && !state.awaitingLive && !state.awaitingIdle && state.isLive && Number.isFinite(state.lastActivityTimestamp)) {
        state.commandStartTimestamp = state.commandStartTimestamp || state.lastActivityTimestamp || Date.now();
        state.awaitingIdle = true;
        state.autoDetected = true;
        state.notified = false;
      }
      return;
    }

    const wasLive = state.isLive;
    const isLive = indicator.classList.contains(LIVE_CLASS);
    state.isLive = isLive;
    updateActivityTimestamp(indicator, state);

    if (isLive) {
      state.lastLiveTimestamp = Date.now();
      if (!state.commandStartTimestamp) {
        state.commandStartTimestamp = state.lastActivityTimestamp || state.lastLiveTimestamp;
      }
      if (state.awaitingLive && state.hasRecentInput) {
        state.awaitingLive = false;
        state.awaitingIdle = true;
      } else if (!state.hasRecentInput && !state.awaitingLive && !state.awaitingIdle && !wasLive && Number.isFinite(state.lastActivityTimestamp)) {
        // Auto-run scenario: activity started without explicit terminal input.
        state.awaitingIdle = true;
        state.autoDetected = true;
        state.notified = false;
      }
      return;
    }

    const shouldProcessIdle = state.awaitingIdle && !state.notified && (state.hasRecentInput || state.autoDetected);

    if (shouldProcessIdle) {
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
        console.log('[idle notifier] skipping quick command', { frameName, runtimeMs });
      } else if (!state.notifyEnabled) {
        console.log('[idle notifier] notifications disabled for frame', frameName);
      } else if (shouldNotify(link)) {
        sendNotification(link, state);
        state.notified = true;
      }
    }

    state.hasRecentInput = false;
    state.awaitingIdle = false;
    state.awaitingLive = false;
    state.autoDetected = false;
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
    state.autoDetected = false;
    state.notified = false;
    state.lastInput = sanitisePreview(data.line || '');
    state.commandStartTimestamp = Date.now();
    state.lastActivityTimestamp = 0;
    state.lastLiveTimestamp = 0;

    const indicator = findIndicatorForFrame(frameName);
    if (indicator && indicator.classList.contains(LIVE_CLASS)) {
      state.awaitingLive = false;
      state.awaitingIdle = true;
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
    ensureIndicatorObservers();
    ensureTabAccessories();
    treeObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('message', handleMessageEvent, true);
    document.addEventListener('mousedown', handleDocumentPointerDown, true);
    document.addEventListener('touchstart', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('storage', (event) => {
      if (event.key === PREF_STORAGE_KEY) {
        notifyPreferences.clear();
        hydratePreferences();
        tabStates.forEach((state, frame) => {
          state.notifyEnabled = getPreference(frame);
        });
        ensureTabAccessories();
      } else if (event.key === SOUND_PREF_STORAGE_KEY) {
        hydrateSoundPreference();
        if (openMenuContext) {
          renderSoundMenu(openMenuContext);
        }
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
  window.PinokioIdleNotifier = {
    forceScan() {
      ensureIndicatorObservers();
      ensureTabAccessories();
    }
  };
})();
