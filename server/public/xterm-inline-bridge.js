(() => {
  if (typeof window === 'undefined' || window.PinokioInlineBridgeInitialized) {
    return;
  }
  const isStandaloneMobile = () => {
    try {
      if (window.top !== window.self) {
        return false;
      }
    } catch (_) {
      return false;
    }
    const ua = (navigator.userAgent || '').toLowerCase();
    return /iphone|ipad|ipod|android|mobile/.test(ua);
  };
  if (!isStandaloneMobile()) {
    return;
  }
  window.PinokioInlineBridgeInitialized = true;

  const ensureFrameName = () => {
    if (typeof window.name === 'string' && window.name.trim()) {
      return window.name;
    }
    const generated = `inline-${Date.now()}`;
    window.name = generated;
    return generated;
  };

  const createFrameLink = (frameName) => {
    const existing = document.querySelector('.frame-link.pinokio-inline');
    if (existing) {
      return existing;
    }
    const link = document.createElement('div');
    link.className = 'frame-link pinokio-inline';
    link.setAttribute('target', frameName);
    link.dataset.canNotify = 'true';
    link.style.display = 'none';
    link.innerHTML = `
      <div class="tab">
        <div class="tab-main">
          <div class="tab-details">
            <div class="tab-updated">
              <span class="indicator">
                <span class="dot"></span>
                <span class="label"></span>
              </span>
            </div>
            <div class="tab-preview"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(link);
    return link;
  };

  const init = () => {
    const frameName = ensureFrameName();
    const link = createFrameLink(frameName);
    if (!link) {
      return;
    }
    window.PinokioInlineIdle = true;
    const indicator = link.querySelector('.tab-updated');
    const label = indicator ? indicator.querySelector('.label') : null;
    const preview = link.querySelector('.tab-preview');
    const updateIndicator = (text, hasContent) => {
      if (preview) {
        preview.textContent = hasContent ? text : '';
      }
      const now = Date.now();
      indicator.dataset.timestamp = String(now);
      indicator.classList.add('is-live');
      if (label) {
        label.textContent = 'live';
      }
      clearTimeout(updateIndicator._timer);
      updateIndicator._timer = setTimeout(() => {
        indicator.classList.remove('is-live');
        indicator.dataset.timestamp = String(Date.now());
        if (label) {
          label.textContent = 'idle';
        }
      }, 1200);
    };

    const handleMessage = (event) => {
      if (!event || typeof event.data !== 'object' || event.data === null) {
        return;
      }
      const data = event.data;
      if (data.type === 'terminal-input') {
        const hasContent = typeof data.hasContent === 'boolean'
          ? data.hasContent
          : Boolean(data.line && data.line.length > 0);
        updateIndicator(data.line || '', hasContent);
      } else if (data.type === 'stream') {
        updateIndicator('', true);
      }
    };

    window.addEventListener('message', handleMessage, true);
    const script = document.createElement('script');
    script.src = '/tab-idle-notifier.js';
    script.async = false;
    document.head.appendChild(script);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
