const fs = require("fs");
const path = require("path");

const TASK_WORKSPACE_LINKS_VERSION = 1;
const TASK_WORKSPACE_LINKS_FILENAME = "workspace-links.json";
const TASK_ID_PATTERN = /^t[1-9][0-9]*$/;
const WORKSPACE_ROOTS = new Set(["workspaces", "api", "plugin"]);

function normalizeTaskId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!TASK_ID_PATTERN.test(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeWorkspaceRef(value) {
  const raw = typeof value === "string"
    ? value.trim().replace(/\\/g, "/")
    : "";
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    return "";
  }

  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) {
    return "";
  }

  const root = parts[0];
  if (!WORKSPACE_ROOTS.has(root)) {
    return "";
  }

  const relative = path.posix.normalize(parts.slice(1).join("/"));
  if (!relative || relative === "." || relative === ".." || relative.startsWith("../") || relative.includes("/../")) {
    return "";
  }

  return `${root}/${relative}`;
}

function normalizeTimestamp(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toISOString();
}

function compareWorkspaceEntries(a, b) {
  const aLastUsed = normalizeTimestamp(a && a.last_used_at) || "";
  const bLastUsed = normalizeTimestamp(b && b.last_used_at) || "";
  if (aLastUsed !== bLastUsed) {
    return aLastUsed > bLastUsed ? -1 : 1;
  }
  const aCreated = normalizeTimestamp(a && a.created_at) || "";
  const bCreated = normalizeTimestamp(b && b.created_at) || "";
  if (aCreated !== bCreated) {
    return aCreated > bCreated ? -1 : 1;
  }
  const aRef = a && a.ref ? a.ref : "";
  const bRef = b && b.ref ? b.ref : "";
  return aRef.localeCompare(bRef);
}

function normalizeWorkspaceEntries(entries) {
  const map = new Map();
  const sourceEntries = Array.isArray(entries) ? entries : [];
  sourceEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const ref = normalizeWorkspaceRef(entry.ref);
    if (!ref) {
      return;
    }
    const createdAt = normalizeTimestamp(entry.created_at);
    const lastUsedAt = normalizeTimestamp(entry.last_used_at);
    if (!map.has(ref)) {
      map.set(ref, {
        ref,
        created_at: createdAt,
        last_used_at: lastUsedAt || createdAt
      });
      return;
    }
    const existing = map.get(ref);
    if (!existing.created_at || (createdAt && createdAt < existing.created_at)) {
      existing.created_at = createdAt;
    }
    if (!existing.last_used_at || (lastUsedAt && lastUsedAt > existing.last_used_at)) {
      existing.last_used_at = lastUsedAt;
    }
    if (!existing.last_used_at && existing.created_at) {
      existing.last_used_at = existing.created_at;
    }
  });
  return Array.from(map.values()).sort(compareWorkspaceEntries);
}

function normalizeRegistry(rawRegistry) {
  const tasks = {};
  const sourceTasks = rawRegistry && typeof rawRegistry === "object" && !Array.isArray(rawRegistry)
    ? rawRegistry.tasks
    : null;
  if (sourceTasks && typeof sourceTasks === "object" && !Array.isArray(sourceTasks)) {
    Object.entries(sourceTasks).forEach(([taskId, entry]) => {
      const normalizedTaskId = normalizeTaskId(taskId);
      if (!normalizedTaskId || !entry || typeof entry !== "object" || Array.isArray(entry)) {
        return;
      }
      const workspaces = normalizeWorkspaceEntries(entry.workspaces);
      const workspaceRefs = new Set(workspaces.map((workspace) => workspace.ref));
      const lastUsedRef = normalizeWorkspaceRef(entry.last_used_ref);
      tasks[normalizedTaskId] = {
        last_used_ref: lastUsedRef && workspaceRefs.has(lastUsedRef)
          ? lastUsedRef
          : (workspaces[0] && workspaces[0].ref ? workspaces[0].ref : ""),
        workspaces
      };
    });
  }
  return {
    version: TASK_WORKSPACE_LINKS_VERSION,
    tasks
  };
}

function createTaskWorkspaceLinkService({ kernel }) {
  if (!kernel) {
    throw new Error("kernel is required");
  }

  const linksPath = () => path.resolve(kernel.path("tasks"), TASK_WORKSPACE_LINKS_FILENAME);

  async function ensureTasksRoot() {
    await fs.promises.mkdir(path.resolve(kernel.path("tasks")), { recursive: true });
  }

  async function readRegistry() {
    await ensureTasksRoot();
    const registryPath = linksPath();
    try {
      const raw = await fs.promises.readFile(registryPath, "utf8");
      return normalizeRegistry(JSON.parse(raw));
    } catch (_) {
      const initial = normalizeRegistry(null);
      await fs.promises.writeFile(registryPath, JSON.stringify(initial, null, 2));
      return initial;
    }
  }

  async function writeRegistry(registry) {
    await ensureTasksRoot();
    const normalized = normalizeRegistry(registry);
    await fs.promises.writeFile(linksPath(), JSON.stringify(normalized, null, 2));
    return normalized;
  }

  function resolveWorkspaceRef(ref) {
    const normalizedRef = normalizeWorkspaceRef(ref);
    if (!normalizedRef) {
      return "";
    }
    const segments = normalizedRef.split("/");
    const root = segments.shift();
    const relative = segments.join("/");
    if (!root || !relative) {
      return "";
    }
    return path.resolve(kernel.path(root, relative));
  }

  function createWorkspaceRef(root, absolutePath) {
    const normalizedRoot = typeof root === "string" ? root.trim() : "";
    if (!WORKSPACE_ROOTS.has(normalizedRoot)) {
      return "";
    }
    const rootPath = path.resolve(kernel.path(normalizedRoot));
    const targetPath = typeof absolutePath === "string" && absolutePath.trim()
      ? path.resolve(absolutePath.trim())
      : "";
    if (!targetPath) {
      return "";
    }
    const relative = path.relative(rootPath, targetPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return "";
    }
    return normalizeWorkspaceRef(`${normalizedRoot}/${relative.split(path.sep).join("/")}`);
  }

  async function workspaceExists(ref) {
    const resolvedPath = resolveWorkspaceRef(ref);
    if (!resolvedPath) {
      return false;
    }
    const stats = await fs.promises.stat(resolvedPath).catch(() => null);
    return Boolean(stats && stats.isDirectory());
  }

  async function listTaskWorkspaces(taskId, options = {}) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }

    const rootFilter = typeof options.root === "string" ? options.root.trim() : "";
    const pruneMissing = options.pruneMissing === true;
    const registry = await readRegistry();
    const entry = registry.tasks[normalizedTaskId] || { last_used_ref: "", workspaces: [] };

    let changed = false;
    let workspaces = entry.workspaces.slice();
    if (pruneMissing && workspaces.length > 0) {
      const filtered = [];
      for (const workspace of workspaces) {
        if (await workspaceExists(workspace.ref)) {
          filtered.push(workspace);
          continue;
        }
        changed = true;
      }
      workspaces = filtered;
    }

    const visibleWorkspaces = rootFilter
      ? workspaces.filter((workspace) => workspace && workspace.ref && workspace.ref.startsWith(`${rootFilter}/`))
      : workspaces.slice();

    let lastUsedRef = normalizeWorkspaceRef(entry.last_used_ref);
    if (rootFilter && lastUsedRef && !lastUsedRef.startsWith(`${rootFilter}/`)) {
      lastUsedRef = "";
    }
    if (lastUsedRef && !visibleWorkspaces.some((workspace) => workspace.ref === lastUsedRef)) {
      lastUsedRef = visibleWorkspaces[0] && visibleWorkspaces[0].ref ? visibleWorkspaces[0].ref : "";
    }

    if (changed) {
      registry.tasks[normalizedTaskId] = {
        last_used_ref: workspaces.some((workspace) => workspace.ref === entry.last_used_ref)
          ? entry.last_used_ref
          : (workspaces[0] && workspaces[0].ref ? workspaces[0].ref : ""),
        workspaces
      };
      if (registry.tasks[normalizedTaskId].workspaces.length === 0) {
        delete registry.tasks[normalizedTaskId];
      }
      await writeRegistry(registry);
    }

    return {
      taskId: normalizedTaskId,
      lastUsedRef,
      workspaces: visibleWorkspaces
    };
  }

  async function touchTaskWorkspace(taskId, ref, options = {}) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const normalizedRef = normalizeWorkspaceRef(ref);
    if (!normalizedTaskId) {
      const error = new Error("Invalid task id.");
      error.status = 400;
      throw error;
    }
    if (!normalizedRef) {
      const error = new Error("Invalid workspace ref.");
      error.status = 400;
      throw error;
    }

    const now = normalizeTimestamp(options.timestamp) || new Date().toISOString();
    const registry = await readRegistry();
    const existing = registry.tasks[normalizedTaskId] || { last_used_ref: "", workspaces: [] };
    const nextWorkspaces = normalizeWorkspaceEntries(existing.workspaces);
    const existingEntry = nextWorkspaces.find((workspace) => workspace.ref === normalizedRef) || null;

    if (existingEntry) {
      existingEntry.last_used_at = now;
      if (!existingEntry.created_at) {
        existingEntry.created_at = now;
      }
    } else {
      nextWorkspaces.push({
        ref: normalizedRef,
        created_at: now,
        last_used_at: now
      });
    }

    registry.tasks[normalizedTaskId] = {
      last_used_ref: normalizedRef,
      workspaces: normalizeWorkspaceEntries(nextWorkspaces)
    };
    await writeRegistry(registry);

    return {
      taskId: normalizedTaskId,
      ref: normalizedRef,
      lastUsedRef: normalizedRef
    };
  }

  async function removeTask(taskId) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return false;
    }
    const registry = await readRegistry();
    if (!registry.tasks[normalizedTaskId]) {
      return false;
    }
    delete registry.tasks[normalizedTaskId];
    await writeRegistry(registry);
    return true;
  }

  return {
    TASK_WORKSPACE_LINKS_FILENAME,
    createWorkspaceRef,
    linksPath,
    listTaskWorkspaces,
    normalizeTaskId,
    normalizeWorkspaceRef,
    readRegistry,
    removeTask,
    resolveWorkspaceRef,
    touchTaskWorkspace,
    workspaceExists,
    writeRegistry
  };
}

module.exports = {
  createTaskWorkspaceLinkService,
  normalizeWorkspaceRef
};
