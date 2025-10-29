(function () {
  'use strict';

  const STORAGE_KEY = 'pinokio.xterm.preferences';
  const CUSTOM_FONT_VALUE = '__custom__';
  const FONT_OPTIONS = [
    { label: 'Default (Theme)', value: '' },
    { label: 'Monospace (generic)', value: 'monospace' },
    { label: 'UI Monospace', value: 'ui-monospace' },
    { label: 'Courier New', value: '"Courier New", Courier, monospace' },
    { label: 'Lucida Console', value: '"Lucida Console", "Lucida Sans Typewriter", monospace' },
    { label: 'Consolas', value: 'Consolas, "Liberation Mono", "Courier New", monospace' },
    { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
    { label: 'Monaco', value: 'Monaco, "Courier New", monospace' },
    { label: 'IBM Plex Mono', value: '"IBM Plex Mono", "Courier New", monospace' },
    { label: 'Source Code Pro', value: '"Source Code Pro", "Courier New", monospace' },
    { label: 'Fira Code', value: '"Fira Code", "Courier New", monospace' },
    { label: 'JetBrains Mono', value: '"JetBrains Mono", "Courier New", monospace' },
    { label: 'Cascadia Mono', value: '"Cascadia Mono", "Courier New", monospace' },
    { label: 'Iosevka', value: 'Iosevka, "Courier New", monospace' },
    { label: 'Anonymous Pro', value: '"Anonymous Pro", "Courier New", monospace' },
    { label: 'Roboto Mono', value: '"Roboto Mono", "Courier New", monospace' },
    { label: 'Inconsolata', value: 'Inconsolata, "Courier New", monospace' },
    { label: 'Hack', value: 'Hack, "Courier New", monospace' },
    { label: 'Noto Sans Mono', value: '"Noto Sans Mono", "Courier New", monospace' },
    { label: 'PT Mono', value: '"PT Mono", "Courier New", monospace' },
    { label: 'Space Mono', value: '"Space Mono", "Courier New", monospace' },
    { label: 'Custom...', value: CUSTOM_FONT_VALUE }
  ];

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  class TerminalSettings {
    constructor() {
      this.preferences = this.loadPreferences();
      this.terminals = new Set();
      this.menus = new Set();
      this.styleElement = null;
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
      return Boolean(this.preferences.fontFamily) || isFiniteNumber(this.preferences.fontSize);
    }

    applyToConfig(config) {
      const updated = Object.assign({}, config || {});
      if (isFiniteNumber(this.preferences.fontSize)) {
        updated.fontSize = this.preferences.fontSize;
      }
      if (typeof this.preferences.fontFamily === 'string' && this.preferences.fontFamily.trim()) {
        updated.fontFamily = this.preferences.fontFamily;
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
        const baseFontFamily = baseFamilyRaw || 'monospace';
        term._pinokioBaseOptions = {
          fontSize: isFiniteNumber(baseFontSize) ? baseFontSize : 12,
          fontFamily: baseFontFamily
        };
      }
      this.terminals.add(term);
      this.applyPreferences(term);
      if (!term._pinokioPatchedDispose && typeof term.dispose === 'function') {
        const dispose = term.dispose.bind(term);
        term.dispose = (...args) => {
          this.terminals.delete(term);
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

      if (resolvedSize !== undefined) {
        this.applyNumericOption(term, 'fontSize', resolvedSize);
      }
      if (resolvedFamily) {
        this.applyStringOption(term, 'fontFamily', resolvedFamily);
      }

      this.refreshTerm(term, {
        fontSize: resolvedSize,
        fontFamily: resolvedFamily
      });
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
      const rules = [];
      if (family) {
        rules.push(`${selectors.join(', ')} { font-family: ${family} !important; }`);
      }
      if (size) {
        rules.push(`${selectors.join(', ')} { font-size: ${size}px !important; }`);
      }
      style.textContent = rules.join('\n');
    }

    isMonospaceFamily() {
      return true;
    }

    warnNonMonospace() {}

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
        const menu = this.createMenu(runner);
        if (menu) {
          this.menus.add(menu);
        }
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
      button.innerHTML = '<i class="fa-solid fa-sliders"></i> Configure';
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
        placeholder: null,
        isPortal: false,
        close: null
      };

      this.attachMenuHandlers(menuRecord);
      this.syncMenu(menuRecord);
      return menuRecord;
    }

    attachMenuHandlers(menuRecord) {
      const { button, menu, wrapper, fontSelect, customInput, sizeInput, resetButton } = menuRecord;
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
      const { fontSelect, customInput, sizeInput, note, resetButton } = menuRecord;
      const prefFamily = typeof this.preferences.fontFamily === 'string' ? this.preferences.fontFamily.trim() : '';
      const prefSize = this.preferences.fontSize;
      const resolvedFamily = this.getResolvedOption('fontFamily');
      const resolvedSize = this.getResolvedOption('fontSize');

      const knownOption = FONT_OPTIONS.find((option) => option.value === prefFamily);
      if (prefFamily && !knownOption) {
        fontSelect.value = CUSTOM_FONT_VALUE;
        customInput.hidden = false;
        customInput.value = prefFamily;
      } else {
        fontSelect.value = prefFamily && knownOption ? prefFamily : '';
        customInput.hidden = fontSelect.value !== CUSTOM_FONT_VALUE;
        if (customInput.hidden) {
          customInput.value = '';
        }
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

      if (note) {
        const familyText = resolvedFamily ? resolvedFamily : 'Default';
        const sizeText = resolvedSize ? `${resolvedSize}px` : 'Auto';
        note.textContent = `Current font: ${familyText} | ${sizeText}`;
      }

      if (resetButton) {
        resetButton.disabled = !this.hasPreferences();
      }
    }
  }

  const settings = new TerminalSettings();
  window.PinokioTerminalSettings = settings;

  if (typeof document !== 'undefined') {
    const readyState = document.readyState;
    if (readyState === 'complete' || readyState === 'interactive') {
      settings.initRunnerMenus();
    } else {
      document.addEventListener('DOMContentLoaded', () => settings.initRunnerMenus(), { once: true });
    }
  }
})();
