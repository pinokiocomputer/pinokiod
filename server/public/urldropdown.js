/**
 * URL Dropdown functionality for process selection
 * Fetches running processes from /info/procs API and displays them in a dropdown
 */

function initUrlDropdown(config = {}) {
  const urlInput = document.querySelector('.urlbar input[type="url"]');
  const dropdown = document.getElementById('url-dropdown');
  const mobileButton = document.getElementById('mobile-link-button');
  
  if (!urlInput || !dropdown) {
    console.warn('URL dropdown elements not found');
    return;
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
    dropdown.style.display = 'none';
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
    
    console.log({ isLocal, host })
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
    if (processes.length === 0) {
      showEmptyState(dropdown, urlInput);
      return;
    }

    // Group processes by host
    const groupedProcesses = groupProcessesByHost(processes);
    
    let html = '';
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
        urlInput.setAttribute("data-host-type", type);
        hideDropdown();
        
        // Navigate directly instead of dispatching submit event
        if (type === "local") {
          let redirect_uri = "/container?url=" + url;
          location.href = redirect_uri;
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

  // Mobile modal functionality
  function createMobileModal() {
    const overlay = document.createElement('div');
    overlay.className = 'url-modal-overlay';
    overlay.id = 'url-modal-overlay';
    
    const content = document.createElement('div');
    content.className = 'url-modal-content';
    
    const closeButton = document.createElement('span');
    closeButton.className = 'url-modal-close';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = closeMobileModal;
    
    const modalInput = document.createElement('input');
    modalInput.type = 'url';
    modalInput.className = 'url-modal-input';
    modalInput.placeholder = 'enter a local url';
    
    const modalDropdown = document.createElement('div');
    modalDropdown.className = 'url-dropdown';
    modalDropdown.id = 'url-modal-dropdown';
    modalDropdown.style.position = 'relative';
    modalDropdown.style.top = '0';
    modalDropdown.style.left = '0';
    modalDropdown.style.right = '0';
    modalDropdown.style.marginTop = '10px';
    
    content.appendChild(closeButton);
    content.appendChild(modalInput);
    content.appendChild(modalDropdown);
    overlay.appendChild(content);
    
    return { overlay, input: modalInput, dropdown: modalDropdown };
  }
  
  function showMobileModal() {
    let modal = document.getElementById('url-modal-overlay');
    if (!modal) {
      const { overlay, input: modalInput, dropdown: modalDropdown } = createMobileModal();
      modal = overlay;
      document.body.appendChild(modal);
      
      // Initialize dropdown functionality for modal
      modalInput.addEventListener('focus', function() {
        if (options.clearBehavior === 'restore' && modalInput.value) {
          setTimeout(() => modalInput.select(), 0);
        }
        showModalDropdown(modalDropdown);
      });
      modalInput.addEventListener('input', function() {
        handleModalInputChange(modalInput, modalDropdown);
      });
      
      // Close modal when clicking outside content
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          closeMobileModal();
        }
      });
      
      // Handle form submission
      modalInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (modalInput.value) {
            urlInput.value = modalInput.value;
            urlInput.closest('form').dispatchEvent(new Event('submit'));
            closeMobileModal();
          }
        }
      });
    }
    
    modal.style.display = 'flex';
    const modalInput = modal.querySelector('.url-modal-input');
    
    // Set initial value based on config
    if (options.clearBehavior === 'restore') {
      modalInput.value = urlInput.value || options.defaultValue || '';
    } else {
      modalInput.value = '';
    }
    
    setTimeout(() => modalInput.focus(), 100);
  }
  
  function closeMobileModal() {
    const modal = document.getElementById('url-modal-overlay');
    if (modal) {
      modal.style.display = 'none';
    }
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
    
    if (processes.length === 0) {
      showEmptyState(modalDropdown, modalInput);
      return;
    }

    // Group processes by host
    const groupedProcesses = groupProcessesByHost(processes);
    
    let html = '';
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
                ${escapeHtml(process.name)}
              </div>
              <button class="peer-network-button" data-network-url="${networkUrl}"><i class="fa-solid fa-toggle-on"></i> Turn on peer network</button>
            </div>
          `;
        } else {
          // Normal selectable item
          const url = `http://${process.ip}`;
          html += `
            <div class="url-dropdown-item" data-url="${url}" data-host-type="${process.host.local ? "local" : "remote"}">
              ${onlineIndicator}
              <div class="url-dropdown-name">${escapeHtml(process.name)}</div>
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
        modalInput.value = url;
        urlInput.value = url;
        urlInput.setAttribute("data-host-type", type);
        closeMobileModal();
        
        // Navigate directly instead of dispatching submit event
        if (type === "local") {
          let redirect_uri = "/container?url=" + url;
          location.href = redirect_uri;
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

    // Add click handlers to peer network buttons in modal
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
    mobileButton.addEventListener('click', showMobileModal);
  }

  // Public API
  return {
    show: showDropdown,
    hide: hideDropdown,
    showAll: showAllProcesses,
    showMobileModal: showMobileModal,
    closeMobileModal: closeMobileModal,
    refresh: function() {
      allProcesses = []; // Clear cache to force refetch
      if (isDropdownVisible) {
        showDropdown();
      }
    },
    filter: handleInputChange,
    destroy: function() {
      // Remove the focus event listener (need to store reference)
      urlInput.removeEventListener('input', handleInputChange);
      if (mobileButton) {
        mobileButton.removeEventListener('click', showMobileModal);
      }
      hideDropdown();
      closeMobileModal();
      allProcesses = [];
      filteredProcesses = [];
    }
  };
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
    modal.overlay.style.display = 'flex';

//    const defaultName = generateFolderName(detail.prompt);
    modal.input.value = "";
    modal.description.textContent = detail.prompt
      ? `Prompt: ${detail.prompt}`
      : 'Enter a prompt in the search bar to describe your launcher.';
    modal.input.focus();
    modal.input.select();
    document.addEventListener('keydown', handleCreateModalEscape, true);
  }

  function hideCreateLauncherModal() {
    const modal = createLauncherModal;
    if (!modal) return;
    modal.overlay.style.display = 'none';
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
    overlay.className = 'create-launcher-modal-overlay';
    overlay.style.display = 'none';

    const modalContent = document.createElement('div');
    modalContent.className = 'create-launcher-modal';

    const title = document.createElement('h3');
    title.textContent = 'Create Launcher';

    const description = document.createElement('p');
    description.className = 'create-launcher-modal-description';
    description.textContent = 'Enter a prompt in the search bar to describe your launcher.';

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
    confirmButton.textContent = 'OK';

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
