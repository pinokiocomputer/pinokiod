(() => {
  const SESSION_NAMESPACE = (() => {
    const extractSession = (loc) => {
      try {
        const url = new URL(loc);
        const value = url.searchParams.get('session');
        return typeof value === 'string' && value.length > 0 ? value : null;
      } catch (_) {
        return null;
      }
    };

    let sessionId = extractSession(window.location.href);

    if (!sessionId && window.parent && window.parent !== window) {
      try {
        sessionId = extractSession(window.parent.location.href);
      } catch (_) {
        try {
          if (typeof window.parent.PinokioLayout?.getSessionId === 'function') {
            sessionId = window.parent.PinokioLayout.getSessionId() || null;
          }
        } catch (_) {}
      }
    }

    if (!sessionId && window.top && window.top !== window) {
      try {
        sessionId = extractSession(window.top.location.href);
      } catch (_) {}
    }

    if (sessionId) {
      return `pinokio:session:${sessionId}`;
    }

    let fallbackId = null;
    try {
      fallbackId = localStorage.getItem('pinokio:window:fallback');
      if (!fallbackId) {
        fallbackId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('pinokio:window:fallback', fallbackId);
      }
    } catch (_) {
      fallbackId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    return `pinokio:window:${fallbackId}`;
  })();

  const prefixKey = (key) => {
    if (!key || typeof key !== 'string') {
      return null;
    }
    return `${SESSION_NAMESPACE}:${key}`;
  };

  window.windowStorage = {
    setItem: (key, value) => {
      const namespaced = prefixKey(key);
      if (!namespaced) {
        return;
      }
      try {
        localStorage.setItem(namespaced, value);
      } catch (_) {}
    },
    removeItem: (key) => {
      const namespaced = prefixKey(key);
      if (!namespaced) {
        return;
      }
      try {
        localStorage.removeItem(namespaced);
      } catch (_) {}
    },
    getItem: (key) => {
      const namespaced = prefixKey(key);
      if (!namespaced) {
        return null;
      }
      try {
        return localStorage.getItem(namespaced);
      } catch (_) {
        return null;
      }
    },
    clearNamespace: () => {
      try {
        const targetPrefix = `${SESSION_NAMESPACE}:`;
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i);
          if (key && key.startsWith(targetPrefix)) {
            localStorage.removeItem(key);
          }
        }
      } catch (_) {}
    },
  };
})();
