/**
 * URL Dropdown functionality for process selection
 * Fetches running processes from /info/procs API and displays them in a dropdown
 */

function initUrlDropdown(config = {}) {
  if (window.PinokioUrlDropdown && typeof window.PinokioUrlDropdown.destroy === 'function') {
    try {
      window.PinokioUrlDropdown.destroy();
    } catch (error) {
      console.error('Failed to dispose existing URL dropdown', error);
    }
  }

  let urlInput = document.querySelector('.urlbar input[type="url"]');
  let dropdown = document.getElementById('url-dropdown');
  const mobileButton = document.getElementById('mobile-link-button');
  const mobileButtonHandler = () => showMobileModal();

  const fallbackElements = {
    form: null,
    dropdown: null
  };

  const ensureFallbackInput = () => {
    if (fallbackElements.form) {
      const existingInput = fallbackElements.form.querySelector('input[type="url"]');
      if (existingInput) return existingInput;
    }
    if (!document.body) return null;
    const form = document.createElement('form');
    form.className = 'urlbar pinokio-url-fallback';
    form.id = 'pinokio-url-fallback-form';
    form.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'url';
    form.appendChild(input);
    document.body.appendChild(form);
    fallbackElements.form = form;
    return input;
  };

  const ensureFallbackDropdown = () => {
    if (fallbackElements.dropdown) return fallbackElements.dropdown;
    if (!document.body) return null;
    const el = document.createElement('div');
    el.id = 'url-dropdown';
    el.className = 'url-dropdown';
    el.style.display = 'none';
    document.body.appendChild(el);
    fallbackElements.dropdown = el;
    return el;
  };

  if (!urlInput) {
    urlInput = ensureFallbackInput();
  }

  if (!dropdown) {
    dropdown = ensureFallbackDropdown();
  }

  if (!urlInput || !dropdown) {
    console.warn('URL dropdown elements not found; process picker modal will be limited.');
  }

  // Configuration options
  const options = {
    clearBehavior: config.clearBehavior || 'empty', // 'empty' or 'restore'
    defaultValue: config.defaultValue || '',
    apiEndpoint: config.apiEndpoint || '/info/procs',
    ...config
  };

  let isDropdownVisible = false;
  let allProcesses = []; // Store all processes for filtering
  let filteredProcesses = []; // Store currently filtered processes
  let createLauncherModal = null;
  let pendingCreateDetail = null;
  let mobileModalKeydownHandler = null;
  const EMPTY_STATE_DESCRIPTION = 'enter a prompt to create a launcher';

  // Initialize input field state based on clear behavior
  initializeInputValue();
  
  // Handle page navigation events
  window.addEventListener('pageshow', function(event) {
    if (event.persisted || window.performance?.navigation?.type === 2) {
      initializeInputValue();
    }
  });

  // Event listeners
  if (urlInput) {
    urlInput.addEventListener('focus', function() {
      // Auto-select text for restore behavior to make filtering easier
      if (options.clearBehavior === 'restore' && urlInput.value) {
        // Use setTimeout to ensure the focus event completes first
        setTimeout(() => {
          urlInput.select();
        }, 0);
      }
      showDropdown();
    });
    urlInput.addEventListener('input', handleInputChange);
  }
  
  // Hide dropdown when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.url-input-container')) {
      hideDropdown();
    }
  });

  if (document.querySelector(".urlbar")) {
    document.querySelector(".urlbar").addEventListener("submit", (e) => {
      e.preventDefault()
      e.stopPropagation()
      let el = e.target.querySelector("input[type=url]")
      let val = el.value
      let type = el.getAttribute("data-host-type")
      if (type === "local") {
        let redirect_uri = "/container?url=" + val
        location.href = redirect_uri
      } else {
        let u = new URL(val)
        if (String(u.port) === "42000") {
          // pinokio app => open the url itself
          window.open(val, "_blank", 'self')
        } else {
          // other servers => open in pinokio redirect frame
          let redirect_uri = "/container?url=" + val
          location.href = redirect_uri
        }
      }
    })
  }


  function initializeInputValue() {
    if (!urlInput) return;
    if (options.clearBehavior === 'empty') {
      urlInput.value = '';
    } else if (options.clearBehavior === 'restore') {
      const originalValue = urlInput.getAttribute('value') || options.defaultValue;
      if (urlInput.value !== originalValue) {
        urlInput.value = originalValue;
      }
    }
  }

  function showDropdown() {
    if (!dropdown || !urlInput) return;
    if (isDropdownVisible && allProcesses.length > 0) {
      // If dropdown is already visible and we have data, show all initially
      showAllProcesses();
      return;
    }
    
    isDropdownVisible = true;
    dropdown.style.display = 'block';
    
    // If we already have processes data, show all initially
    if (allProcesses.length > 0) {
      showAllProcesses();
      return;
    }
    
    // Otherwise, show loading and fetch data
    dropdown.innerHTML = '<div class="url-dropdown-loading">Loading running processes...</div>';
    
    // Fetch processes from API
    fetch(options.apiEndpoint)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        allProcesses = data.info || [];
        showAllProcesses(); // Show all processes when dropdown first opens
      })
      .catch(error => {
        console.error('Failed to fetch processes:', error);
        dropdown.innerHTML = '<div class="url-dropdown-empty">Failed to load processes</div>';
        allProcesses = [];
      });
  }

  function showAllProcesses() {
    filteredProcesses = allProcesses;
    populateDropdown(filteredProcesses);
  }

  function handleInputChange() {
    if (!urlInput) return;
    if (!isDropdownVisible) return;
    
    const query = urlInput.value.toLowerCase().trim();
    
    // Special case: if text is selected (user just focused), don't filter yet
    if (urlInput.selectionStart === 0 && urlInput.selectionEnd === urlInput.value.length) {
      // Text is fully selected, show all processes until user starts typing
      filteredProcesses = allProcesses;
    } else if (!query) {
      // No query, show all processes
      filteredProcesses = allProcesses;
    } else {
      // Filter processes based on name and URL
      filteredProcesses = allProcesses.filter(process => {
        const url = `http://${process.ip}`;
        const name = process.name.toLowerCase();
        const urlLower = url.toLowerCase();
        
        return name.includes(query) || urlLower.includes(query);
      });
    }
    
    populateDropdown(filteredProcesses);
  }

  function hideDropdown() {
    isDropdownVisible = false;
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  }

  function createHostBadge(host) {
    if (!host || !host.platform) return '';
    
    // Get platform icon
    let platformIcon = '';
    switch (host.platform) {
      case 'darwin':
        platformIcon = 'fa-brands fa-apple';
        break;
      case 'win32':
        platformIcon = 'fa-brands fa-windows';
        break;
      case 'linux':
        platformIcon = 'fa-brands fa-linux';
        break;
      default:
        platformIcon = 'fa-solid fa-desktop';
        break;
    }
    
    // Create badge HTML
    return `
      <span class="host-badge">
        <i class="${platformIcon}"></i>
        <span class="host-name">${escapeHtml(host.name)}</span>
      </span>
    `;
  }

  function groupProcessesByHost(processes) {
    const grouped = {};
    
    processes.forEach(process => {
      // Create a normalized host key based only on name for grouping
      const hostKey = process.host ? process.host.name : 'Unknown';
      
      if (!grouped[hostKey]) {
        grouped[hostKey] = {
          host: process.host || { name: 'Unknown', platform: 'unknown', arch: 'unknown' },
          processes: [],
          isLocal: false
        };
      }
      
      // Mark as local if any process from this host is local
      if (process.host.local === true) {
        grouped[hostKey].isLocal = true;
      }
      
      grouped[hostKey].processes.push(process);
    });
    
    // Sort host keys: local host first, then alphabetically
    return Object.keys(grouped)
      .sort((a, b) => {
        const aIsLocal = grouped[a].isLocal;
        const bIsLocal = grouped[b].isLocal;
        
        // Local host always comes first
        if (aIsLocal && !bIsLocal) return 1;
        if (!aIsLocal && bIsLocal) return -1;
        
        // Both local or both remote - sort alphabetically
        return a.localeCompare(b);
      })
      .reduce((sortedGrouped, hostKey) => {
        sortedGrouped[hostKey] = grouped[hostKey];
        return sortedGrouped;
      }, {});
  }

  function createHostHeader(host, isLocal = false) {
    if (!host) return '';
    
    // Get platform icon
    let platformIcon = '';
    switch (host.platform) {
      case 'darwin':
        platformIcon = 'fa-brands fa-apple';
        break;
      case 'win32':
        platformIcon = 'fa-brands fa-windows';
        break;
      case 'linux':
        platformIcon = 'fa-brands fa-linux';
        break;
      default:
        platformIcon = 'fa-solid fa-desktop';
        break;
    }
    const hostName = isLocal ? `${host.name} (This Machine)` : `${host.name} (Peer)`;
    
    return `
      <div class="url-dropdown-host-header">
        <span class='host-meta'>
          <i class="${platformIcon}"></i>
          <span class="host-arch">${escapeHtml(host.arch)}</span>
        </span>
        <span class="host-name">${escapeHtml(hostName)}</span>
      </div>
    `;
  }

  function populateDropdown(processes) {
    const currentUrl = window.location.href;
    const currentTitle = document.title || 'Current tab';

    let html = '';
    if (currentUrl) {
      html += `
        <div class="url-dropdown-host-header current-tab">
          <span class="host-name">Current tab</span>
        </div>
        <div class="url-dropdown-item" data-url="${escapeHtml(currentUrl)}" data-host-type="current">
          <div class="url-dropdown-name">
            <span>
              <i class="fa-solid fa-clone"></i>
              ${escapeHtml(currentTitle)}
            </span>
          </div>
          <div class="url-dropdown-url">${escapeHtml(currentUrl)}</div>
        </div>
      `;
    }

    if (processes.length === 0) {
      html += createEmptyStateHtml(getEmptyStateMessage(urlInput));
      dropdown.innerHTML = html;
      attachCreateButtonHandler(dropdown, urlInput);
      dropdown.querySelectorAll('.url-dropdown-item:not(.non-selectable)').forEach(item => {
        item.addEventListener('click', function() {
          const url = this.getAttribute('data-url');
          const type = this.getAttribute('data-host-type');
          urlInput.value = url;
          urlInput.setAttribute("data-host-type", type || 'current');
          hideDropdown();

          if (type === "local") {
            let redirect_uri = "/container?url=" + url;
            location.href = redirect_uri;
          } else {
            if (!type || type === 'current') {
              location.href = url;
              return;
            }
            let u = new URL(url);
            if (String(u.port) === "42000") {
              window.open(url, "_blank", 'self');
            } else {
              let redirect_uri = "/container?url=" + url;
              location.href = redirect_uri;
            }
          }
        });
      });
      return;
    }

    // Group processes by host
    const groupedProcesses = groupProcessesByHost(processes);

    Object.keys(groupedProcesses).forEach(hostKey => {
      const hostData = groupedProcesses[hostKey];
      const hostInfo = hostData.host;
      const processes = hostData.processes;
      const isLocal = hostData.isLocal;
      
      // Add host header
      html += createHostHeader(hostInfo, isLocal);
      
      // Add processes for this host
      processes.forEach(process => {
        const onlineIndicator = process.online ? 
          '<div class="status-circle online"></div>' : 
          '<div class="status-circle offline"></div>';
        
        if (process.ip === null || process.ip === undefined) {
          // Non-selectable item with "turn on peer network" button
          const networkUrl = `http://${process.host.ip}:42000/network`;
          html += `
            <div class="url-dropdown-item non-selectable">
              <div class="url-dropdown-name">
                ${onlineIndicator}
                <button class="peer-network-button" data-network-url="${networkUrl}"><i class="fa-solid fa-toggle-on"></i> Turn on peer network</button>
                ${escapeHtml(process.name)}
              </div>
            </div>
          `;
        } else {
          // Normal selectable item
          const url = `http://${process.ip}`;
          html += `
            <div class="url-dropdown-item" data-url="${url}" data-host-type="${process.host.local ? "local" : "remote"}">
              <div class="url-dropdown-name">
                ${onlineIndicator}
                ${escapeHtml(process.name)}
              </div>
              <div class="url-dropdown-url">${escapeHtml(url)}</div>
            </div>
          `;
        }
      });
    });

    dropdown.innerHTML = html;

    // Add click handlers to dropdown items
    dropdown.querySelectorAll('.url-dropdown-item:not(.non-selectable)').forEach(item => {
      item.addEventListener('click', function() {
        const url = this.getAttribute('data-url');
        const type = this.getAttribute('data-host-type');
        urlInput.value = url;
        urlInput.setAttribute("data-host-type", type || 'remote');
        hideDropdown();
        
        // Navigate directly instead of dispatching submit event
        if (type === "local") {
          let redirect_uri = "/container?url=" + url;
          location.href = redirect_uri;
        } else if (type === 'current') {
          location.href = url;
        } else {
          let u = new URL(url);
          if (String(u.port) === "42000") {
            window.open(url, "_blank", 'self');
          } else {
            let redirect_uri = "/container?url=" + url;
            location.href = redirect_uri;
          }
        }
      });
    });

    // Add click handlers to peer network buttons
    dropdown.querySelectorAll('.peer-network-button').forEach(button => {
      button.addEventListener('click', function(e) {
        e.stopPropagation();
        const networkUrl = this.getAttribute('data-network-url');
        window.open(networkUrl, '_blank', 'self');
      });
    });
  }

  // Utility function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getModalOverlay() {
    return document.getElementById('url-modal-overlay');
  }

  function getModalRefs() {
    const overlay = getModalOverlay();
    return overlay ? overlay._modalRefs : null;
  }

  function resolveModal(refs, value) {
    if (!refs || typeof refs.resolve !== 'function') {
      return;
    }
    const resolver = refs.resolve;
    refs.resolve = null;
    refs.returnSelection = false;
    try {
      resolver(value);
    } catch (err) {
      console.error('Failed to resolve URL modal selection', err);
    }
  }

  function buildPaneUrl(url, type) {
    if (!url || typeof url !== 'string') return url;

    const ensureContainer = () => {
      if (url.startsWith('/container?url=')) return url;
      return `/container?url=${encodeURIComponent(url)}`;
    };

    switch (type) {
      case 'current':
        return url;
      case 'local':
        return ensureContainer();
      case 'remote':
        try {
          const parsed = new URL(url);
          if (String(parsed.port) === '42000') {
            return url;
          }
        } catch (_) {
          // If URL constructor fails, fall back to container redirect
        }
        return ensureContainer();
      default:
        return ensureContainer();
    }
  }

  function handleModalSelection(url, type) {
    const refs = getModalRefs();
    if (!refs) return;

    const paneUrl = buildPaneUrl(url, type);

    if (refs.input) {
      refs.input.value = paneUrl;
      if (typeof refs.updateConfirmState === 'function') {
        refs.updateConfirmState();
      }
    }

    if (!refs.returnSelection && urlInput) {
      urlInput.value = paneUrl;
      urlInput.setAttribute('data-host-type', type || 'remote');
    }

    if (refs.returnSelection) {
      resolveModal(refs, paneUrl);
      closeMobileModal({ suppressResolve: true });
      return;
    }

    closeMobileModal();

    if (!type || type === 'current') {
      location.href = paneUrl;
      return;
    }

    if (type === 'local' || type === 'remote') {
      if (paneUrl.startsWith('/container?url=')) {
        location.href = paneUrl;
        return;
      }
      try {
        const parsed = new URL(paneUrl);
        if (String(parsed.port) === '42000') {
          window.open(paneUrl, '_blank', 'self');
        } else {
          location.href = `/container?url=${encodeURIComponent(paneUrl)}`;
        }
      } catch (error) {
        console.error('Failed to open URL, redirecting directly', error);
        location.href = paneUrl;
      }
      return;
    }

    location.href = paneUrl;
  }

  // Mobile modal functionality
  function createMobileModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay url-modal-overlay';
    overlay.id = 'url-modal-overlay';

    const content = document.createElement('div');
    content.className = 'url-modal-content';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'url-modal-close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.innerHTML = '&times;';

    const heading = document.createElement('h3');
    heading.textContent = 'Open a URL';
    heading.id = 'url-modal-title';

    const description = document.createElement('p');
    description.className = 'url-modal-description';
    description.id = 'url-modal-description';
    description.textContent = 'Enter a local URL or choose from running processes.';

    content.setAttribute('aria-labelledby', heading.id);
    content.setAttribute('aria-describedby', description.id);

    const modalInput = document.createElement('input');
    modalInput.type = 'url';
    modalInput.className = 'url-modal-input';
    modalInput.placeholder = 'Example: http://localhost:7860';

    const modalDropdown = document.createElement('div');
    modalDropdown.className = 'url-dropdown';
    modalDropdown.id = 'url-modal-dropdown';

    const actions = document.createElement('div');
    actions.className = 'url-modal-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'url-modal-button cancel';
    cancelButton.textContent = 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'url-modal-button confirm';
    confirmButton.textContent = 'Open';
    confirmButton.disabled = true;

    actions.append(cancelButton, confirmButton);

    content.append(closeButton, heading, description, modalInput, modalDropdown, actions);
    overlay.append(content);

    const updateConfirmState = () => {
      confirmButton.disabled = !modalInput.value.trim();
    };

    modalInput.addEventListener('focus', () => {
      if (options.clearBehavior === 'restore' && modalInput.value) {
        setTimeout(() => modalInput.select(), 0);
      }
      updateConfirmState();
      showModalDropdown(modalDropdown);
    });

    modalInput.addEventListener('input', () => {
      handleModalInputChange(modalInput, modalDropdown);
      updateConfirmState();
    });

    modalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitMobileModal();
      }
    });

    cancelButton.addEventListener('click', closeMobileModal);
    confirmButton.addEventListener('click', submitMobileModal);
    closeButton.addEventListener('click', closeMobileModal);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeMobileModal();
      }
    });

    overlay._modalRefs = {
      input: modalInput,
      dropdown: modalDropdown,
      confirmButton,
      cancelButton,
      closeButton,
      heading,
      description,
      updateConfirmState,
      defaults: {
        title: heading.textContent,
        description: description.textContent,
        confirmLabel: confirmButton.textContent
      },
      context: 'default',
      returnSelection: false,
      includeCurrent: true,
      resolve: null
    };

    return overlay;
  }

  function showMobileModal(customOptions = {}) {
    let overlay = document.getElementById('url-modal-overlay');
    if (!overlay) {
      overlay = createMobileModal();
      document.body.appendChild(overlay);
    }

    const refs = overlay._modalRefs || {};
    const modalInput = refs.input;
    const updateConfirmState = refs.updateConfirmState;
    if (!modalInput || !updateConfirmState) return undefined;

    const defaults = refs.defaults || {};
    const title = customOptions.title || defaults.title || 'Open a URL';
    const descriptionText = customOptions.description || defaults.description || 'Enter a local URL or choose from running processes.';
    const confirmLabel = customOptions.confirmLabel || defaults.confirmLabel || 'Open';
    const includeCurrent = customOptions.includeCurrent !== false;
    const initialValue = customOptions.initialValue !== undefined
      ? customOptions.initialValue
      : (options.clearBehavior === 'restore'
          ? ((urlInput && urlInput.value) || options.defaultValue || '')
          : '');

    refs.heading.textContent = title;
    refs.description.textContent = descriptionText;
    refs.confirmButton.textContent = confirmLabel;
    refs.includeCurrent = includeCurrent;
    refs.context = customOptions.context || 'default';
    refs.returnSelection = Boolean(customOptions.awaitSelection);
    refs.resolve = null;

    modalInput.value = initialValue;
    updateConfirmState();

    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      requestAnimationFrame(() => modalInput.focus());
    });

    if (!mobileModalKeydownHandler) {
      mobileModalKeydownHandler = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMobileModal();
        }
      };
    }

    document.addEventListener('keydown', mobileModalKeydownHandler, true);

    if (refs.returnSelection) {
      return new Promise((resolve) => {
        refs.resolve = resolve;
      });
    }

    return undefined;
  }

  function closeMobileModal(options = {}) {
    const overlay = getModalOverlay();
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    const refs = overlay._modalRefs;

    if (refs?.dropdown) {
      refs.dropdown.style.display = 'none';
    }
    if (refs?.confirmButton) {
      refs.confirmButton.disabled = true;
    }

    if (refs) {
      if (options.resolveValue !== undefined) {
        resolveModal(refs, options.resolveValue);
      } else if (refs.returnSelection && options.suppressResolve !== true) {
        resolveModal(refs, null);
      } else if (!refs.returnSelection || options.keepMode) {
        // Preserve resolver when explicitly requested
      } else {
        refs.resolve = null;
        refs.returnSelection = false;
      }

      if (!options.keepMode) {
        refs.context = 'default';
        refs.includeCurrent = true;
      }
    }

    if (mobileModalKeydownHandler) {
      document.removeEventListener('keydown', mobileModalKeydownHandler, true);
      mobileModalKeydownHandler = null;
    }
  }

  function submitMobileModal() {
    const refs = getModalRefs();
    if (!refs || !refs.input) return;
    const input = refs.input;
    const value = input.value.trim();
    if (!value) return;

    if (refs.returnSelection) {
      const paneUrl = buildPaneUrl(value, 'remote');
      resolveModal(refs, paneUrl);
      closeMobileModal({ suppressResolve: true });
      return;
    }

    if (urlInput) {
      const paneUrl = buildPaneUrl(value, 'remote');
      urlInput.value = paneUrl;
      const form = urlInput.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit'));
      } else {
        location.href = paneUrl;
      }
    }
    closeMobileModal();
  }
  
  function showModalDropdown(modalDropdown) {
    modalDropdown.style.display = 'block';
    
    if (allProcesses.length > 0) {
      populateModalDropdown(allProcesses, modalDropdown);
      return;
    }
    
    modalDropdown.innerHTML = '<div class="url-dropdown-loading">Loading running processes...</div>';
    
    fetch(options.apiEndpoint)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        allProcesses = data.info || [];
        populateModalDropdown(allProcesses, modalDropdown);
      })
      .catch(error => {
        console.error('Failed to fetch processes:', error);
        modalDropdown.innerHTML = '<div class="url-dropdown-empty">Failed to load processes</div>';
      });
  }
  
  function handleModalInputChange(modalInput, modalDropdown) {
    const query = modalInput.value.toLowerCase().trim();
    let filtered = allProcesses;
    
    if (modalInput.selectionStart === 0 && modalInput.selectionEnd === modalInput.value.length) {
      filtered = allProcesses;
    } else if (query) {
      filtered = allProcesses.filter(process => {
        const url = `http://${process.ip}`;
        const name = process.name.toLowerCase();
        const urlLower = url.toLowerCase();
        return name.includes(query) || urlLower.includes(query);
      });
    }
    
    populateModalDropdown(filtered, modalDropdown);
  }
  
  function populateModalDropdown(processes, modalDropdown) {
    const modalInput = modalDropdown.parentElement.querySelector('.url-modal-input');
    const currentUrl = window.location.href;
    const currentTitle = document.title || 'Current tab';
    const overlayRefs = getModalRefs();
    const includeCurrent = overlayRefs?.includeCurrent !== false;

    let html = '';

    if (includeCurrent && currentUrl) {
      html += `
        <div class="url-dropdown-host-header current-tab">
          <span class="host-name">Current tab</span>
        </div>
        <div class="url-dropdown-item" data-url="${escapeHtml(currentUrl)}" data-host-type="current">
          <div class="url-dropdown-name">
            <i class="fa-solid fa-clone"></i>
            <span>${escapeHtml(currentTitle)}</span>
          </div>
          <div class="url-dropdown-url">${escapeHtml(currentUrl)}</div>
        </div>
      `;
    }

    if (processes.length === 0) {
      html += createEmptyStateHtml(getEmptyStateMessage(modalInput));
      modalDropdown.innerHTML = html;
      attachCreateButtonHandler(modalDropdown, modalInput);

      modalDropdown.querySelectorAll('.url-dropdown-item:not(.non-selectable)').forEach(item => {
        item.addEventListener('click', function() {
          const url = this.getAttribute('data-url');
          const type = this.getAttribute('data-host-type');
          handleModalSelection(url, type);
        });
      });
      return;
    }

    const groupedProcesses = groupProcessesByHost(processes);
    Object.keys(groupedProcesses).forEach(hostKey => {
      const hostData = groupedProcesses[hostKey];
      const hostInfo = hostData.host;
      const hostProcesses = hostData.processes;
      const isLocal = hostData.isLocal;

      html += createHostHeader(hostInfo, isLocal);

      hostProcesses.forEach(process => {
        const onlineIndicator = process.online ?
          '<div class="status-circle online"></div>' :
          '<div class="status-circle offline"></div>';

        if (process.ip === null || process.ip === undefined) {
          const networkUrl = `http://${process.host.ip}:42000/network`;
          html += `
            <div class="url-dropdown-item non-selectable">
              <div class="url-dropdown-name">
                ${onlineIndicator}
                ${escapeHtml(process.name)}
              </div>
              <button class="peer-network-button" data-network-url="${networkUrl}"><i class="fa-solid fa-toggle-on"></i> Turn on peer network</button>
            </div>
          `;
        } else {
          const url = `http://${process.ip}`;
          html += `
            <div class="url-dropdown-item" data-url="${url}" data-host-type="${process.host.local ? "local" : "remote"}">
              <div class="url-dropdown-name">
                ${onlineIndicator}
                ${escapeHtml(process.name)}
              </div>
              <div class="url-dropdown-url">${escapeHtml(url)}</div>
            </div>
          `;
        }
      });
    });

    modalDropdown.innerHTML = html;

    modalDropdown.querySelectorAll('.url-dropdown-item:not(.non-selectable)').forEach(item => {
      item.addEventListener('click', function() {
        const url = this.getAttribute('data-url');
        const type = this.getAttribute('data-host-type');
        handleModalSelection(url, type);
      });
    });

    modalDropdown.querySelectorAll('.peer-network-button').forEach(button => {
      button.addEventListener('click', function(e) {
        e.stopPropagation();
        const networkUrl = this.getAttribute('data-network-url');
        window.open(networkUrl, '_blank', 'self');
      });
    });
  }
  
  // Set up mobile button click handler
  if (mobileButton) {
    mobileButton.addEventListener('click', mobileButtonHandler);
  }

  const api = {
    show: showDropdown,
    hide: hideDropdown,
    showAll: showAllProcesses,
    showMobileModal,
    closeMobileModal,
    refresh: function() {
      allProcesses = []; // Clear cache to force refetch
      if (isDropdownVisible) {
        showDropdown();
      }
    },
    filter: handleInputChange,
    openSplitModal: function(modalOptions = {}) {
      return showMobileModal({
        title: modalOptions.title || 'Split View',
        description: modalOptions.description || 'Choose a running process or use the current tab URL for the new pane.',
        confirmLabel: modalOptions.confirmLabel || 'Split',
        includeCurrent: modalOptions.includeCurrent !== false,
        awaitSelection: true,
        context: 'split'
      });
    },
    destroy: function() {
      if (urlInput) {
        urlInput.removeEventListener('input', handleInputChange);
      }
      if (mobileButton) {
        mobileButton.removeEventListener('click', mobileButtonHandler);
      }
      hideDropdown();
      closeMobileModal({ suppressResolve: true });
      allProcesses = [];
      filteredProcesses = [];
      if (fallbackElements.form && fallbackElements.form.parentElement) {
        fallbackElements.form.parentElement.removeChild(fallbackElements.form);
      }
      if (fallbackElements.dropdown && fallbackElements.dropdown.parentElement) {
        fallbackElements.dropdown.parentElement.removeChild(fallbackElements.dropdown);
      }
      fallbackElements.form = null;
      fallbackElements.dropdown = null;
      if (window.PinokioUrlDropdown === api) {
        window.PinokioUrlDropdown = null;
      }
    }
  };

  window.PinokioUrlDropdown = api;
  return api;
  function showEmptyState(container, inputElement) {
    container.innerHTML = createEmptyStateHtml(getEmptyStateMessage(inputElement));
    attachCreateButtonHandler(container, inputElement);
  }

  function getEmptyStateMessage(inputElement) {
    const rawValue = inputElement.value.trim();
    return rawValue ? `No processes match "${rawValue}"` : 'No running processes found';
  }

  function createEmptyStateHtml(message) {
    return `
      <div class="url-dropdown-empty">
        <div class="url-dropdown-empty-message">${escapeHtml(message)}</div>
        <div class="url-dropdown-empty-actions">
          <button type="button" class="url-dropdown-create-button">Create</button>
          <div class="url-dropdown-empty-description">${escapeHtml(EMPTY_STATE_DESCRIPTION)}</div>
        </div>
      </div>
    `;
  }

  function attachCreateButtonHandler(container, inputElement) {
    const createButton = container.querySelector('.url-dropdown-create-button');
    if (!createButton) return;

    createButton.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      const prompt = inputElement.value.trim();
      const detail = {
        query: prompt,
        prompt,
        input: inputElement,
        dropdown: container,
        context: inputElement === urlInput ? 'dropdown' : 'modal'
      };

      if (detail.context === 'dropdown') {
        hideDropdown();
      } else {
        closeMobileModal();
      }

      showCreateLauncherModal(detail);

      if (typeof options.onCreate === 'function') {
        options.onCreate(detail);
      }

      if (typeof CustomEvent === 'function') {
        container.dispatchEvent(new CustomEvent('urlDropdownCreate', { detail }));
      }
    });
  }

  function showCreateLauncherModal(detail) {
    const modal = getCreateLauncherModal();
    pendingCreateDetail = detail;

    modal.error.textContent = '';
//    const defaultName = generateFolderName(detail.prompt);
    modal.input.value = '';
    modal.description.textContent = detail.prompt
      ? `Prompt: ${detail.prompt}`
      : 'Enter a prompt in the search bar to describe your launcher.';

    requestAnimationFrame(() => {
      modal.overlay.classList.add('is-visible');
      requestAnimationFrame(() => {
        modal.input.focus();
        modal.input.select();
      });
    });

    document.addEventListener('keydown', handleCreateModalEscape, true);
  }

  function hideCreateLauncherModal() {
    const modal = createLauncherModal;
    if (!modal) return;
    modal.overlay.classList.remove('is-visible');
    pendingCreateDetail = null;
    document.removeEventListener('keydown', handleCreateModalEscape, true);
  }

  function confirmCreateLauncherModal() {
    if (!createLauncherModal || !pendingCreateDetail) return;
    const folderName = createLauncherModal.input.value.trim();
    if (!folderName) {
      createLauncherModal.error.textContent = 'Please enter a folder name.';
      createLauncherModal.input.focus();
      return;
    }

    const prompt = pendingCreateDetail.prompt || '';
    const redirectUrl = `/pro?name=${encodeURIComponent(folderName)}&message=${encodeURIComponent(prompt)}`;
    hideCreateLauncherModal();
    window.location.href = redirectUrl;
  }

  function handleCreateModalKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmCreateLauncherModal();
    }
  }

  function handleCreateModalEscape(event) {
    if (event.key === 'Escape' && pendingCreateDetail) {
      event.preventDefault();
      hideCreateLauncherModal();
    }
  }

  function getCreateLauncherModal() {
    if (createLauncherModal) {
      return createLauncherModal;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay create-launcher-modal-overlay';

    const modalContent = document.createElement('div');
    modalContent.className = 'create-launcher-modal';
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');

    const title = document.createElement('h3');
    title.id = 'quick-create-launcher-title';
    title.textContent = 'Create';

    const description = document.createElement('p');
    description.className = 'create-launcher-modal-description';
    description.id = 'quick-create-launcher-description';
    description.textContent = 'Enter a prompt in the search bar to describe your launcher.';

    modalContent.setAttribute('aria-labelledby', title.id);
    modalContent.setAttribute('aria-describedby', description.id);

    const label = document.createElement('label');
    label.className = 'create-launcher-modal-label';
    label.textContent = 'Folder name';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'create-launcher-modal-input';
    input.placeholder = 'example: my-launcher';

    const error = document.createElement('div');
    error.className = 'create-launcher-modal-error';

    const actions = document.createElement('div');
    actions.className = 'create-launcher-modal-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'create-launcher-modal-button cancel';
    cancelButton.textContent = 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'create-launcher-modal-button confirm';
    confirmButton.textContent = 'Create';

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);

    label.appendChild(input);
    modalContent.appendChild(title);
    modalContent.appendChild(description);
    modalContent.appendChild(label);
    modalContent.appendChild(error);
    modalContent.appendChild(actions);
    overlay.appendChild(modalContent);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(event) {
      if (event.target === overlay) {
        hideCreateLauncherModal();
      }
    });

    cancelButton.addEventListener('click', hideCreateLauncherModal);
    confirmButton.addEventListener('click', confirmCreateLauncherModal);
    input.addEventListener('keydown', handleCreateModalKeydown);

    createLauncherModal = {
      overlay,
      modal: modalContent,
      input,
      cancelButton,
      confirmButton,
      error,
      description
    };

    return createLauncherModal;
  }

  function generateFolderName(prompt) {
    if (!prompt) return '';
    const normalized = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\-\s_]/g, '')
      .replace(/[\s_]+/g, '-');
    return normalized.replace(/^-+|-+$/g, '').slice(0, 50);
  }
}

// Auto-initialize if DOM is already loaded, otherwise wait for it
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    // Will be initialized by individual templates with their specific config
  });
} else {
  // DOM is already loaded, templates can initialize immediately
}
