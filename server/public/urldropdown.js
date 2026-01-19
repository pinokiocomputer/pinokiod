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
    appsEndpoint: config.appsEndpoint || '/info/apps',
    ...config
  };

  const toArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
    return [value];
  };

  const getProcessUrls = (process) => {
    const urls = (process && process.urls) || {};
    const httpCandidates = toArray(urls.http);
    const httpsCandidates = toArray(urls.https);
    const normalizedHttps = httpsCandidates
      .map((value) => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (/^https?:\/\//i.test(trimmed)) {
          return trimmed.replace(/^http:/i, 'https:');
        }
        return `https://${trimmed}`;
      })
      .filter(Boolean);
    const httpUrl = httpCandidates.length > 0
      ? httpCandidates[0]
      : (process && process.ip ? `http://${process.ip}` : null);
    return {
      httpUrl,
      httpUrls: httpCandidates.filter((value) => typeof value === 'string' && value.trim().length > 0),
      httpsUrls: normalizedHttps
    };
  };

  const getProcessDisplayUrl = (process) => {
    if (process && typeof process.url === 'string' && process.url.trim().length > 0) {
      return process.url.trim();
    }
    const { httpUrl, httpsUrls } = getProcessUrls(process);
    if (httpsUrls.length > 0) {
      return httpsUrls[0];
    }
    return httpUrl;
  };

  const getProcessFilterValues = (process) => {
    const urls = new Set();
    const display = getProcessDisplayUrl(process);
    if (display) {
      urls.add(display);
    }
    const { httpUrls, httpsUrls } = getProcessUrls(process);
    httpUrls.forEach((value) => urls.add(value));
    httpsUrls.forEach((value) => urls.add(value));
    return Array.from(urls);
  };

  const ensureContainerHref = (value) => {
    if (!value || typeof value !== 'string') {
      return value;
    }
    if (value.startsWith('/container?url=')) {
      return value;
    }
    return `/container?url=${encodeURIComponent(value)}`;
  };

  const openUrlWithType = (url, type) => {
    if (!url) {
      return;
    }
    if (!type || type === 'current') {
      location.href = url;
      return;
    }
    const target = ensureContainerHref(url);
    location.href = target;
  };

  const escapeAttribute = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const formatUrlLabel = (url) => {
    if (!url) {
      return '';
    }
    return url.replace(/^https?:\/\//i, '');
  };

  const parseProjectContext = (url) => {
    if (!url || typeof url !== 'string') return null;
    let parsed;
    try {
      parsed = new URL(url, (typeof window !== 'undefined' && window.location) ? window.location.origin : undefined);
    } catch (_) {
      return null;
    }
    const pathname = parsed.pathname || '';
    const match = pathname.match(/^\/p\/([^/]+)(?:\/(dev|files|review))?\/?$/i);
    if (!match) return null;
    const project = match[1];
    const currentMode = match[2] || 'run';
    return {
      origin: parsed.origin || '',
      project,
      basePath: `/p/${project}`,
      currentMode
    };
  };

  const buildProjectModeButtons = (projectCtx) => {
    if (!projectCtx) return '';
    const modes = [
      { key: 'run', label: 'Run', icon: 'fa-solid fa-circle-play', suffix: '' },
      { key: 'dev', label: 'Dev', icon: 'fa-solid fa-code', suffix: '/dev' },
      { key: 'files', label: 'Files', icon: 'fa-solid fa-file-lines', suffix: '/files' },
    ];

    const buildTarget = (suffix) => {
      const targetPath = `${projectCtx.basePath}${suffix}`;
      return projectCtx.origin ? `${projectCtx.origin}${targetPath}` : targetPath;
    };

    const buttonsHtml = modes.map((mode) => {
      const target = buildTarget(mode.suffix);
      const isActive = mode.key === projectCtx.currentMode;
      return `
        <button type="button" class="url-mode-button${isActive ? ' active' : ''}" data-url="${escapeAttribute(target)}" data-host-type="current">
          <i class="${mode.icon}"></i>
          <span>${mode.label}</span>
        </button>
      `;
    }).join('');

    return `<div class="url-mode-buttons" role="group" aria-label="Project views">${buttonsHtml}</div>`;
  };

  const getAppBasePath = (app) => {
    if (!app || !app.name) return '';
    return `/p/${encodeURIComponent(app.name)}`;
  };

  const getAppDisplayTitle = (app) => {
    if (!app) return 'Untitled app';
    return app.title || app.name || 'Untitled app';
  };

  const buildAppProjectContext = (app, origin) => {
    const basePath = getAppBasePath(app);
    if (!basePath) return null;
    return {
      origin: origin || '',
      project: app.name,
      basePath,
      currentMode: 'run'
    };
  };

  const buildAppsSectionHtml = (apps, {
    includeCurrentTab = true,
    currentUrl = '',
    currentTitle = 'Current tab',
    currentProject = null,
    origin = ''
  } = {}) => {
    const entries = [];

    if (includeCurrentTab && currentUrl) {
      const schemeLabel = currentUrl.startsWith('https://') ? 'HTTPS' : 'HTTP';
      const currentPathLabel = currentProject ? currentProject.basePath : formatUrlLabel(currentUrl) || currentUrl;
      const projectButtons = currentProject ? buildProjectModeButtons(currentProject) : '';
      entries.push(`
        <div class="url-dropdown-item${currentProject ? ' non-selectable current-project' : ''}" data-url="${escapeAttribute(currentUrl)}" data-host-type="current">
          <div class="url-dropdown-name">
            <span>
              <i class="fa-solid fa-clone"></i>
              ${escapeHtml(currentTitle)}
            </span>
          </div>
          ${currentProject ? `
            <div class="url-dropdown-url">
              <span class="url-scheme ${schemeLabel === 'HTTPS' ? 'https' : 'http'}">${schemeLabel}</span>
              <span class="url-address">${escapeHtml(currentPathLabel)}</span>
            </div>
            ${projectButtons}
          ` : `
            <div class="url-dropdown-url">
              <span class="url-scheme ${schemeLabel === 'HTTPS' ? 'https' : 'http'}">${schemeLabel}</span>
              <span class="url-address">${escapeHtml(currentPathLabel)}</span>
            </div>
          `}
        </div>
      `);
    }

    (Array.isArray(apps) ? apps : []).forEach((app) => {
      if (!app || !app.name) return;
      if (currentProject && app.name === currentProject.project) {
        return;
      }
      const projectCtx = buildAppProjectContext(app, origin);
      if (!projectCtx) return;
      const displayUrl = projectCtx.origin ? `${projectCtx.origin}${projectCtx.basePath}` : projectCtx.basePath;
      const schemeLabel = displayUrl.startsWith('https://') ? 'HTTPS' : 'HTTP';
      const projectButtons = buildProjectModeButtons(projectCtx);
      const displayTitle = getAppDisplayTitle(app);
      entries.push(`
        <div class="url-dropdown-item non-selectable current-project" data-url="${escapeAttribute(displayUrl)}" data-host-type="current">
          <div class="url-dropdown-name">
            <span>
              <i class="fa-solid fa-box"></i>
              ${escapeHtml(displayTitle)}
            </span>
          </div>
          <div class="url-dropdown-url">
            <span class="url-scheme ${schemeLabel === 'HTTPS' ? 'https' : 'http'}">${schemeLabel}</span>
            <span class="url-address">${escapeHtml(projectCtx.basePath)}</span>
          </div>
          ${projectButtons}
        </div>
      `);
    });

    if (entries.length === 0) {
      return '';
    }

    return `
      <div class="url-dropdown-host-header current-tab">
        <span class="host-name">Apps</span>
      </div>
      ${entries.join('')}
    `;
  };

  let isDropdownVisible = false;
  let allProcesses = []; // Store all processes for filtering
  let filteredProcesses = []; // Store currently filtered processes
  let allApps = [];
  let filteredApps = [];
  let processesLoaded = false;
  let appsLoaded = false;
  let processesFetchPromise = null;
  let appsFetchPromise = null;
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
      e.preventDefault();
      e.stopPropagation();
      const el = e.target.querySelector("input[type=url]");
      if (!el) {
        return;
      }
      const val = el.value
      const type = el.getAttribute("data-host-type");
      openUrlWithType(val, type);
    });
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

  const normalizeAppsResponse = (data) => {
    if (!data) return [];
    if (Array.isArray(data.apps)) return data.apps;
    if (Array.isArray(data)) return data;
    return [];
  };

  const fetchProcesses = () => {
    if (processesLoaded) {
      return Promise.resolve(allProcesses);
    }
    if (processesFetchPromise) {
      return processesFetchPromise;
    }
    processesFetchPromise = fetch(options.apiEndpoint)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        allProcesses = data.info || [];
        processesLoaded = true;
        return allProcesses;
      })
      .catch(error => {
        console.error('Failed to fetch processes:', error);
        allProcesses = [];
        processesLoaded = true;
        return allProcesses;
      })
      .finally(() => {
        processesFetchPromise = null;
      });
    return processesFetchPromise;
  };

  const fetchApps = () => {
    if (appsLoaded) {
      return Promise.resolve(allApps);
    }
    if (appsFetchPromise) {
      return appsFetchPromise;
    }
    appsFetchPromise = fetch(options.appsEndpoint)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        allApps = normalizeAppsResponse(data);
        appsLoaded = true;
        return allApps;
      })
      .catch(error => {
        console.error('Failed to fetch apps:', error);
        allApps = [];
        appsLoaded = true;
        return allApps;
      })
      .finally(() => {
        appsFetchPromise = null;
      });
    return appsFetchPromise;
  };

  function showDropdown() {
    if (!dropdown || !urlInput) return;
    const needsProcessFetch = !processesLoaded;
    const needsAppsFetch = !appsLoaded;
    if (isDropdownVisible && !needsProcessFetch && !needsAppsFetch) {
      // If dropdown is already visible and we have data, show all initially
      showAllProcesses();
      return;
    }
    
    isDropdownVisible = true;
    dropdown.style.display = 'block';
    
    const hasAnyData = allProcesses.length > 0 || allApps.length > 0;
    if (hasAnyData) {
      showAllProcesses();
    }
    
    if (!needsProcessFetch && !needsAppsFetch) {
      return;
    }

    if (!hasAnyData) {
      dropdown.innerHTML = '<div class="url-dropdown-loading">Loading apps and running processes...</div>';
    }

    Promise.allSettled([fetchApps(), fetchProcesses()])
      .then(() => {
        if (isDropdownVisible) {
          showAllProcesses();
        }
      });
  }

  function showAllProcesses() {
    filteredProcesses = allProcesses;
    filteredApps = allApps;
    populateDropdown(filteredProcesses, filteredApps);
  }

  function handleInputChange() {
    if (!urlInput) return;
    if (!isDropdownVisible) return;
    
    const query = urlInput.value.toLowerCase().trim();
    
    // Special case: if text is selected (user just focused), don't filter yet
    if (urlInput.selectionStart === 0 && urlInput.selectionEnd === urlInput.value.length) {
      // Text is fully selected, show all processes until user starts typing
      filteredProcesses = allProcesses;
      filteredApps = allApps;
    } else if (!query) {
      // No query, show all processes
      filteredProcesses = allProcesses;
      filteredApps = allApps;
    } else {
      // Filter processes based on name and URL
      filteredProcesses = allProcesses.filter(process => {
        const name = (process.name || '').toLowerCase();
        if (name.includes(query)) {
          return true;
        }
        const urls = getProcessFilterValues(process);
        return urls.some((value) => (value || '').toLowerCase().includes(query));
      });
      filteredApps = allApps.filter(app => {
        const name = (app && app.name ? app.name : '').toLowerCase();
        const title = (app && app.title ? app.title : '').toLowerCase();
        const description = (app && app.description ? app.description : '').toLowerCase();
        if (name.includes(query) || title.includes(query) || description.includes(query)) {
          return true;
        }
        const basePath = getAppBasePath(app);
        return (basePath || '').toLowerCase().includes(query);
      });
    }
    
    populateDropdown(filteredProcesses, filteredApps);
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

  const buildProcessItemHtml = (process) => {
    const onlineIndicator = process.online ?
      '<div class="status-circle online"></div>' :
      '<div class="status-circle offline"></div>';

    if (process.ip === null || process.ip === undefined) {
      const networkUrl = `http://${process.host.ip}:42000/network`;
      return `
        <div class="url-dropdown-item non-selectable">
          <div class="url-dropdown-name">
            ${onlineIndicator}
            <button class="peer-network-button" data-network-url="${escapeAttribute(networkUrl)}"><i class="fa-solid fa-toggle-on"></i> Turn on peer network</button>
            ${escapeHtml(process.name)}
          </div>
        </div>
      `;
    }

    const displayUrl = getProcessDisplayUrl(process);
    if (!displayUrl) {
      return '';
    }
    const selectionType = (process.host && process.host.local) ? 'local' : 'remote';
    const schemeLabel = displayUrl.startsWith('https://') ? 'HTTPS' : 'HTTP';
    const formattedUrl = formatUrlLabel(displayUrl);
    return `
      <div class="url-dropdown-item" data-url="${escapeAttribute(displayUrl)}" data-host-type="${escapeAttribute(selectionType)}">
        <div class="url-dropdown-name">
          ${onlineIndicator}
          ${escapeHtml(process.name)}
        </div>
        <div class="url-dropdown-url">
          <span class="url-scheme ${schemeLabel === 'HTTPS' ? 'https' : 'http'}">${schemeLabel}</span>
          <span class="url-address">${escapeHtml(formattedUrl || displayUrl)}</span>
        </div>
      </div>
    `;
  };

  const buildHostsHtml = (processes) => {
    const groupedProcesses = groupProcessesByHost(processes);
    let html = '';

    Object.keys(groupedProcesses).forEach(hostKey => {
      const hostData = groupedProcesses[hostKey];
      const hostInfo = hostData.host;
      const hostProcesses = hostData.processes;
      const isLocal = hostData.isLocal;

      html += createHostHeader(hostInfo, isLocal);

      hostProcesses.forEach(process => {
        html += buildProcessItemHtml(process);
      });
    });

    return html;
  };

  const buildDropdownHtml = (processes, { includeCurrentTab = true, apps = [], inputElement } = {}) => {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const currentTitle = typeof document !== 'undefined' ? (document.title || 'Current tab') : 'Current tab';
    const currentProject = parseProjectContext(currentUrl);
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';

    let html = '';
    const appsHtml = buildAppsSectionHtml(apps, {
      includeCurrentTab,
      currentUrl,
      currentTitle,
      currentProject,
      origin
    });
    if (appsHtml) {
      html += appsHtml;
    }

    if (processes && processes.length > 0) {
      html += buildHostsHtml(processes);
    }

    if (!html) {
      html = createEmptyStateHtml(getEmptyStateMessage(inputElement));
    }

    return html;
  };

  function populateDropdown(processes, apps) {
    dropdown.innerHTML = buildDropdownHtml(processes, { includeCurrentTab: true, apps, inputElement: urlInput });
    attachCreateButtonHandler(dropdown, urlInput);
    attachUrlItemHandlers(dropdown);
  }

  function handleSelection(url, type, options = {}) {
    if (!url) return;
    if (urlInput && options.updateInput !== false) {
      urlInput.value = url;
      urlInput.setAttribute('data-host-type', type || 'remote');
    }
    hideDropdown();
    if (options.navigate === false) {
      return;
    }
    openUrlWithType(url, type);
  }

  function attachUrlItemHandlers(container, options = {}) {
    if (!container) return;
    const onSelect = typeof options.onSelect === 'function' ? options.onSelect : handleSelection;
    const selectionOptions = options.selectionOptions || {};
    container.querySelectorAll('.url-dropdown-item:not(.non-selectable)').forEach(item => {
      item.addEventListener('click', function() {
        const url = this.getAttribute('data-url');
        const type = this.getAttribute('data-host-type');
        if (onSelect === handleSelection) {
          onSelect(url, type, selectionOptions);
        } else {
          onSelect(url, type);
        }
      });
    });
    container.querySelectorAll('.url-mode-button').forEach(button => {
      button.addEventListener('click', function(event) {
        event.stopPropagation();
        const url = this.getAttribute('data-url');
        const type = this.getAttribute('data-host-type') || 'current';
        onSelect(url, type, selectionOptions);
      });
    });
    container.querySelectorAll('.peer-network-button').forEach(button => {
      button.addEventListener('click', function(event) {
        event.stopPropagation();
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
          location.href = paneUrl;
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
    description.textContent = 'Enter a local URL or choose from apps and running processes.';

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
    if (refs.dropdown) {
      refs.dropdown._includeCurrent = includeCurrent;
    }

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
    if (!modalDropdown || !modalDropdown.parentElement) return;
    modalDropdown.style.display = 'block';

    const includeCurrent = modalDropdown._includeCurrent !== false;
    modalDropdown._includeCurrent = includeCurrent;
    const needsProcessFetch = !processesLoaded;
    const needsAppsFetch = !appsLoaded;

    const render = (processes, apps) => {
      modalDropdown.innerHTML = buildDropdownHtml(processes, {
        includeCurrentTab: includeCurrent,
        apps,
        inputElement: modalDropdown.parentElement.querySelector('.url-modal-input')
      });
      attachCreateButtonHandler(modalDropdown, modalDropdown.parentElement.querySelector('.url-modal-input'));
      attachUrlItemHandlers(modalDropdown, { onSelect: handleModalSelection });
    };

    const hasAnyData = allProcesses.length > 0 || allApps.length > 0;
    if (hasAnyData) {
      render(allProcesses, allApps);
    }

    if (!needsProcessFetch && !needsAppsFetch) {
      return;
    }

    if (!hasAnyData) {
      modalDropdown.innerHTML = '<div class="url-dropdown-loading">Loading apps and running processes...</div>';
    }

    Promise.allSettled([fetchApps(), fetchProcesses()])
      .then(() => {
        render(allProcesses, allApps);
      });
  }
  
  function handleModalInputChange(modalInput, modalDropdown) {
    const query = modalInput.value.toLowerCase().trim();
    let filtered = allProcesses;
    let filteredAppList = allApps;
    
    if (modalInput.selectionStart === 0 && modalInput.selectionEnd === modalInput.value.length) {
      filtered = allProcesses;
      filteredAppList = allApps;
    } else if (query) {
      filtered = allProcesses.filter(process => {
        const name = (process.name || '').toLowerCase();
        if (name.includes(query)) {
          return true;
        }
        const urls = getProcessFilterValues(process);
        return urls.some((value) => (value || '').toLowerCase().includes(query));
      });
      filteredAppList = allApps.filter(app => {
        const name = (app && app.name ? app.name : '').toLowerCase();
        const title = (app && app.title ? app.title : '').toLowerCase();
        const description = (app && app.description ? app.description : '').toLowerCase();
        if (name.includes(query) || title.includes(query) || description.includes(query)) {
          return true;
        }
        const basePath = getAppBasePath(app);
        return (basePath || '').toLowerCase().includes(query);
      });
    }
    
    populateModalDropdown(filtered, filteredAppList, modalDropdown);
  }
  
  function populateModalDropdown(processes, apps, modalDropdown) {
    const modalInput = modalDropdown.parentElement.querySelector('.url-modal-input');
    const overlayRefs = getModalRefs();
    const includeCurrent = overlayRefs?.includeCurrent !== false;

    modalDropdown.innerHTML = buildDropdownHtml(processes, {
      includeCurrentTab: includeCurrent,
      apps,
      inputElement: modalInput
    });

    attachCreateButtonHandler(modalDropdown, modalInput);
    attachUrlItemHandlers(modalDropdown, { onSelect: handleModalSelection });
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
      allApps = [];
      filteredApps = [];
      processesLoaded = false;
      appsLoaded = false;
      processesFetchPromise = null;
      appsFetchPromise = null;
      if (isDropdownVisible) {
        showDropdown();
      }
    },
    filter: handleInputChange,
    openSplitModal: function(modalOptions = {}) {
      return showMobileModal({
        title: modalOptions.title || 'Split View',
        description: modalOptions.description || 'Choose an app, a running process, or use the current tab URL for the new pane.',
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
      allApps = [];
      filteredApps = [];
      processesLoaded = false;
      appsLoaded = false;
      processesFetchPromise = null;
      appsFetchPromise = null;
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
    return rawValue ? `No apps or processes match "${rawValue}"` : 'No apps or running processes found';
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

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'create-launcher-modal-close';
    closeButton.setAttribute('aria-label', 'Close create launcher modal');
    closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';

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
    modalContent.appendChild(closeButton);
    modalContent.appendChild(title);
    modalContent.appendChild(description);
    modalContent.appendChild(label);
    modalContent.appendChild(error);
    modalContent.appendChild(actions);
    overlay.appendChild(modalContent);
    document.body.appendChild(overlay);

    cancelButton.addEventListener('click', hideCreateLauncherModal);
    closeButton.addEventListener('click', hideCreateLauncherModal);
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
