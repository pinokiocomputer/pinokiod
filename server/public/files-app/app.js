(function () {
  const joinPosix = (base, segment) => {
    if (!base) return segment || '';
    if (!segment) return base;
    return `${base.replace(/\/$/, '')}/${segment}`;
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  };

  const createElement = (tag, className) => {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    return el;
  };

  const isSessionClean = (session) => {
    try {
      return session.getUndoManager().isClean();
    } catch (err) {
      return true;
    }
  };

  const FilesApp = {
    init(config) {
      if (this._initialized) {
        return;
      }
      this._initialized = true;

      this.state = {
        workspace: config.workspace,
        workspaceLabel: config.workspaceLabel,
        theme: config.theme || 'light',
        initialPath: config.initialPath || '',
        initialPathType: config.initialPathType || null,
        workspaceRoot: config.workspaceRoot || '',
        treeElements: new Map(),
        sessions: new Map(),
        openOrder: [],
        activePath: null,
        selectedTreePath: null,
        statusTimer: null,
      };

      this.dom = {
        treeRoot: document.getElementById('files-app-tree'),
        tabs: document.getElementById('files-app-tabs'),
        editorContainer: document.getElementById('files-app-editor'),
        status: document.getElementById('files-app-status'),
        saveBtn: document.getElementById('files-app-save'),
      };

      this.api = createApi(config.workspace, this.state.workspaceRoot);
      this.ace = setupEditor(this.dom.editorContainer, config.theme);
      this.modelist = ace.require('ace/ext/modelist');
      this.undoManagerCtor = ace.require('ace/undomanager').UndoManager;

      this.dom.saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.saveActiveFile();
      });

      renderTreeRoot.call(this);
      loadDirectory.call(this, '', this.state.treeElements.get(''));

      if (this.state.initialPath) {
        expandInitialPath.call(this, this.state.initialPath, this.state.initialPathType);
      }


      window.addEventListener('beforeunload', (event) => {
        if (this.hasDirtySessions()) {
          event.preventDefault();
          event.returnValue = '';
        }
      });

      const handleVisibilityRefresh = () => {
        const activePath = this.state.activePath;
        if (activePath) {
          refreshSessionIfStale.call(this, activePath);
        }
      };
      window.addEventListener('focus', handleVisibilityRefresh);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          handleVisibilityRefresh();
        }
      });

      setStatus.call(this, 'Ready');
    },

    hasDirtySessions() {
      for (const { session } of this.state.sessions.values()) {
        if (!isSessionClean(session)) {
          return true;
        }
      }
      return false;
    },

    async openFile(path, displayName) {
      const existing = this.state.sessions.get(path);
      if (existing) {
        setActiveSession.call(this, path);
        setTreeSelection.call(this, path);
        return;
      }

      try {
        setStatus.call(this, `Opening ${displayName}…`);
        const payload = await this.api.read(path);
        const session = ace.createEditSession(payload.content || '', undefined);
        session.setUseWrapMode(true);
        session.setOptions({
          tabSize: 2,
          useSoftTabs: true,
          newLineMode: 'unix',
        });
        const mode = this.modelist.getModeForPath(displayName).mode || 'ace/mode/text';
        session.setMode(mode);
        session.setUndoManager(new this.undoManagerCtor());
        session.getUndoManager().markClean();

        session.on('change', () => {
          const entryRef = this.state.sessions.get(path);
          if (entryRef && entryRef.suppressChange && entryRef.suppressChange > 0) {
            entryRef.suppressChange = Math.max(0, entryRef.suppressChange - 1);
            return;
          }
          updateDirtyState.call(this, path);
        });

        const tabEl = createTab.call(this, path, displayName);
        this.state.sessions.set(path, {
          session,
          tabEl,
          name: displayName,
          mode,
          mtime: payload.mtime,
          size: payload.size,
          stale: false,
          suppressChange: 0,
          lastPromptMtime: null,
        });
        this.state.openOrder.push(path);

        setActiveSession.call(this, path);
        setTreeSelection.call(this, path);
        setStatus.call(this, `Opened ${displayName}`);
      } catch (error) {
        console.error(error);
        setStatus.call(this, error.message || 'Failed to open file', 'error');
      }
    },

    async saveActiveFile() {
      const activePath = this.state.activePath;
      if (!activePath) {
        return;
      }
      const entry = this.state.sessions.get(activePath);
      if (!entry) {
        return;
      }
      const content = entry.session.getValue();
      this.dom.saveBtn.disabled = true;
      setStatus.call(this, 'Saving…');
      try {
        const saveResult = await this.api.save(activePath, content);
        entry.session.getUndoManager().markClean();
        entry.mtime = saveResult?.mtime ?? entry.mtime;
        entry.size = saveResult?.size ?? content.length;
        markTabStale.call(this, activePath, false);
        updateDirtyState.call(this, activePath);
        setStatus.call(this, `Saved ${entry.name}`, 'success');
      } catch (error) {
        console.error(error);
        setStatus.call(this, error.message || 'Failed to save file', 'error');
      } finally {
        updateSaveState.call(this);
      }
    },

    closeFile(path, { force = false } = {}) {
      const info = this.state.sessions.get(path);
      if (!info) {
        return;
      }
      markTabStale.call(this, path, false);
      if (!force && !isSessionClean(info.session)) {
        const confirmClose = window.confirm('Discard unsaved changes?');
        if (!confirmClose) {
          return;
        }
      }
      if (typeof info.session.destroy === 'function') {
        info.session.destroy();
      }
      if (info.tabEl && info.tabEl.parentNode) {
        info.tabEl.parentNode.removeChild(info.tabEl);
      }
      this.state.sessions.delete(path);
      this.state.openOrder = this.state.openOrder.filter((entryPath) => entryPath !== path);

      if (this.state.activePath === path) {
        const nextPath = this.state.openOrder[this.state.openOrder.length - 1];
        if (nextPath) {
          setActiveSession.call(this, nextPath);
        } else {
          this.state.activePath = null;
          this.ace.setSession(ace.createEditSession('', 'ace/mode/text'));
          this.ace.setReadOnly(true);
          updateSaveState.call(this);
          setTreeSelection.call(this, null);
        }
      }
    },
  };

  function createApi(workspace, workspaceRoot) {
    const list = async (pathPosix) => {
      const params = new URLSearchParams({ workspace });
      if (workspaceRoot) {
        params.set('root', workspaceRoot);
      }
      if (pathPosix) {
        params.set('path', pathPosix);
      }
      const response = await fetch(`/api/files/list?${params.toString()}`);
      return parseJsonResponse(response);
    };

    const read = async (pathPosix) => {
      const params = new URLSearchParams({ workspace });
      if (workspaceRoot) {
        params.set('root', workspaceRoot);
      }
      if (pathPosix) {
        params.set('path', pathPosix);
      }
      const response = await fetch(`/api/files/read?${params.toString()}`);
      return parseJsonResponse(response);
    };

    const save = async (pathPosix, content) => {
      const response = await fetch('/api/files/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace, path: pathPosix, content, root: workspaceRoot }),
      });
      return parseJsonResponse(response);
    };

    const remove = async (pathPosix) => {
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace, path: pathPosix, root: workspaceRoot }),
      });
      return parseJsonResponse(response);
    };

    const rename = async (pathPosix, newName) => {
      const response = await fetch('/api/files/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace, path: pathPosix, name: newName, root: workspaceRoot }),
      });
      return parseJsonResponse(response);
    };

    const stat = async (pathPosix) => {
      const params = new URLSearchParams({ workspace });
      if (workspaceRoot) {
        params.set('root', workspaceRoot);
      }
      if (pathPosix) {
        params.set('path', pathPosix);
      }
      params.set('meta', '1');
      const response = await fetch(`/api/files/read?${params.toString()}`);
      return parseJsonResponse(response);
    };

    return { list, read, save, remove, rename, stat };
  }

  async function parseJsonResponse(response) {
    if (!response.ok) {
      let message;
      try {
        const payload = await response.json();
        message = payload && payload.error;
      } catch (err) {
        message = await response.text();
      }
      throw new Error(message || `Request failed (${response.status})`);
    }
    return response.json();
  }

  function setupEditor(container, theme) {
    const editor = ace.edit(container);
    const resolvedTheme = theme === 'dark' ? 'ace/theme/idle_fingers' : 'ace/theme/tomorrow';
    editor.setTheme(resolvedTheme);
    editor.setShowPrintMargin(false);
    editor.renderer.setScrollMargin(8, 16, 0, 0);
    editor.setOptions({
      fontSize: 13,
      wrap: true,
      highlightActiveLine: true,
      showFoldWidgets: true,
    });
    editor.setReadOnly(true);
    return editor;
  }

  function renderTreeRoot() {
    this.dom.treeRoot.innerHTML = '';
    const list = createElement('ul', 'files-app__tree');
    this.dom.treeRoot.appendChild(list);
    const rootItem = createTreeItem.call(this, {
      name: this.state.workspaceLabel,
      path: '',
      type: 'directory',
      isRoot: true,
    });
    rootItem.dataset.loaded = 'false';
    rootItem.dataset.expanded = 'false';
    list.appendChild(rootItem);
    this.state.treeElements.set('', rootItem);
  }

  function createTreeItem(entry) {
    const li = createElement('li', 'files-app__tree-item');
    li.dataset.type = entry.type;
    li.dataset.path = entry.path;
    li.dataset.expanded = entry.isRoot ? 'true' : 'false';

    const row = createElement('button', 'files-app__tree-row');
    row.type = 'button';
    row.dataset.path = entry.path;
    row.dataset.type = entry.type;

    const icon = createElement('i');
    icon.className = entry.type === 'directory' ? 'fa-regular fa-folder' : 'fa-regular fa-file-lines';
    row.appendChild(icon);

    const label = createElement('span', 'files-app__tree-label');
    label.textContent = entry.name;
    row.appendChild(label);

    if (!entry.isRoot) {
      const actions = createElement('span', 'files-app__tree-actions');
      const renameBtn = createElement('span', 'files-app__tree-action files-app__tree-action--rename');
      renameBtn.setAttribute('role', 'button');
      renameBtn.setAttribute('aria-label', entry.type === 'directory' ? 'Rename folder' : 'Rename file');
      renameBtn.tabIndex = 0;
      renameBtn.title = entry.type === 'directory' ? 'Rename folder' : 'Rename file';
      renameBtn.innerHTML = '<i class="fa-regular fa-pen-to-square"></i>';
      const triggerRename = (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestRenameEntry.call(this, entry);
      };
      renameBtn.addEventListener('click', triggerRename);
      renameBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          triggerRename(event);
        }
      });
      actions.appendChild(renameBtn);

      const deleteBtn = createElement('span', 'files-app__tree-action files-app__tree-action--delete');
      deleteBtn.setAttribute('role', 'button');
      deleteBtn.setAttribute('aria-label', entry.type === 'directory' ? 'Delete folder' : 'Delete file');
      deleteBtn.tabIndex = 0;
      deleteBtn.title = entry.type === 'directory' ? 'Delete folder' : 'Delete file';
      deleteBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
      const triggerDelete = (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestDeleteEntry.call(this, entry);
      };
      deleteBtn.addEventListener('click', triggerDelete);
      deleteBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          triggerDelete(event);
        }
      });
      actions.appendChild(deleteBtn);
      row.appendChild(actions);
    }

    if (entry.type === 'directory') {
      row.addEventListener('click', (event) => {
        event.preventDefault();
        toggleDirectory.call(this, li, entry.path);
      });
    } else {
      row.addEventListener('click', (event) => {
        event.preventDefault();
        this.openFile(entry.path, entry.name);
      });
    }

    li.appendChild(row);
    const children = createElement('ul', 'files-app__tree-children');
    li.appendChild(children);
    return li;
  }

  async function loadDirectory(relativePath, treeItem) {
    if (!treeItem || treeItem.dataset.loading === 'true') {
      return;
    }
    treeItem.dataset.loading = 'true';
    try {
      const payload = await this.api.list(relativePath);
      renderDirectoryChildren.call(this, relativePath, treeItem, payload.entries || []);
      treeItem.dataset.loaded = 'true';
      treeItem.dataset.expanded = 'true';
      const childrenContainer = treeItem.querySelector('.files-app__tree-children');
      if (childrenContainer) {
        childrenContainer.style.display = 'block';
      }
      updateDirectoryIcon(treeItem);
    } catch (error) {
      console.error(error);
      setStatus.call(this, error.message || 'Unable to load directory', 'error');
    } finally {
      treeItem.dataset.loading = 'false';
    }
  }

  function renderDirectoryChildren(parentPath, parentItem, entries) {
    const prefix = parentPath ? `${parentPath}/` : '';
    for (const key of Array.from(this.state.treeElements.keys())) {
      if (!key) continue;
      if (key === parentPath) continue;
      if (key.startsWith(prefix)) {
        this.state.treeElements.delete(key);
      }
    }

    const container = parentItem.querySelector('.files-app__tree-children');
    container.innerHTML = '';

    if (!entries.length) {
      const empty = createElement('div', 'files-app__empty-state');
      empty.textContent = 'No files yet';
      container.appendChild(empty);
      parentItem.dataset.expanded = 'true';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const item = createTreeItem.call(this, entry);
      item.dataset.loaded = entry.type === 'directory' && entry.hasChildren === false ? 'true' : 'false';
      item.dataset.expanded = 'false';
      fragment.appendChild(item);
      this.state.treeElements.set(entry.path, item);
    }
    container.appendChild(fragment);
    container.style.display = parentItem.dataset.expanded === 'true' ? 'block' : 'none';
  }

  function requestDeleteEntry(entry) {
    if (!entry || !entry.path) {
      return;
    }
    const path = entry.path;
    const displayName = entry.name || path.split('/').pop() || this.state.workspaceLabel;
    const impacted = [];
    for (const [sessionPath, info] of this.state.sessions.entries()) {
      if (sessionPath === path || sessionPath.startsWith(`${path}/`)) {
        impacted.push({ path: sessionPath, info });
      }
    }
    let message = entry.type === 'directory'
      ? `Delete folder "${displayName}" and all of its contents?`
      : `Delete file "${displayName}"?`;
    if (impacted.some(({ info }) => info && info.session && !isSessionClean(info.session))) {
      message += '\n\nUnsaved changes in open editors will be lost.';
    }
    const confirmed = window.confirm(message);
    if (!confirmed) {
      return;
    }
    deleteEntry.call(this, entry, impacted.map(({ path }) => path));
  }

  function requestRenameEntry(entry) {
    if (!entry || !entry.path) {
      return;
    }
    const path = entry.path;
    const displayName = entry.name || path.split('/').pop() || this.state.workspaceLabel;
    let nextName = window.prompt('Rename to:', displayName);
    if (nextName === null) {
      return;
    }
    nextName = nextName.trim();
    if (!nextName) {
      setStatus.call(this, 'Name cannot be empty', 'error');
      return;
    }
    if (nextName.includes('/') || nextName.includes('\\')) {
      setStatus.call(this, 'Name cannot contain path separators', 'error');
      return;
    }
    if (nextName === displayName) {
      return;
    }
    renameEntry.call(this, entry, nextName);
  }

  async function renameEntry(entry, newName) {
    if (!entry || !entry.path) {
      return;
    }
    const path = entry.path;
    const displayName = entry.name || path.split('/').pop() || this.state.workspaceLabel;
    if (!this.api || typeof this.api.rename !== 'function') {
      setStatus.call(this, 'Rename is not available', 'error');
      return;
    }
    setStatus.call(this, `Renaming ${displayName}…`);
    try {
      const result = await this.api.rename(path, newName);
      const targetPath = result && typeof result.target === 'string' ? result.target : path;

      const oldPrefix = `${path}/`;

      const updates = [];
      for (const [sessionPath, entryRef] of this.state.sessions.entries()) {
        if (sessionPath === path || sessionPath.startsWith(oldPrefix)) {
          const suffix = sessionPath.slice(path.length);
          const newSessionPath = `${targetPath}${suffix}`;
          updates.push({ oldPath: sessionPath, newPath: newSessionPath, ref: entryRef, suffix });
        }
      }

      if (updates.length > 0) {
        for (const { oldPath, newPath, ref, suffix } of updates) {
          this.state.sessions.delete(oldPath);
          this.state.sessions.set(newPath, ref);
          if (this.state.activePath === oldPath) {
            this.state.activePath = newPath;
          }
          const tab = ref.tabEl;
          if (tab) {
            tab.dataset.path = newPath;
            const label = tab.querySelector('.files-app__tab-label');
            if (label && suffix.length === 0) {
              label.textContent = newName;
            }
          }
          if (suffix.length === 0) {
            ref.name = newName;
          }
        }
        this.state.openOrder = this.state.openOrder.map((existing) => {
          if (existing === path) {
            return targetPath;
          }
          if (existing.startsWith(oldPrefix)) {
            return `${targetPath}${existing.slice(path.length)}`;
          }
          return existing;
        });
      }

      if (this.state.selectedTreePath) {
        if (this.state.selectedTreePath === path) {
          this.state.selectedTreePath = targetPath;
        } else if (this.state.selectedTreePath.startsWith(oldPrefix)) {
          this.state.selectedTreePath = `${targetPath}${this.state.selectedTreePath.slice(path.length)}`;
        }
      }

      pruneTreeCache.call(this, path);

      const parentPath = path.split('/').slice(0, -1).join('/');
      const parentItem = this.state.treeElements.get(parentPath) || this.state.treeElements.get('');
      if (parentItem) {
        parentItem.dataset.loaded = 'false';
        await loadDirectory.call(this, parentPath, parentItem);
        if (this.state.treeElements.has(targetPath)) {
          setTreeSelection.call(this, targetPath);
        } else {
          setTreeSelection.call(this, parentPath);
        }
      }

      setStatus.call(this, `${displayName} renamed`, 'success');
    } catch (error) {
      console.error(error);
      setStatus.call(this, error.message || 'Failed to rename', 'error');
    }
  }

  async function deleteEntry(entry, impactedPaths) {
    if (!entry || !entry.path) {
      return;
    }
    const path = entry.path;
    const displayName = entry.name || path.split('/').pop() || this.state.workspaceLabel;
    if (!this.api || typeof this.api.remove !== 'function') {
      setStatus.call(this, 'Delete is not available', 'error');
      return;
    }
    setStatus.call(this, `Deleting ${displayName}…`);
    try {
      await this.api.remove(path);

      if (Array.isArray(impactedPaths)) {
        for (const sessionPath of impactedPaths) {
          this.closeFile(sessionPath, { force: true });
        }
      }

      pruneTreeCache.call(this, path);

      const parentPath = path.split('/').slice(0, -1).join('/');
      const parentItem = this.state.treeElements.get(parentPath) || this.state.treeElements.get('');
      if (parentItem) {
        parentItem.dataset.loaded = 'false';
        await loadDirectory.call(this, parentPath, parentItem);
        setTreeSelection.call(this, parentPath);
      }

      if (this.state.selectedTreePath && (this.state.selectedTreePath === path || this.state.selectedTreePath.startsWith(`${path}/`))) {
        setTreeSelection.call(this, null);
      }

      setStatus.call(this, `${displayName} deleted`, 'success');
    } catch (error) {
      console.error(error);
      setStatus.call(this, error.message || 'Failed to delete', 'error');
    }
  }

  function pruneTreeCache(path) {
    if (typeof path !== 'string') {
      return;
    }
    const prefix = path ? `${path}/` : '';
    for (const key of Array.from(this.state.treeElements.keys())) {
      if (!key) continue;
      if (key === path || (prefix && key.startsWith(prefix))) {
        this.state.treeElements.delete(key);
      }
    }
  }

  async function toggleDirectory(treeItem, relativePath) {
    if (!treeItem || treeItem.dataset.loading === 'true') {
      return;
    }
    if (treeItem.dataset.loaded !== 'true') {
      await loadDirectory.call(this, relativePath, treeItem);
      return;
    }
    const expanded = treeItem.dataset.expanded === 'true';
    const nextExpanded = expanded ? 'false' : 'true';
    treeItem.dataset.expanded = nextExpanded;
    const childrenContainer = treeItem.querySelector('.files-app__tree-children');
    if (childrenContainer) {
      if (nextExpanded === 'true') {
        childrenContainer.style.display = 'block';
        if (childrenContainer.childElementCount === 0) {
          await loadDirectory.call(this, relativePath, treeItem);
        }
      } else {
        childrenContainer.style.display = 'none';
      }
    }
    updateDirectoryIcon(treeItem);
  }

  function updateDirectoryIcon(treeItem) {
    const row = treeItem.querySelector('.files-app__tree-row i');
    if (!row) {
      return;
    }
    const expanded = treeItem.dataset.expanded === 'true';
    row.className = expanded ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder';
  }

  function createTab(path, label) {
    const tab = createElement('button', 'files-app__tab');
    tab.type = 'button';
    tab.dataset.path = path;
    tab.setAttribute('role', 'tab');
    const text = createElement('span', 'files-app__tab-label');
    text.textContent = label;
    tab.appendChild(text);

    const close = createElement('button', 'files-app__tab-close');
    close.type = 'button';
    close.innerHTML = '&times;';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeFile(path);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      setActiveSession.call(this, path);
      setTreeSelection.call(this, path);
    });

    this.dom.tabs.appendChild(tab);
    return tab;
  }

  function markTabStale(path, isStale) {
    const entry = this.state.sessions.get(path);
    if (!entry) {
      return;
    }
    entry.stale = Boolean(isStale);
    if (entry.tabEl) {
      entry.tabEl.classList.toggle('files-app__tab--stale', entry.stale);
    }
  }

  async function refreshSessionIfStale(path) {
    const entry = this.state.sessions.get(path);
    if (!entry || !this.api || typeof this.api.stat !== 'function') {
      return;
    }
    try {
      const meta = await this.api.stat(path);
      if (!meta || typeof meta.mtime !== 'number') {
        return;
      }
      const storedMtime = typeof entry.mtime === 'number' ? entry.mtime : null;
      const storedSize = typeof entry.size === 'number' ? entry.size : null;
      const changed = (storedMtime !== null && storedMtime !== meta.mtime) ||
        (storedSize !== null && storedSize !== meta.size);
      if (!changed) {
        if (entry.stale) {
          markTabStale.call(this, path, false);
        }
        entry.lastPromptMtime = null;
        return;
      }
      if (entry.lastPromptMtime === meta.mtime) {
        return;
      }
      entry.lastPromptMtime = meta.mtime;
      if (!isSessionClean(entry.session)) {
        markTabStale.call(this, path, true);
        if (!entry.stale) {
          setStatus.call(this, `${entry.name} changed on disk`, 'error');
        }
        return;
      }
      const shouldReload = window.confirm(`${entry.name} changed on disk. Reload from disk?`);
      if (!shouldReload) {
        markTabStale.call(this, path, true);
        return;
      }
      const payload = await this.api.read(path);
      entry.suppressChange = 3;
      entry.session.setValue(payload.content || '', -1);
      entry.session.clearSelection();
      entry.session.getUndoManager().markClean();
      entry.mtime = payload.mtime;
      entry.size = payload.size;
      entry.lastPromptMtime = null;
      markTabStale.call(this, path, false);
      updateDirtyState.call(this, path);
      setStatus.call(this, `${entry.name} reloaded`, 'success');
    } catch (error) {
      console.error(error);
    }
  }

  function setActiveSession(path) {
    const entry = this.state.sessions.get(path);
    if (!entry) {
      return;
    }
    this.state.activePath = path;
    this.ace.setReadOnly(false);
    this.ace.setSession(entry.session);
    this.ace.focus();
    updateTabsUi.call(this);
    updateDirtyState.call(this, path);
    setTreeSelection.call(this, path);
    refreshSessionIfStale.call(this, path);
  }

  function updateTabsUi() {
    const activePath = this.state.activePath;
    for (const [path, info] of this.state.sessions.entries()) {
      if (!info.tabEl) continue;
      if (path === activePath) {
        info.tabEl.classList.add('files-app__tab--active');
        info.tabEl.setAttribute('aria-selected', 'true');
      } else {
        info.tabEl.classList.remove('files-app__tab--active');
        info.tabEl.setAttribute('aria-selected', 'false');
      }
    }
  }

  function updateDirtyState(path) {
    const entry = this.state.sessions.get(path);
    if (!entry) {
      return;
    }
    const dirty = !isSessionClean(entry.session);
    if (entry.tabEl) {
      entry.tabEl.classList.toggle('files-app__tab--dirty', dirty);
    }
    if (path === this.state.activePath) {
      updateSaveState.call(this);
      if (dirty) {
        setStatus.call(this, 'Unsaved changes');
      }
    }
  }

  function updateSaveState() {
    const activePath = this.state.activePath;
    if (!activePath) {
      this.dom.saveBtn.disabled = true;
      return;
    }
    const entry = this.state.sessions.get(activePath);
    if (!entry) {
      this.dom.saveBtn.disabled = true;
      return;
    }
    this.dom.saveBtn.disabled = isSessionClean(entry.session);
  }

  function setTreeSelection(path) {
    if (this.state.selectedTreePath && this.state.treeElements.has(this.state.selectedTreePath)) {
      const prevItem = this.state.treeElements.get(this.state.selectedTreePath);
      const prevRow = prevItem && prevItem.querySelector('.files-app__tree-row');
      if (prevRow) {
        prevRow.dataset.selected = 'false';
      }
    }

    if (!path) {
      this.state.selectedTreePath = null;
      return;
    }

    const item = this.state.treeElements.get(path);
    if (!item) {
      this.state.selectedTreePath = null;
      return;
    }
    const row = item.querySelector('.files-app__tree-row');
    if (row) {
      row.dataset.selected = 'true';
    }
    this.state.selectedTreePath = path;
  }

  function setStatus(message, type = 'info') {
    if (this.state.statusTimer) {
      clearTimeout(this.state.statusTimer);
      this.state.statusTimer = null;
    }
    this.dom.status.dataset.state = type;
    this.dom.status.textContent = message;
    if (type === 'success') {
      this.state.statusTimer = setTimeout(() => {
        this.dom.status.dataset.state = 'info';
        this.dom.status.textContent = 'Ready';
        this.state.statusTimer = null;
      }, 3000);
    }
  }

  async function expandInitialPath(initialPath, initialType) {
    const segments = String(initialPath).split('/').filter(Boolean);
    if (segments.length === 0) {
      const root = this.state.treeElements.get('');
      if (root) {
        await loadDirectory.call(this, '', root);
      }
      return;
    }

    let currentPath = '';
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const nextPath = joinPosix(currentPath, segment);
      const parentItem = this.state.treeElements.get(currentPath);
      if (parentItem && parentItem.dataset.loaded !== 'true') {
        await loadDirectory.call(this, currentPath, parentItem);
      }
      const targetItem = this.state.treeElements.get(nextPath);
      if (!targetItem) {
        break;
      }
      if (i < segments.length - 1 || initialType === 'directory') {
        if (targetItem.dataset.loaded !== 'true') {
          await loadDirectory.call(this, nextPath, targetItem);
        }
        targetItem.dataset.expanded = 'true';
        updateDirectoryIcon(targetItem);
      }
      currentPath = nextPath;
    }

    if (initialType === 'file' && currentPath) {
      this.openFile(currentPath, segments[segments.length - 1]);
    }
  }

  window.FilesApp = FilesApp;
})();
