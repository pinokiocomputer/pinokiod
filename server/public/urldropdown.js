/**
 * URL Dropdown functionality for process selection
 * Fetches running processes from /info/procs API and displays them in a dropdown
 */

function initUrlDropdown(config = {}) {
  const urlInput = document.querySelector('.urlbar input[type="url"]');
  const dropdown = document.getElementById('url-dropdown');
  
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

  function populateDropdown(processes) {
    if (processes.length === 0) {
      const query = urlInput.value.toLowerCase().trim();
      const message = query 
        ? `No processes match "${query}"` 
        : 'No running processes found';
      dropdown.innerHTML = `<div class="url-dropdown-empty">${message}</div>`;
      return;
    }

    const items = processes.map(process => {
      const url = `http://${process.ip}`;
      return `
        <div class="url-dropdown-item" data-url="${url}">
          <div class="url-dropdown-name">${escapeHtml(process.name)}</div>
          <div class="url-dropdown-url">${escapeHtml(url)}</div>
        </div>
      `;
    }).join('');

    dropdown.innerHTML = items;

    // Add click handlers to dropdown items
    dropdown.querySelectorAll('.url-dropdown-item').forEach(item => {
      item.addEventListener('click', function() {
        const url = this.getAttribute('data-url');
        urlInput.value = url;
        hideDropdown();
        // Submit the form
        urlInput.closest('form').dispatchEvent(new Event('submit'));
      });
    });
  }

  // Utility function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Public API
  return {
    show: showDropdown,
    hide: hideDropdown,
    showAll: showAllProcesses,
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
      hideDropdown();
      allProcesses = [];
      filteredProcesses = [];
    }
  };
}

// Auto-initialize if DOM is already loaded, otherwise wait for it
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    // Will be initialized by individual templates with their specific config
  });
} else {
  // DOM is already loaded, templates can initialize immediately
}