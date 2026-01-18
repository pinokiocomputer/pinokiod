(function () {
  'use strict';

  const STORAGE_KEY = 'pinokio.xterm.preferences';
  const CUSTOM_FONT_VALUE = '__custom__';

  function detectOsPlatform() {
    try {
      if (typeof navigator !== 'undefined') {
        const ua = ((navigator.userAgent || '') + ' ' + (navigator.platform || '')).toLowerCase();
        if (ua.includes('windows')) return 'windows';
        if (ua.includes('mac') || ua.includes('darwin')) return 'mac';
        if (ua.includes('linux')) return 'linux';
      }
    } catch (_) {}
    return 'unknown';
  }

  const FONT_OPTIONS = (() => {
    const options = [
      { label: 'Default (Theme)', value: '' },
      { label: 'Monospace (generic)', value: 'monospace' },
      { label: 'UI Monospace', value: 'ui-monospace' }
    ];

    const platform = detectOsPlatform();
    if (platform === 'windows') {
      options.push(
        { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
        { label: 'Courier New', value: '"Courier New", Courier, monospace' },
        { label: 'Lucida Console', value: '"Lucida Console", "Lucida Sans Typewriter", monospace' }
      );
    } else if (platform === 'mac') {
      options.push(
        { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
        { label: 'Monaco', value: 'Monaco, "Courier New", monospace' }
      );
    }

    options.push({ label: 'Custom...', value: CUSTOM_FONT_VALUE });
    return options;
  })();

  const THEME_OPTIONS = [
    { key: 'foreground', label: 'Foreground' },
    { key: 'background', label: 'Background' },
    { key: 'cursor', label: 'Cursor' },
    { key: 'cursorAccent', label: 'Cursor Accent' },
    { key: 'selectionBackground', label: 'Selection Background' },
    { key: 'selectionForeground', label: 'Selection Text' },
    { key: 'selectionInactiveBackground', label: 'Selection (Inactive)' },
    { key: 'black', label: 'ANSI 0 Black' },
    { key: 'red', label: 'ANSI 1 Red' },
    { key: 'green', label: 'ANSI 2 Green' },
    { key: 'yellow', label: 'ANSI 3 Yellow' },
    { key: 'blue', label: 'ANSI 4 Blue' },
    { key: 'magenta', label: 'ANSI 5 Magenta' },
    { key: 'cyan', label: 'ANSI 6 Cyan' },
    { key: 'white', label: 'ANSI 7 White' },
    { key: 'brightBlack', label: 'ANSI 8 Bright Black' },
    { key: 'brightRed', label: 'ANSI 9 Bright Red' },
    { key: 'brightGreen', label: 'ANSI 10 Bright Green' },
    { key: 'brightYellow', label: 'ANSI 11 Bright Yellow' },
    { key: 'brightBlue', label: 'ANSI 12 Bright Blue' },
    { key: 'brightMagenta', label: 'ANSI 13 Bright Magenta' },
    { key: 'brightCyan', label: 'ANSI 14 Bright Cyan' },
    { key: 'brightWhite', label: 'ANSI 15 Bright White' }
  ];

  const THEME_KEYS = THEME_OPTIONS.map((option) => option.key);
  const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const THEME_KEY_ALIASES = {
    selection: 'selectionBackground'
  };
  const DIRECT_TYPING_PREF_KEY = 'pinokio.terminal.directTyping';

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  class TerminalMobileInput {
    constructor(settings) {
      this.settings = settings;
      this.runnerButtons = new WeakMap();
      this.termRecords = new Map();
      this.modal = null;
      this.backdrop = null;
      this.textarea = null;
      this.newlineCheckbox = null;
      this.statusElement = null;
      this.statusTimer = null;
      this.modalOpen = false;
      this.lastTrigger = null;
      this.tapTrackers = new WeakMap();
      this.supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
      this.escapeHandler = (event) => {
        if (!event || event.key !== 'Escape' || !this.modalOpen) {
          return;
        }
        event.preventDefault();
        this.closeModal();
      };
      const stored = this.loadDirectTypingPreference();
      if (stored === null) {
        this.directTypingEnabled = !this.shouldPreferModalInput();
      } else {
        this.directTypingEnabled = stored;
      }
    }

    shouldPreferModalInput() {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
          if (window.matchMedia('(pointer: coarse)').matches) {
            return true;
          }
        } catch (_) {}
        try {
          if (window.matchMedia('(max-width: 768px)').matches) {
            return true;
          }
        } catch (_) {}
      }
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent || '';
        if (/Mobi|Android|iPhone|iPad|Tablet/i.test(ua)) {
          return true;
        }
      }
      return false;
    }

    loadDirectTypingPreference() {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      try {
        const stored = window.localStorage.getItem(DIRECT_TYPING_PREF_KEY);
        if (stored === '1') {
          return true;
        }
        if (stored === '0') {
          return false;
        }
      } catch (_) {}
      return null;
    }

    saveDirectTypingPreference(value) {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      try {
        if (typeof value === 'boolean') {
          window.localStorage.setItem(DIRECT_TYPING_PREF_KEY, value ? '1' : '0');
        } else {
          window.localStorage.removeItem(DIRECT_TYPING_PREF_KEY);
        }
      } catch (_) {}
    }

    registerTerminal(term) {
      if (!term || this.termRecords.has(term)) {
        return;
      }
      const record = {
        term,
        textarea: null,
        renderDisposable: null
      };
      this.termRecords.set(term, record);
      if (!term._pinokioMobileInputPatchedOpen && typeof term.open === 'function') {
        const originalOpen = term.open;
        const mobileInput = this;
        term.open = function patchedOpen(...args) {
          const result = originalOpen.apply(this, args);
          try {
            mobileInput.configureTapListener(term);
          } catch (_) {}
          return result;
        };
        term._pinokioMobileInputPatchedOpen = true;
      }
      const capture = () => {
        if (!this.termRecords.has(term)) {
          return true;
        }
        const textarea = this.getTermTextarea(term);
        if (!textarea) {
          return false;
        }
        record.textarea = textarea;
        this.applyInputPolicy(textarea);
        return true;
      };
      if (!capture()) {
        if (typeof term.onRender === 'function') {
          record.renderDisposable = term.onRender(() => {
            if (capture() && record.renderDisposable && typeof record.renderDisposable.dispose === 'function') {
              record.renderDisposable.dispose();
              record.renderDisposable = null;
            }
          });
        }
        if (!record.renderDisposable) {
          let attempts = 0;
          const poll = () => {
            if (!this.termRecords.has(term) || record.textarea) {
              return;
            }
            attempts += 1;
            if (capture()) {
              return;
            }
            if (attempts < 60) {
              setTimeout(poll, 100);
            }
          };
          setTimeout(poll, 50);
        }
      }
      this.configureTapListener(term);
    }

    unregisterTerminal(term) {
      const record = this.termRecords.get(term);
      if (!record) {
        return;
      }
      if (record.renderDisposable && typeof record.renderDisposable.dispose === 'function') {
        record.renderDisposable.dispose();
      }
      this.termRecords.delete(term);
      this.removeTapListener(term);
    }

    getTermTextarea(term) {
      if (!term) {
        return null;
      }
      if (term.textarea && typeof term.textarea.focus === 'function') {
        return term.textarea;
      }
      if (term._core && term._core._textarea && typeof term._core._textarea.focus === 'function') {
        return term._core._textarea;
      }
      return null;
    }

    applyInputPolicy(textarea) {
      if (!textarea) {
        return;
      }
      if (this.directTypingEnabled) {
        textarea.removeAttribute('inputmode');
        textarea.removeAttribute('readonly');
        textarea.removeAttribute('aria-readonly');
      } else {
        textarea.setAttribute('inputmode', 'none');
        textarea.setAttribute('readonly', 'readonly');
        textarea.setAttribute('aria-readonly', 'true');
      }
    }

    applyPolicyToAll() {
      this.termRecords.forEach((record) => {
        if (record && record.textarea) {
          this.applyInputPolicy(record.textarea);
        }
        if (record && record.term) {
          this.configureTapListener(record.term);
        }
      });
    }

    setDirectTypingEnabled(enabled) {
      const next = Boolean(enabled);
      if (next === this.directTypingEnabled) {
        return;
      }
      this.directTypingEnabled = next;
      this.saveDirectTypingPreference(next);
      this.applyPolicyToAll();
    }

    attachKeyboardButton(runner, host) {
      if (!runner || this.runnerButtons.has(runner)) {
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn terminal-keyboard-button';
      button.innerHTML = '<i class="fa-solid fa-keyboard"></i> Input';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this.lastTrigger = button;
        this.openModal();
      });
      if (host && host.firstChild) {
        host.insertBefore(button, host.firstChild);
      } else if (host) {
        host.appendChild(button);
      } else {
        runner.appendChild(button);
      }
      this.runnerButtons.set(runner, { button });
    }

    ensureModalElements() {
      if (this.modal || typeof document === 'undefined' || !document.body) {
        return;
      }
      const backdrop = document.createElement('div');
      backdrop.className = 'terminal-keyboard-backdrop';
      backdrop.hidden = true;

      const modal = document.createElement('div');
      modal.className = 'terminal-keyboard-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'terminal-keyboard-title');
      modal.hidden = true;



      const form = document.createElement('form');
      form.className = 'terminal-keyboard-form';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submitInput();
      });

      const textarea = document.createElement('textarea');
      textarea.className = 'terminal-keyboard-textarea';
      textarea.placeholder = 'Enter command';
      textarea.rows = 4;
      textarea.autocapitalize = 'off';
      textarea.autocomplete = 'off';
      textarea.spellcheck = false;
      textarea.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          this.submitInput();
        }
      });

      const options = document.createElement('div');
      options.className = 'terminal-keyboard-options';

      const newlineOption = document.createElement('label');
      newlineOption.className = 'terminal-keyboard-option';
      const newlineCheckbox = document.createElement('input');
      newlineCheckbox.type = 'checkbox';
      newlineCheckbox.className = 'terminal-keyboard-checkbox';
      newlineCheckbox.checked = true;
      const newlineText = document.createElement('span');
      newlineText.textContent = 'Append newline on send';
      newlineOption.appendChild(newlineCheckbox);
      newlineOption.appendChild(newlineText);

      options.appendChild(newlineOption);

      const status = document.createElement('div');
      status.className = 'terminal-keyboard-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');

      const actions = document.createElement('div');
      actions.className = 'terminal-keyboard-actions';

      const actionsLeft = document.createElement('div');
      actionsLeft.className = 'terminal-keyboard-actions-left';

      const directTypingButton = document.createElement('button');
      directTypingButton.type = 'button';
      directTypingButton.className = 'btn terminal-keyboard-direct-button';
      directTypingButton.innerHTML = '<i class="fa-solid fa-keyboard"></i> Use Terminal';
      directTypingButton.addEventListener('click', () => this.enableDirectTypingFromModal());
      actionsLeft.appendChild(directTypingButton);

      const actionsRight = document.createElement('div');
      actionsRight.className = 'terminal-keyboard-actions-right';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn2';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', () => this.closeModal());

      const sendButton = document.createElement('button');
      sendButton.type = 'submit';
      sendButton.className = 'btn terminal-keyboard-send';
      sendButton.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send';

      actionsRight.appendChild(cancelButton);
      actionsRight.appendChild(sendButton);

      actions.appendChild(actionsLeft);
      actions.appendChild(actionsRight);

      form.appendChild(textarea);
      form.appendChild(options);
      form.appendChild(status);
      form.appendChild(actions);

      modal.appendChild(form);

      backdrop.addEventListener('click', () => this.closeModal());

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);

      this.modal = modal;
      this.backdrop = backdrop;
      this.textarea = textarea;
      this.newlineCheckbox = newlineCheckbox;
      this.statusElement = status;
    }

    openModal() {
      if (typeof document === 'undefined') {
        return;
      }
      if (!this.modal) {
        this.ensureModalElements();
      }
      if (!this.modal || !this.backdrop) {
        return;
      }
      this.setDirectTypingEnabled(false);
      if (this.modalOpen) {
        if (this.textarea) {
          this.textarea.focus();
        }
        return;
      }
      this.modal.hidden = false;
      this.backdrop.hidden = false;
      this.modalOpen = true;
      document.body.classList.add('terminal-keyboard-open');
      document.addEventListener('keydown', this.escapeHandler, true);
      this.setStatus('');
      if (this.textarea) {
        this.textarea.value = '';
        this.textarea.focus();
      }
    }

    closeModal(options) {
      const opts = options || {};
      if (!this.modalOpen) {
        return;
      }
      this.modalOpen = false;
      if (this.modal) {
        this.modal.hidden = true;
      }
      if (this.backdrop) {
        this.backdrop.hidden = true;
      }
      if (typeof document !== 'undefined') {
        document.body.classList.remove('terminal-keyboard-open');
        document.removeEventListener('keydown', this.escapeHandler, true);
      }
      if (this.textarea) {
        this.textarea.blur();
        this.textarea.value = '';
      }
      this.setStatus('');
      if (opts.focusTrigger !== false && this.lastTrigger && typeof document !== 'undefined' && document.body && document.body.contains(this.lastTrigger)) {
        try {
          this.lastTrigger.focus();
        } catch (_) {}
      }
      this.lastTrigger = null;
      this.configureTapListenerForAll();
    }

    setStatus(message, tone) {
      if (!this.statusElement) {
        return;
      }
      if (this.statusTimer) {
        clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      const text = typeof message === 'string' ? message : '';
      this.statusElement.textContent = text;
      if (tone) {
        this.statusElement.dataset.tone = tone;
      } else {
        delete this.statusElement.dataset.tone;
      }
      if (text) {
        this.statusElement.classList.add('visible');
        this.statusTimer = setTimeout(() => {
          if (this.statusElement) {
            this.statusElement.classList.remove('visible');
            this.statusElement.textContent = '';
            delete this.statusElement.dataset.tone;
          }
          this.statusTimer = null;
        }, tone === 'error' ? 5000 : 2000);
      } else {
        this.statusElement.classList.remove('visible');
      }
    }

    focusPrimaryTerminalInput() {
      const term = this.settings && typeof this.settings.getPrimaryTerminal === 'function'
        ? this.settings.getPrimaryTerminal()
        : null;
      if (!term) {
        return false;
      }
      const textarea = this.getTermTextarea(term);
      if (textarea) {
        try {
          textarea.focus();
          return true;
        } catch (_) {}
      }
      if (typeof term.focus === 'function') {
        try {
          term.focus();
          return true;
        } catch (_) {}
      }
      return false;
    }

    enableDirectTypingFromModal() {
      this.setDirectTypingEnabled(true);
      this.closeModal({ focusTrigger: false });
      this.focusPrimaryTerminalInput();
    }

    submitInput() {
      if (!this.textarea) {
        return;
      }
      const value = this.textarea.value || '';
      const appendNewline = this.newlineCheckbox ? this.newlineCheckbox.checked : true;
      if (!value && !appendNewline) {
        this.setStatus('Enter text or enable newline.', 'error');
        return;
      }
      const success = this.dispatchToTerminal(value, appendNewline);
      if (!success) {
        this.setStatus('Terminal is not ready yet.', 'error');
        return;
      }
      this.textarea.value = '';
      this.setStatus('Sent to terminal.', 'success');
      this.closeModal();
    }

    dispatchToTerminal(value, appendNewline) {
      const term = this.settings && typeof this.settings.getPrimaryTerminal === 'function'
        ? this.settings.getPrimaryTerminal()
        : null;
      if (!term) {
        return false;
      }
      let payload = typeof value === 'string' ? value : '';
      if (payload) {
        payload = payload.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
      }
      const wantsNewline = Boolean(appendNewline);
      if (wantsNewline) {
        payload = payload.replace(/\r+$/, '');
      }
      const hasText = Boolean(payload);
      if (!hasText && !wantsNewline) {
        return false;
      }
      if (hasText && !this.injectIntoTerminal(term, payload)) {
        return false;
      }
      if (wantsNewline) {
        setTimeout(() => this.injectIntoTerminal(term, '\r'), 100);
      }
      return true;
    }

    injectIntoTerminal(term, payload) {
      if (!term) {
        return false;
      }
      let dispatched = false;
      const coreService = term.coreService
        || (term._core && (term._core.coreService || term._core._coreService))
        || null;
      if (coreService && typeof coreService.triggerDataEvent === 'function') {
        coreService.triggerDataEvent(payload, true);
        dispatched = true;
      } else if (term._core && term._core._onData && typeof term._core._onData.fire === 'function') {
        term._core._onData.fire(payload);
        dispatched = true;
      } else if (term._onData && typeof term._onData.fire === 'function') {
        term._onData.fire(payload);
        dispatched = true;
      }
      if (!dispatched) {
        return false;
      }
      if (typeof term.focus === 'function') {
        term.focus();
      }
      return true;
    }

    configureTapListener(term) {
      if (!term) {
        return;
      }
      const node = term.element || term._core && term._core._terminalDiv || term._core && term._core.element || null;
      if (!node) {
        return;
      }
      if (this.directTypingEnabled) {
        this.removeTapListener(term);
        return;
      }
      if (this.tapTrackers.has(term)) {
        return;
      }
      const tracker = {
        lastTime: 0,
        lastX: 0,
        lastY: 0,
        handler: null,
        eventName: this.supportsPointer ? 'pointerdown' : 'touchstart'
      };
      const handlePointerDown = (event) => {
        if (!event) {
          return;
        }
        if (this.supportsPointer) {
          const pointerType = event.pointerType;
          if (pointerType && pointerType !== 'touch' && pointerType !== 'pen') {
            return;
          }
        } else if (event.touches && event.touches.length !== 1) {
          return;
        }
        const pointSource = this.supportsPointer ? event : (event.touches && event.touches[0]);
        const pointX = pointSource && typeof pointSource.clientX === 'number' ? pointSource.clientX : 0;
        const pointY = pointSource && typeof pointSource.clientY === 'number' ? pointSource.clientY : 0;
        const now = Date.now();
        const delta = now - tracker.lastTime;
        const distance = Math.hypot(pointX - tracker.lastX, pointY - tracker.lastY);
        if (delta < 320 && distance < 40) {
          event.preventDefault();
          event.stopPropagation();
          this.openModalFromGesture();
        }
        tracker.lastTime = now;
        tracker.lastX = pointX;
        tracker.lastY = pointY;
      };
      node.addEventListener(tracker.eventName, handlePointerDown, { passive: false });
      tracker.handler = handlePointerDown;
      tracker.node = node;
      this.tapTrackers.set(term, tracker);
    }

    configureTapListenerForAll() {
      this.termRecords.forEach((record) => {
        if (record && record.term) {
          this.configureTapListener(record.term);
        }
      });
    }

    removeTapListener(term) {
      if (!term) {
        return;
      }
      const tracker = this.tapTrackers.get(term);
      if (!tracker) {
        return;
      }
      if (tracker.node && tracker.handler) {
        const eventName = tracker.eventName || (this.supportsPointer ? 'pointerdown' : 'touchstart');
        tracker.node.removeEventListener(eventName, tracker.handler, { passive: false });
      }
      this.tapTrackers.delete(term);
    }

    openModalFromGesture() {
      this.lastTrigger = null;
      this.openModal();
    }
  }

  class TerminalSettings {
    constructor() {
      this.preferences = this.loadPreferences();
      this.terminals = new Set();
      this.menus = new Set();
      this.styleElement = null;
      this.mobileInput = typeof TerminalMobileInput === 'function'
        ? new TerminalMobileInput(this)
        : null;
      this.forceResizeButtons = new WeakMap();
      this.forceResizeHandler = null;
      this.currentFontFamily = typeof this.preferences.fontFamily === 'string' ? this.preferences.fontFamily.trim() : '';
      if (typeof document !== 'undefined') {
        const ready = document.readyState;
        const inspect = () => {
          if (this.currentFontFamily && !this.isMonospaceFamily(this.currentFontFamily)) {
            this.warnNonMonospace(this.currentFontFamily);
            delete this.preferences.fontFamily;
            this.currentFontFamily = '';
          }
          this.updateGlobalStylesFromPreferences();
        };
        if (ready === 'complete' || ready === 'interactive') {
          inspect();
        } else {
          document.addEventListener('DOMContentLoaded', inspect, { once: true });
        }
      }
    }

    loadPreferences() {
      if (typeof window === 'undefined' || !window.localStorage) {
        return {};
      }
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          return {};
        }
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object') {
          return {};
        }
        if ('fontSize' in parsed) {
          const numeric = parseInt(parsed.fontSize, 10);
          parsed.fontSize = Number.isNaN(numeric) ? undefined : numeric;
          if (!isFiniteNumber(parsed.fontSize)) {
            delete parsed.fontSize;
          }
        }
        if ('fontFamily' in parsed && typeof parsed.fontFamily !== 'string') {
          delete parsed.fontFamily;
        }
        if ('theme' in parsed) {
          parsed.theme = this.sanitizeTheme(parsed.theme);
          if (!parsed.theme || !Object.keys(parsed.theme).length) {
            delete parsed.theme;
          }
        }
        return parsed;
      } catch (_) {
        return {};
      }
    }

    savePreferences() {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
      } catch (_) {
        /* ignore */
      }
    }

    hasPreferences() {
      return Boolean(this.preferences.fontFamily)
        || isFiniteNumber(this.preferences.fontSize)
        || this.hasThemePreferences();
    }

    applyToConfig(config) {
      const updated = Object.assign({}, config || {});
      if (isFiniteNumber(this.preferences.fontSize)) {
        updated.fontSize = this.preferences.fontSize;
      }
      if (typeof this.preferences.fontFamily === 'string' && this.preferences.fontFamily.trim()) {
        updated.fontFamily = this.preferences.fontFamily;
      }
      if (this.hasThemePreferences()) {
        const themeBase = Object.assign({}, updated.theme || {});
        const themePrefs = this.getThemePreferences();
        updated.theme = Object.assign(themeBase, themePrefs);
      }
      return updated;
    }

    safeGetOption(term, option) {
      if (!term || typeof term.getOption !== 'function') {
        return undefined;
      }
      try {
        return term.getOption(option);
      } catch (_) {
        return undefined;
      }
    }

    register(term, meta) {
      if (!term || typeof term !== 'object') {
        return;
      }
      if (!term._pinokioBaseOptions) {
        const base = meta && meta.baseConfig ? meta.baseConfig : {};
        const baseFontSize = isFiniteNumber(base.fontSize)
          ? base.fontSize
          : this.safeGetOption(term, 'fontSize');
        const baseFamilyRaw = typeof base.fontFamily === 'string' && base.fontFamily.trim()
          ? base.fontFamily.trim()
          : this.safeGetOption(term, 'fontFamily');
        const defaultXtermFamily = 'courier-new, courier, monospace';
        const baseFontFamily = baseFamilyRaw && typeof baseFamilyRaw === 'string'
          && baseFamilyRaw.toLowerCase() === defaultXtermFamily
          ? 'monospace'
          : (baseFamilyRaw || 'monospace');
        const baseThemeRaw = base && base.theme ? base.theme : this.safeGetOption(term, 'theme');
        const baseTheme = this.sanitizeTheme(baseThemeRaw, true);
        term._pinokioBaseOptions = {
          fontSize: isFiniteNumber(baseFontSize) ? baseFontSize : 14,
          fontFamily: baseFontFamily,
          theme: baseTheme
        };
      }
      this.terminals.add(term);
      this.applyPreferences(term);
      if (this.mobileInput) {
        this.mobileInput.registerTerminal(term);
      }
      if (!term._pinokioPatchedDispose && typeof term.dispose === 'function') {
        const dispose = term.dispose.bind(term);
        term.dispose = (...args) => {
          this.terminals.delete(term);
          if (this.mobileInput) {
            this.mobileInput.unregisterTerminal(term);
          }
          return dispose(...args);
        };
        term._pinokioPatchedDispose = true;
      }
      this.initRunnerMenus();
      this.syncMenus();
    }

    getPrimaryTerminal() {
      const iterator = this.terminals.values();
      const first = iterator.next();
      return first && !first.done ? first.value : null;
    }

    getResolvedOption(option) {
      if (option === 'fontSize' && isFiniteNumber(this.preferences.fontSize)) {
        return this.preferences.fontSize;
      }
      if (option === 'fontFamily' && typeof this.preferences.fontFamily === 'string' && this.preferences.fontFamily.trim()) {
        return this.preferences.fontFamily;
      }
      const term = this.getPrimaryTerminal();
      if (!term) {
        return undefined;
      }
      const current = this.safeGetOption(term, option);
      if (current !== undefined && current !== null && String(current).trim() !== '') {
        return current;
      }
      const base = term._pinokioBaseOptions || {};
      return base[option];
    }

    applyPreferences(term) {
      if (!term) {
        return;
      }
      const base = term._pinokioBaseOptions || {};
      const sizePref = this.preferences.fontSize;
      const familyPref = typeof this.preferences.fontFamily === 'string' ? this.preferences.fontFamily.trim() : '';

      const resolvedSize = isFiniteNumber(sizePref)
        ? sizePref
        : (isFiniteNumber(base.fontSize) ? base.fontSize : undefined);
      const resolvedFamily = familyPref || base.fontFamily || 'monospace';
      const resolvedTheme = this.resolveTheme(base.theme);

      let needsRefresh = false;
      if (resolvedSize !== undefined) {
        this.applyNumericOption(term, 'fontSize', resolvedSize);
        needsRefresh = true;
      }
      if (resolvedFamily) {
        this.applyStringOption(term, 'fontFamily', resolvedFamily);
        needsRefresh = true;
      }
      const themeApplied = resolvedTheme ? this.applyThemeOption(term, resolvedTheme) : false;
      if (themeApplied) {
        needsRefresh = true;
      }

      if (needsRefresh) {
        this.refreshTerm(term, {
          fontSize: resolvedSize,
          fontFamily: resolvedFamily
        });
      }
    }

    applyNumericOption(term, key, value) {
      if (typeof term.setOption === 'function') {
        try {
          term.setOption(key, value);
        } catch (_) {}
      }
      if (term.element && term.element.style) {
        const cssValue = `${value}px`;
        if (key === 'fontSize') {
          term.element.style.setProperty('--font-size', cssValue);
          term.element.style.fontSize = cssValue;
        } else {
          term.element.style.setProperty(`--${key}`, cssValue);
          term.element.style[key] = cssValue;
        }
      }
    }

    applyStringOption(term, key, value) {
      if (typeof term.setOption === 'function') {
        try {
          term.setOption(key, value);
        } catch (_) {}
      }
      if (term.element && term.element.style) {
        term.element.style.setProperty(`--${key}`, value);
        if (key === 'fontFamily') {
          term.element.style.fontFamily = value;
        }
      }
    }

    applyAll() {
      this.updateGlobalStylesFromPreferences();
      this.terminals.forEach((term) => this.applyPreferences(term));
    }

    updateFontFamily(value) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed) {
        this.preferences.fontFamily = trimmed;
        this.currentFontFamily = trimmed;
      } else {
        delete this.preferences.fontFamily;
        this.currentFontFamily = '';
      }
      this.savePreferences();
      this.applyAll();
      this.syncMenus();
    }

    updateFontSize(value) {
      if (value === null || value === undefined || value === '') {
        delete this.preferences.fontSize;
      } else {
        const numeric = parseInt(value, 10);
        if (Number.isNaN(numeric)) {
          return;
        }
        const clamped = Math.min(Math.max(numeric, 8), 72);
        this.preferences.fontSize = clamped;
      }
      this.savePreferences();
      this.applyAll();
      this.syncMenus();
    }

    resetPreferences() {
      delete this.preferences.fontFamily;
      delete this.preferences.fontSize;
      delete this.preferences.theme;
      this.currentFontFamily = '';
      this.savePreferences();
      this.applyAll();
      this.syncMenus();
    }

    refreshTerm(term, overrides) {
      if (!term || typeof term.refresh !== 'function') {
        return;
      }
      try {
        const rows = typeof term.rows === 'number' && term.rows > 0 ? term.rows - 1 : 0;
        term.refresh(0, rows);
        const core = term._core || term._coreService || term.core;
        if (core && core._renderService && typeof core._renderService.onResize === 'function') {
          core._renderService.onResize(term.cols, term.rows);
        }
        if (core && core._charSizeService && typeof core._charSizeService.measure === 'function') {
          core._charSizeService.measure();
        }
        if (core && core._renderService && typeof core._renderService.clear === 'function') {
          core._renderService.clear();
        }
        if (core && core._viewport && typeof core._viewport._refresh === 'function') {
          core._viewport._refresh();
        }
        if (core && core._viewport && typeof core._viewport._syncScrollArea === 'function') {
          core._viewport._syncScrollArea();
        }
      } catch (_) {
        /* ignore */
      }
    }

    ensureStyleElement() {
      if (typeof document === 'undefined') {
        return null;
      }
      if (this.styleElement && this.styleElement.isConnected) {
        return this.styleElement;
      }
      const style = document.createElement('style');
      style.id = 'pinokio-terminal-overrides';
      document.head.appendChild(style);
      this.styleElement = style;
      return style;
    }

    removeStyleElement() {
      if (this.styleElement && this.styleElement.parentNode) {
        this.styleElement.parentNode.removeChild(this.styleElement);
      }
      this.styleElement = null;
    }

    updateGlobalStylesFromPreferences() {
      if (typeof document === 'undefined') {
        return;
      }
      const family = typeof this.preferences.fontFamily === 'string' ? this.preferences.fontFamily.trim() : '';
      const size = isFiniteNumber(this.preferences.fontSize) ? this.preferences.fontSize : null;
      if (!family && !size) {
        this.removeStyleElement();
        return;
      }
      const style = this.ensureStyleElement();
      if (!style) {
        return;
      }
      const selectors = [
        '.xterm',
        '.xterm .xterm-rows',
        '.xterm .xterm-rows span',
        '.xterm .xterm-text-layer',
        '.xterm .xterm-text-layer canvas',
        '.xterm .xterm-cursor-layer',
        '.xterm .xterm-char-measure-element'
      ];
      const declarations = [];
      if (family) {
        declarations.push(`font-family: ${family} !important`);
      }
      if (size) {
        declarations.push(`font-size: ${size}px !important`);
      }
      const nextCss = `${selectors.join(', ')} { ${declarations.join('; ')}; }`;
      if (style.textContent !== nextCss) {
        style.textContent = nextCss;
      }
    }

    sanitizeTheme(raw, allowUnknown) {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const sanitized = {};
      const keys = allowUnknown ? Object.keys(raw) : THEME_KEYS;
      keys.forEach((originalKey) => {
        let key = originalKey;
        if (!THEME_KEYS.includes(key) && THEME_KEY_ALIASES[key]) {
          key = THEME_KEY_ALIASES[key];
        }
        if (!allowUnknown && !THEME_KEYS.includes(key)) {
          return;
        }
        const value = raw[originalKey];
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) {
            sanitized[key] = trimmed;
          }
        }
      });
      return Object.keys(sanitized).length ? sanitized : null;
    }

    getThemePreferences() {
      if (!this.preferences.theme || typeof this.preferences.theme !== 'object') {
        return {};
      }
      return this.sanitizeTheme(this.preferences.theme) || {};
    }

    hasThemePreferences() {
      return Object.keys(this.getThemePreferences()).length > 0;
    }

    resolveTheme(baseTheme) {
      const baseSanitized = this.sanitizeTheme(baseTheme, true) || {};
      const prefs = this.getThemePreferences();
      if (!Object.keys(baseSanitized).length && !Object.keys(prefs).length) {
        return null;
      }
      return Object.assign({}, baseSanitized, prefs);
    }

    getResolvedTheme() {
      const term = this.getPrimaryTerminal();
      let baseTheme = null;
      if (term && term._pinokioBaseOptions && term._pinokioBaseOptions.theme) {
        baseTheme = term._pinokioBaseOptions.theme;
      } else if (term) {
        baseTheme = this.safeGetOption(term, 'theme');
      }
      return this.resolveTheme(baseTheme) || {};
    }

    colorToPicker(value) {
      if (typeof value !== 'string') {
        return '';
      }
      const trimmed = value.trim();
      if (!HEX_COLOR_REGEX.test(trimmed)) {
        return '';
      }
      if (trimmed.length === 4) {
        const r = trimmed[1];
        const g = trimmed[2];
        const b = trimmed[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
      }
      return trimmed.slice(0, 7).toLowerCase();
    }

    isValidThemeColor(value) {
      if (typeof value !== 'string') {
        return false;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return false;
      }
      if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.supports === 'function') {
        try {
          if (window.CSS.supports('color', trimmed)) {
            return true;
          }
        } catch (_) {}
      }
      return HEX_COLOR_REGEX.test(trimmed);
    }

    applyThemeOption(term, theme) {
      if (!term) {
        return;
      }
      const nextTheme = Object.assign({}, theme);
      let applied = false;
      if (typeof term.setOption === 'function') {
        try {
          term.setOption('theme', nextTheme);
          applied = true;
        } catch (_) {}
      } else if (term.options) {
        term.options.theme = nextTheme;
        applied = true;
      }

      const element = term.element;
      if (element && element.style) {
        if (nextTheme.background) {
          element.style.backgroundColor = nextTheme.background;
        } else {
          element.style.backgroundColor = '';
        }
        if (nextTheme.foreground) {
          element.style.color = nextTheme.foreground;
        } else {
          element.style.color = '';
        }
        const viewport = element.querySelector('.xterm-viewport');
        if (viewport && viewport.style && nextTheme.background) {
          viewport.style.backgroundColor = nextTheme.background;
        } else if (viewport && viewport.style) {
          viewport.style.backgroundColor = '';
        }
        const rows = element.querySelector('.xterm-rows');
        if (rows && rows.style && nextTheme.foreground) {
          rows.style.color = nextTheme.foreground;
        } else if (rows && rows.style) {
          rows.style.color = '';
        }
      }

      return applied;
    }

    updateThemeValue(key, value) {
      if (!THEME_KEYS.includes(key)) {
        return;
      }
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed && !this.isValidThemeColor(trimmed)) {
        this.syncMenus();
        return;
      }
      if (!trimmed) {
        if (this.preferences.theme && typeof this.preferences.theme === 'object') {
          delete this.preferences.theme[key];
          if (!Object.keys(this.preferences.theme).length) {
            delete this.preferences.theme;
          }
        }
      } else {
        if (!this.preferences.theme || typeof this.preferences.theme !== 'object') {
          this.preferences.theme = {};
        }
        this.preferences.theme[key] = trimmed;
      }
      this.savePreferences();
      this.applyAll();
      this.syncMenus();
    }

    isMonospaceFamily() {
      return true;
    }

    warnNonMonospace() {}

    ensureRunnerUtilities(runner) {
      if (typeof document === 'undefined' || !runner) {
        return null;
      }
      let container = runner.querySelector('.terminal-runner-utilities');
      if (container) {
        return container;
      }
      container = document.createElement('div');
      container.className = 'terminal-runner-utilities';
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', 'Terminal controls');
      runner.appendChild(container);
      return container;
    }

    setForceResizeHandler(handler) {
      if (typeof handler === 'function') {
        this.forceResizeHandler = handler;
      } else {
        this.forceResizeHandler = null;
      }
    }

    requestForceResize(context) {
      if (typeof this.forceResizeHandler === 'function') {
        try {
          this.forceResizeHandler(context || null);
          return true;
        } catch (error) {
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('Pinokio: force resize handler failed', error);
          }
        }
      }
      return false;
    }

    attachForceResizeButton(runner, host) {
      if (typeof document === 'undefined' || !runner || !host || this.forceResizeButtons.has(runner)) {
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn terminal-resize-button';
      button.innerHTML = '<i class="fa-solid fa-expand"></i> Resize';
      button.title = 'Resize to this window';
      button.addEventListener('click', (event) => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        const handled = this.requestForceResize({ runner });
        if (!handled && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            if (typeof window.CustomEvent === 'function') {
              window.dispatchEvent(new window.CustomEvent('pinokio-terminal-force-resize', {
                detail: { runner }
              }));
            } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
              const legacyEvent = document.createEvent('CustomEvent');
              legacyEvent.initCustomEvent('pinokio-terminal-force-resize', true, true, { runner });
              window.dispatchEvent(legacyEvent);
            }
          } catch (_) {}
        }
      });
      const configBlock = host.querySelector('.terminal-config');
      if (configBlock && configBlock.parentNode === host) {
        host.insertBefore(button, configBlock);
      } else {
        host.appendChild(button);
      }
      this.forceResizeButtons.set(runner, { button });
    }

    initRunnerMenus() {
      if (typeof document === 'undefined') {
        return;
      }
      const terminalContainer = document.querySelector('#terminal, #terminal2, [data-terminal-root]');
      if (!terminalContainer) {
        return;
      }
      const runners = document.querySelectorAll('.runner');
      if (!runners.length) {
        return;
      }
      runners.forEach((runner) => {
        if (runner.dataset.terminalConfigAttached === 'true') {
          return;
        }
        runner.dataset.terminalConfigAttached = 'true';
        const utilities = this.ensureRunnerUtilities(runner);
        const menu = this.createMenu(runner);
        if (utilities && menu && menu.wrapper) {
          utilities.appendChild(menu.wrapper);
        }
        if (menu) {
          this.menus.add(menu);
        }
        if (this.mobileInput) {
          this.mobileInput.attachKeyboardButton(runner, utilities);
        }
        this.attachForceResizeButton(runner, utilities);
      });
    }

    createMenu(runner) {
      if (!runner) {
        return null;
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'terminal-config';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn terminal-config-button';
      button.innerHTML = '<span class="terminal-config-label"><i class="fa-solid fa-sliders"></i> Config</span>';
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');

      const menu = document.createElement('div');
      menu.className = 'terminal-config-menu';
      menu.hidden = true;
      menu.style.display = 'none';
      menu.setAttribute('aria-hidden', 'true');

      const title = document.createElement('div');
      title.className = 'terminal-config-title';
      title.textContent = 'Terminal appearance';

      const note = document.createElement('div');
      note.className = 'terminal-config-note';

      const fontGroup = document.createElement('div');
      fontGroup.className = 'terminal-config-group';

      const fontLabel = document.createElement('label');
      fontLabel.className = 'terminal-config-label';
      fontLabel.textContent = 'Font family';

      const fontSelect = document.createElement('select');
      fontSelect.className = 'terminal-config-select';
      FONT_OPTIONS.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        fontSelect.appendChild(opt);
      });

      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.placeholder = 'Enter custom font stack';
      customInput.className = 'terminal-config-input terminal-config-input-custom';
      customInput.hidden = true;

      fontGroup.appendChild(fontLabel);
      fontGroup.appendChild(fontSelect);
      fontGroup.appendChild(customInput);

      const sizeGroup = document.createElement('div');
      sizeGroup.className = 'terminal-config-group';

      const sizeLabel = document.createElement('label');
      sizeLabel.className = 'terminal-config-label';
      sizeLabel.textContent = 'Font size';

      const sizeInput = document.createElement('input');
      sizeInput.type = 'number';
      sizeInput.min = '8';
      sizeInput.max = '72';
      sizeInput.step = '1';
      sizeInput.className = 'terminal-config-input';

      sizeGroup.appendChild(sizeLabel);
      sizeGroup.appendChild(sizeInput);

      const themeSection = document.createElement('div');
      themeSection.className = 'terminal-config-section terminal-config-theme';

      const themeTitle = document.createElement('div');
      themeTitle.className = 'terminal-config-subtitle';
      themeTitle.textContent = 'Theme colors';

      const themeHelp = document.createElement('div');
      themeHelp.className = 'terminal-config-help';
      themeHelp.textContent = 'Override background, foreground, cursor, selection, and ANSI palette colors.';

      const themeGrid = document.createElement('div');
      themeGrid.className = 'terminal-config-theme-grid';

      const themeInputs = new Map();
      THEME_OPTIONS.forEach((option) => {
        const row = document.createElement('div');
        row.className = 'terminal-config-theme-row';

        const label = document.createElement('label');
        label.className = 'terminal-config-label terminal-config-theme-label';
        label.textContent = option.label;

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'terminal-config-color-input';
        colorInput.value = '#000000';
        colorInput.dataset.themeKey = option.key;

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'terminal-config-input terminal-config-theme-text';
        textInput.placeholder = '#000000';
        textInput.dataset.themeKey = option.key;

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'btn2 terminal-config-theme-clear';
        clearButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        clearButton.title = 'Remove override';

        row.appendChild(label);
        row.appendChild(colorInput);
        row.appendChild(textInput);
        row.appendChild(clearButton);
        themeGrid.appendChild(row);

        themeInputs.set(option.key, {
          row,
          label,
          colorInput,
          textInput,
          clearButton
        });
      });

      themeSection.appendChild(themeTitle);
      themeSection.appendChild(themeHelp);
      themeSection.appendChild(themeGrid);

      const actions = document.createElement('div');
      actions.className = 'terminal-config-actions';

      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'btn2 terminal-config-reset';
      resetButton.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';

      actions.appendChild(resetButton);

      menu.appendChild(title);
      menu.appendChild(note);
      menu.appendChild(fontGroup);
      menu.appendChild(sizeGroup);
      menu.appendChild(themeSection);
      menu.appendChild(actions);

      wrapper.appendChild(button);
      wrapper.appendChild(menu);
      runner.appendChild(wrapper);

      const menuRecord = {
        runner,
        wrapper,
        button,
        menu,
        fontSelect,
        customInput,
        sizeInput,
        resetButton,
        note,
        themeSection,
        themeInputs,
        placeholder: null,
        isPortal: false,
        close: null
      };

      this.attachMenuHandlers(menuRecord);
      this.syncMenu(menuRecord);
      return menuRecord;
    }

    attachMenuHandlers(menuRecord) {
      const { button, menu, wrapper, fontSelect, customInput, sizeInput, resetButton, themeInputs } = menuRecord;
      if (!button || !menu) {
        return;
      }
      const settings = this;
      let outsideClickHandler = null;
      let escapeHandler = null;
      let scrollHandler = null;
      let resizeHandler = null;

      const viewportPadding = 12;
      const verticalGap = 8;
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

      const positionMenu = () => {
        if (menu.hidden) {
          return;
        }
        const rect = button.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const maxLeft = window.innerWidth - width - viewportPadding;
        const maxTop = window.innerHeight - height - viewportPadding;
        const idealLeft = rect.right - width;
        const idealTop = rect.bottom + verticalGap;
        const left = clamp(idealLeft, viewportPadding, Math.max(viewportPadding, maxLeft));
        const top = clamp(idealTop, viewportPadding, Math.max(viewportPadding, maxTop));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.zIndex = '1000000';
      };

      const closeMenu = () => {
        if (menu.hidden) {
          return;
        }
        menu.hidden = true;
        menu.style.display = 'none';
        menu.style.position = 'absolute';
        menu.style.left = '';
        menu.style.top = '';
        menu.style.right = '';
        menu.style.bottom = '';
        menu.style.zIndex = '';
        menu.setAttribute('aria-hidden', 'true');
        wrapper.classList.remove('terminal-config-open');
        button.setAttribute('aria-expanded', 'false');
        if (outsideClickHandler) {
          document.removeEventListener('mousedown', outsideClickHandler, true);
          outsideClickHandler = null;
        }
        if (escapeHandler) {
          document.removeEventListener('keydown', escapeHandler, true);
          escapeHandler = null;
        }
        if (scrollHandler) {
          window.removeEventListener('scroll', scrollHandler, true);
          scrollHandler = null;
        }
        if (resizeHandler) {
          window.removeEventListener('resize', resizeHandler, true);
          resizeHandler = null;
        }
        if (menuRecord.isPortal) {
          if (menuRecord.placeholder && menuRecord.placeholder.parentNode) {
            menuRecord.placeholder.parentNode.replaceChild(menu, menuRecord.placeholder);
          } else {
            wrapper.appendChild(menu);
          }
        }
        menuRecord.placeholder = null;
        menuRecord.isPortal = false;
      };

      const openMenu = () => {
        if (!menu.hidden) {
          return;
        }
        if (!menuRecord.placeholder) {
          menuRecord.placeholder = document.createComment('terminal-config-menu');
        }
        if (!menuRecord.isPortal) {
          wrapper.insertBefore(menuRecord.placeholder, menu);
          document.body.appendChild(menu);
          menuRecord.isPortal = true;
        }
        menu.hidden = false;
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        menu.style.right = 'auto';
        menu.style.bottom = 'auto';
        menu.removeAttribute('aria-hidden');
        wrapper.classList.add('terminal-config-open');
        button.setAttribute('aria-expanded', 'true');
        positionMenu();
        outsideClickHandler = function (event) {
          if (!menu.contains(event.target) && !button.contains(event.target)) {
            closeMenu();
          }
        };
        escapeHandler = function (event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu();
          }
        };
        document.addEventListener('mousedown', outsideClickHandler, true);
        document.addEventListener('keydown', escapeHandler, true);
        scrollHandler = () => positionMenu();
        resizeHandler = () => positionMenu();
        window.addEventListener('scroll', scrollHandler, true);
        window.addEventListener('resize', resizeHandler, true);
      };

      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (menu.hidden) {
          openMenu();
        } else {
          closeMenu();
        }
      });

      fontSelect.addEventListener('change', () => {
        if (fontSelect.value === CUSTOM_FONT_VALUE) {
          customInput.hidden = false;
          customInput.focus();
          if (customInput.value.trim()) {
            settings.updateFontFamily(customInput.value);
          } else {
            settings.updateFontFamily(null);
          }
        } else {
          customInput.hidden = true;
          settings.updateFontFamily(fontSelect.value);
        }
        positionMenu();
      });

      const handleCustomInput = () => {
        const value = customInput.value.trim();
        if (!value) {
          return;
        }
        settings.updateFontFamily(value);
        positionMenu();
      };

      customInput.addEventListener('change', handleCustomInput);
      customInput.addEventListener('blur', handleCustomInput);
      customInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleCustomInput();
          closeMenu();
        }
      });

      const handleSizeChange = () => {
        const raw = sizeInput.value.trim();
        if (!raw) {
          settings.updateFontSize(null);
          positionMenu();
          return;
        }
        settings.updateFontSize(raw);
        positionMenu();
      };

      sizeInput.addEventListener('change', handleSizeChange);
      sizeInput.addEventListener('blur', handleSizeChange);

      if (themeInputs && themeInputs.size) {
        const applyThemeValue = (key, value) => {
          settings.updateThemeValue(key, value);
          positionMenu();
        };
        themeInputs.forEach((controls, key) => {
          const { colorInput, textInput, clearButton } = controls;
          if (colorInput) {
            const handleColor = () => {
              const value = colorInput.value ? colorInput.value.trim() : '';
              if (textInput) {
                textInput.value = value;
              }
              applyThemeValue(key, value);
            };
            colorInput.addEventListener('input', handleColor);
            colorInput.addEventListener('change', handleColor);
          }
          if (textInput) {
            const handleTextInput = () => {
              const value = textInput.value.trim();
              if (!value) {
                applyThemeValue(key, null);
              } else if (settings.isValidThemeColor(value)) {
                applyThemeValue(key, value);
              }
            };
            const commitText = () => {
              applyThemeValue(key, textInput.value.trim());
            };
            textInput.addEventListener('input', handleTextInput);
            textInput.addEventListener('change', commitText);
            textInput.addEventListener('blur', commitText);
            textInput.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitText();
              }
            });
          }
          if (clearButton) {
            clearButton.addEventListener('click', (event) => {
              event.preventDefault();
              if (colorInput) {
                colorInput.value = '#000000';
              }
              if (textInput) {
                textInput.value = '';
              }
              applyThemeValue(key, null);
            });
          }
        });
      }

      resetButton.addEventListener('click', (event) => {
        event.preventDefault();
        settings.resetPreferences();
        closeMenu();
      });

      menuRecord.close = closeMenu;
      menuRecord.positionMenu = positionMenu;
    }

    syncMenus() {
      this.menus.forEach((menu) => this.syncMenu(menu));
    }

    syncMenu(menuRecord) {
      if (!menuRecord) {
        return;
      }
      const { fontSelect, customInput, sizeInput, note, resetButton, themeInputs } = menuRecord;
      const prefFamily = typeof this.preferences.fontFamily === 'string' ? this.preferences.fontFamily.trim() : '';
      const prefSize = this.preferences.fontSize;
      const resolvedFamily = this.getResolvedOption('fontFamily');
      const resolvedSize = this.getResolvedOption('fontSize');

      const knownOption = FONT_OPTIONS.find((option) => option.value === prefFamily);
      if (prefFamily && !knownOption) {
        this.updateFontFamily(null);
        return;
      }

      fontSelect.value = prefFamily && knownOption ? prefFamily : '';
      customInput.hidden = fontSelect.value !== CUSTOM_FONT_VALUE;
      if (customInput.hidden) {
        customInput.value = '';
      }

      if (prefFamily || (fontSelect.value && fontSelect.value !== CUSTOM_FONT_VALUE)) {
        customInput.placeholder = prefFamily || resolvedFamily || 'Enter custom font stack';
      } else {
        customInput.placeholder = resolvedFamily || 'Enter custom font stack';
      }

      if (isFiniteNumber(prefSize)) {
        sizeInput.value = String(prefSize);
      } else {
        sizeInput.value = '';
      }
      sizeInput.placeholder = resolvedSize ? String(resolvedSize) : '';

      const themePrefs = this.getThemePreferences();
      const resolvedTheme = this.getResolvedTheme() || {};
      const themeOverrideCount = Object.keys(themePrefs).length;

      if (themeInputs && themeInputs.size) {
        themeInputs.forEach((controls, key) => {
          const prefValue = themePrefs[key] || '';
          const effectiveValue = resolvedTheme[key] || '';
          if (controls.textInput) {
            controls.textInput.value = prefValue;
            controls.textInput.placeholder = prefValue ? '' : effectiveValue;
            controls.textInput.title = prefValue ? `Override: ${prefValue}` : (effectiveValue ? `Inherited: ${effectiveValue}` : 'No color override');
          }
          if (controls.colorInput) {
            const pickerValue = prefValue
              ? this.colorToPicker(prefValue)
              : this.colorToPicker(effectiveValue);
            if (pickerValue) {
              controls.colorInput.value = pickerValue;
              delete controls.colorInput.dataset.invalid;
            } else {
              controls.colorInput.value = '#000000';
              controls.colorInput.dataset.invalid = 'true';
            }
            controls.colorInput.title = prefValue
              ? `Override: ${prefValue}`
              : (effectiveValue ? `Inherited: ${effectiveValue}` : 'No color override');
          }
          if (controls.clearButton) {
            controls.clearButton.disabled = !prefValue;
            controls.clearButton.title = prefValue ? 'Remove override' : 'No override to remove';
          }
        });
      }

      if (note) {
        const familyText = resolvedFamily ? resolvedFamily : 'Default';
        const sizeText = resolvedSize ? `${resolvedSize}px` : 'Auto';
        const themeText = themeOverrideCount
          ? `Theme overrides: ${themeOverrideCount}`
          : 'Theme: Default';
        note.textContent = `Current font: ${familyText} | ${sizeText} | ${themeText}`;
      }

      if (resetButton) {
        resetButton.disabled = !this.hasPreferences();
      }
    }
  }

  const settings = new TerminalSettings();
  window.PinokioTerminalSettings = settings;
  if (typeof window !== 'undefined') {
    window.PinokioTerminalKeyboard = settings && settings.mobileInput ? settings.mobileInput : null;
  }

  if (typeof document !== 'undefined') {
    const readyState = document.readyState;
    if (readyState === 'complete' || readyState === 'interactive') {
      settings.initRunnerMenus();
    } else {
      document.addEventListener('DOMContentLoaded', () => settings.initRunnerMenus(), { once: true });
    }
  }
})();
