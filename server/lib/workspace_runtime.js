const path = require("path");

function createWorkspaceRuntimeService({ kernel }) {
  if (!kernel) {
    throw new Error("kernel is required");
  }

  const normalizePathKey = (value) => {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    const resolved = path.resolve(value.trim());
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };

  const decodeMaybe = (value) => {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
      return "";
    }
    try {
      return decodeURIComponent(raw).trim();
    } catch (_) {
      return raw;
    }
  };

  const resolveCandidatePath = (value) => {
    const decoded = decodeMaybe(value);
    if (!decoded || decoded.includes("\0")) {
      return "";
    }
    if (decoded.startsWith("~/")) {
      return path.resolve(kernel.homedir, decoded.slice(2));
    }
    if (path.isAbsolute(decoded)) {
      return path.resolve(decoded);
    }
    return "";
  };

  const knownRoots = () => {
    const roots = [];
    const addRoot = (type, label) => {
      if (!kernel || typeof kernel.path !== "function") {
        return;
      }
      const rootPath = kernel.path(type);
      if (typeof rootPath === "string" && rootPath.trim()) {
        roots.push({
          type,
          label,
          path: path.resolve(rootPath)
        });
      }
    };
    addRoot("workspaces", "Workspace");
    addRoot("api", "App");
    addRoot("plugin", "Plugin");
    return roots;
  };

  const isPathWithin = (candidate, root) => {
    if (!candidate || !root) {
      return false;
    }
    const relative = path.relative(root, candidate);
    return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const resolveWorkspaceForPath = (candidatePath) => {
    const candidate = resolveCandidatePath(candidatePath);
    if (!candidate) {
      return null;
    }
    for (const root of knownRoots()) {
      if (!isPathWithin(candidate, root.path)) {
        continue;
      }
      const relative = path.relative(root.path, candidate);
      const segments = relative.split(path.sep).filter(Boolean);
      const name = segments[0] || "";
      if (!name) {
        continue;
      }
      const cwd = path.resolve(root.path, name);
      return {
        key: normalizePathKey(cwd),
        cwd,
        name,
        root: root.type,
        rootLabel: root.label
      };
    }
    return null;
  };

  const parseParamsFromText = (value) => {
    const raw = typeof value === "string" ? value : "";
    const index = raw.indexOf("?");
    if (index < 0) {
      return null;
    }
    try {
      return new URLSearchParams(raw.slice(index + 1).replace(/&amp;/g, "&"));
    } catch (_) {
      return null;
    }
  };

  const firstWorkspaceFromCandidates = (candidates) => {
    for (const candidate of candidates) {
      const workspace = resolveWorkspaceForPath(candidate);
      if (workspace) {
        return workspace;
      }
    }
    return null;
  };

  const getShellCandidates = (shell) => {
    const candidates = [];
    if (!shell || typeof shell !== "object") {
      return candidates;
    }
    const push = (value) => {
      if (typeof value === "string" && value.trim()) {
        candidates.push(value);
      }
    };
    push(shell.path);
    push(shell.group);
    if (shell.params && typeof shell.params === "object") {
      push(shell.params.cwd);
      push(shell.params.path);
      if (shell.params.$parent && typeof shell.params.$parent === "object") {
        push(shell.params.$parent.cwd);
        push(shell.params.$parent.path);
      }
    }
    for (const text of [shell.id, shell.group]) {
      const params = parseParamsFromText(text);
      if (!params) {
        continue;
      }
      push(params.get("cwd"));
      push(params.get("path"));
    }
    return candidates;
  };

  const getScriptCandidates = (id) => {
    const candidates = [];
    const raw = typeof id === "string" ? id : "";
    if (!raw) {
      return candidates;
    }
    const params = parseParamsFromText(raw);
    if (params) {
      candidates.push(params.get("cwd"));
      candidates.push(params.get("path"));
    }
    const pathPart = raw.split("?")[0];
    candidates.push(pathPart);
    return candidates;
  };

  const parseTerminalIdFromText = (value) => {
    const params = parseParamsFromText(value);
    if (!params) {
      return "";
    }
    const terminalId = params.get("terminal_id");
    return typeof terminalId === "string" ? terminalId.trim() : "";
  };

  const buildShellUrl = (shell) => {
    const raw = shell && typeof shell.id === "string" ? shell.id.trim() : "";
    if (!raw) {
      return "";
    }
    const index = raw.indexOf("?");
    const base = index >= 0 ? raw.slice(0, index) : raw;
    const query = index >= 0 ? raw.slice(index + 1) : "";
    const params = new URLSearchParams(query);
    if (!params.has("path") && shell && typeof shell.path === "string" && shell.path.trim()) {
      params.set("path", shell.path.trim());
    }
    if (!params.has("terminal_id") && shell && typeof shell.terminal_id === "string" && shell.terminal_id.trim()) {
      params.set("terminal_id", shell.terminal_id.trim());
    }
    if (!params.has("input")) {
      params.set("input", "1");
    }
    const queryString = params.toString();
    let route = "";
    if (base.startsWith("/shell/")) {
      const shellId = base.slice("/shell/".length);
      route = shellId.includes("/")
        ? `/shell/${encodeURIComponent(shellId)}`
        : base;
    } else if (base.startsWith("shell/")) {
      route = `/shell/${encodeURIComponent(base.slice("shell/".length))}`;
    } else {
      route = `/shell/${encodeURIComponent(base)}`;
    }
    return queryString ? `${route}?${queryString}` : route;
  };

  const buildRunUrl = (id) => {
    const raw = typeof id === "string" ? id.trim() : "";
    if (!raw) {
      return "";
    }
    const index = raw.indexOf("?");
    const scriptPath = resolveCandidatePath(index >= 0 ? raw.slice(0, index) : raw);
    const query = index >= 0 ? raw.slice(index + 1) : "";
    if (!scriptPath) {
      return "";
    }
    const roots = [
      { name: "api", path: kernel.path("api") },
      { name: "plugin", path: kernel.path("plugin") },
      { name: "scripts", path: kernel.path("scripts") }
    ].filter((root) => typeof root.path === "string" && root.path.trim());
    for (const root of roots) {
      const rootPath = path.resolve(root.path);
      const relative = path.relative(rootPath, scriptPath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        continue;
      }
      const params = new URLSearchParams(query);
      if (!params.has("chrome")) {
        params.set("chrome", "full");
      }
      const route = relative.split(path.sep).map(encodeURIComponent).join("/");
      const queryString = params.toString();
      return `/run/${root.name}/${route}${queryString ? `?${queryString}` : ""}`;
    }
    return "";
  };

  const shellTitle = (shell) => {
    if (shell && shell.params && typeof shell.params.$title === "string" && shell.params.$title.trim()) {
      return shell.params.$title.trim();
    }
    if (shell && typeof shell.cmd === "string" && shell.cmd.trim()) {
      return shell.cmd.trim().slice(0, 120);
    }
    return "Terminal";
  };

  const scriptTitle = (id) => {
    const raw = typeof id === "string" ? id.trim() : "";
    if (!raw) {
      return "Script";
    }
    const pathPart = raw.split("?")[0];
    if (pathPart && path.isAbsolute(pathPart)) {
      return path.basename(pathPart) || "Script";
    }
    return raw.slice(0, 120);
  };

  const createGroup = (workspace) => ({
    cwd: workspace.cwd,
    name: workspace.name,
    root: workspace.root,
    rootLabel: workspace.rootLabel,
    running: true,
    shells: [],
    scripts: []
  });

  const list = () => {
    const groups = new Map();
    const unscoped = {
      shells: [],
      scripts: []
    };
    const getGroup = (workspace) => {
      if (!workspace || !workspace.key) {
        return null;
      }
      if (!groups.has(workspace.key)) {
        groups.set(workspace.key, createGroup(workspace));
      }
      return groups.get(workspace.key);
    };

    const shells = kernel.shell && Array.isArray(kernel.shell.shells)
      ? kernel.shell.shells
      : [];
    for (const shell of shells) {
      if (!shell || shell.done === true || !shell.ptyProcess) {
        continue;
      }
      const item = {
        id: typeof shell.id === "string" ? shell.id : "",
        group: typeof shell.group === "string" ? shell.group : "",
        title: shellTitle(shell),
        cwd: typeof shell.path === "string" ? shell.path : "",
        state: shell.state || null,
        start_time: Number.isFinite(shell.start_time) ? shell.start_time : null,
        terminal_id: shell.terminal_id || parseTerminalIdFromText(shell.id) || parseTerminalIdFromText(shell.group) || null,
        url: buildRunUrl(shell.group) || buildShellUrl(shell)
      };
      const workspace = firstWorkspaceFromCandidates(getShellCandidates(shell));
      const group = getGroup(workspace);
      if (group) {
        group.shells.push(item);
      } else {
        unscoped.shells.push(item);
      }
    }

    const running = kernel.api && kernel.api.running && typeof kernel.api.running === "object"
      ? kernel.api.running
      : {};
    for (const id of Object.keys(running)) {
      if (typeof id !== "string" || !id || id.startsWith("shell/")) {
        continue;
      }
      const item = {
        id,
        title: scriptTitle(id),
        path: id.split("?")[0],
        cwd: "",
        url: buildRunUrl(id)
      };
      const workspace = firstWorkspaceFromCandidates(getScriptCandidates(id));
      if (workspace) {
        item.cwd = workspace.cwd;
      }
      const group = getGroup(workspace);
      if (group) {
        group.scripts.push(item);
      } else {
        unscoped.scripts.push(item);
      }
    }

    const workspaces = Array.from(groups.values())
      .map((workspace) => ({
        ...workspace,
        counts: {
          shells: workspace.shells.length,
          scripts: workspace.scripts.length
        }
      }))
      .sort((a, b) => {
        const totalA = a.counts.shells + a.counts.scripts;
        const totalB = b.counts.shells + b.counts.scripts;
        if (totalA !== totalB) {
          return totalB - totalA;
        }
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    return {
      workspaces,
      unscoped,
      counts: {
        workspaces: workspaces.length,
        shells: workspaces.reduce((total, workspace) => total + workspace.counts.shells, 0) + unscoped.shells.length,
        scripts: workspaces.reduce((total, workspace) => total + workspace.counts.scripts, 0) + unscoped.scripts.length
      }
    };
  };

  const summary = () => {
    const runtime = list();
    return {
      runningWorkspaces: runtime.counts.workspaces,
      runningShells: runtime.counts.shells,
      runningScripts: runtime.counts.scripts,
      unscopedShells: runtime.unscoped.shells.length,
      unscopedScripts: runtime.unscoped.scripts.length
    };
  };

  return {
    list,
    summary
  };
}

module.exports = {
  createWorkspaceRuntimeService
};
