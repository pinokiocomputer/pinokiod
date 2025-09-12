const WINDOW_ID = (() => {
  // Try to get existing window ID or create a new one
  let id = sessionStorage.getItem('__window_id');
  if (!id) {
    id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    try { sessionStorage.setItem('__window_id', id); } catch (_) {}
  }
  return id;
})();

// Window-specific storage wrapper
window.windowStorage = {
  setItem: (key, value) => {
    try { 
      sessionStorage.setItem(`${WINDOW_ID}:${key}`, value); 
    } catch (_) {}
  },
  removeItem: (key, value) => {
    try { 
      sessionStorage.removeItem(`${WINDOW_ID}:${key}`)
    } catch (_) {}
  },
  getItem: (key) => {
    try { 
      return sessionStorage.getItem(`${WINDOW_ID}:${key}`); 
    } catch (_) { 
      return null; 
    }
  }
};
